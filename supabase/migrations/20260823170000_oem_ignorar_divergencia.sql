-- ============================================================================
-- "Está certo assim": ignorar uma divergência do OEM sem desfazer o vínculo
--
-- O CASO QUE FALTAVA
-- ACAI-SE BV 2: o OEM guarda "ACAISE BV 2" e o DoctorSaaS "ACAI-SE BV 2". É a
-- mesma empresa, o vínculo está certo, e as duas únicas saídas que a linha
-- oferecia eram **Trocar cliente** e **Desfazer** — as duas erradas. Sem uma
-- terceira, a divergência ficava na lista para sempre, e lista que não esvazia
-- é lista que ninguém lê.
--
-- POR QUE JSONB E NÃO UMA FLAG
-- Um cliente pode ter CNPJ divergente E nome divergente E custo divergente ao
-- mesmo tempo. Uma flag esconderia os três de uma vez; aqui cada tipo é uma
-- chave, e ignorar o nome não cala o CNPJ.
--
-- O VALOR NA CHAVE É O QUE FAZ O ALERTA VOLTAR
-- Guardar só "nome ignorado" esconderia para sempre qualquer nome futuro
-- daquele vínculo — inclusive o dia em que o código passar a apontar para outra
-- empresa. Por isso o que se grava é a ASSINATURA do que foi aceito (os dois
-- nomes comparados, os dois valores de custo…). A tela só esconde enquanto a
-- assinatura for a mesma: mudou o que estava sendo comparado, a divergência
-- reaparece e alguém decide de novo.
--
-- SOBREVIVE À CARGA
-- `reconciliacao_oem` é apagada e refeita a cada sincronização. A edge function
-- `oem-espelho-sync` passa a copiar `ignoradas` da linha antiga junto com as
-- outras decisões humanas — sem isso, ignorar duraria até a próxima carga.
-- ============================================================================

begin;

alter table public.reconciliacao_oem
  add column if not exists ignoradas jsonb;

comment on column public.reconciliacao_oem.ignoradas is
  'Divergências que alguém marcou como "está certo assim": {tipo: assinatura do que foi aceito}. A tela esconde o tipo enquanto a assinatura atual for igual a esta; mudou o valor comparado, o alerta volta.';

-- ---------------------------------------------------------------- ignorar
--
-- Dois alvos porque a tela tem dois tipos de divergência: as que vivem numa
-- linha (nome, CNPJ, licença) e as que são do CLIENTE inteiro, apuradas
-- somando as filiais dele (custo, margem). Para as segundas, a marca vai em
-- todas as linhas do cliente naquela conta — qualquer uma responde.
create or replace function public.oem_ignorar_divergencia(
  p_tipo       text,
  p_assinatura text,
  p_recon_id   uuid default null,
  p_cliente_id uuid default null,
  p_conta      uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_n      int;
begin
  if p_tipo is null or btrim(p_tipo) = '' then
    raise exception 'Informe o tipo da divergência.';
  end if;
  if p_recon_id is null and (p_cliente_id is null or p_conta is null) then
    raise exception 'Informe a linha, ou o cliente e a conta.';
  end if;

  if p_recon_id is not null then
    select tenant_id into v_tenant
      from public.reconciliacao_oem where id = p_recon_id;
  else
    select tenant_id into v_tenant
      from public.reconciliacao_oem
     where conta_integration_id = p_conta and ds_customer_id = p_cliente_id
     limit 1;
  end if;

  if v_tenant is null then
    raise exception 'Linha de conciliação não encontrada.';
  end if;
  -- Mesmo portão de vincular/desvincular: ignorar é decisão sobre o vínculo.
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  update public.reconciliacao_oem
     set ignoradas = coalesce(ignoradas, '{}'::jsonb)
                     || jsonb_build_object(p_tipo, coalesce(nullif(btrim(p_assinatura), ''), p_tipo))
   where (p_recon_id is not null and id = p_recon_id)
      or (p_recon_id is null
          and conta_integration_id = p_conta
          and ds_customer_id = p_cliente_id);

  get diagnostics v_n = row_count;
  return v_n;
end $$;

alter function public.oem_ignorar_divergencia(text, text, uuid, uuid, uuid) owner to postgres;
revoke all on function public.oem_ignorar_divergencia(text, text, uuid, uuid, uuid) from public;
revoke all on function public.oem_ignorar_divergencia(text, text, uuid, uuid, uuid) from anon;
grant execute on function public.oem_ignorar_divergencia(text, text, uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.oem_ignorar_divergencia(text, text, uuid, uuid, uuid) is
  'Marca uma divergência do OEM como aceita, guardando a assinatura do que foi aceito. O vínculo continua valendo; muda só o que a aba Divergências mostra.';

-- -------------------------------------------------------------- reexibir
--
-- Toda decisão precisa de caminho de volta. Sem isto, um clique errado tira a
-- divergência da tela e não existe tela nenhuma para trazê-la de volta.
create or replace function public.oem_reexibir_divergencia(
  p_tipo       text,
  p_recon_id   uuid default null,
  p_cliente_id uuid default null,
  p_conta      uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_n      int;
begin
  if p_tipo is null or btrim(p_tipo) = '' then
    raise exception 'Informe o tipo da divergência.';
  end if;
  if p_recon_id is null and (p_cliente_id is null or p_conta is null) then
    raise exception 'Informe a linha, ou o cliente e a conta.';
  end if;

  if p_recon_id is not null then
    select tenant_id into v_tenant
      from public.reconciliacao_oem where id = p_recon_id;
  else
    select tenant_id into v_tenant
      from public.reconciliacao_oem
     where conta_integration_id = p_conta and ds_customer_id = p_cliente_id
     limit 1;
  end if;

  if v_tenant is null then
    raise exception 'Linha de conciliação não encontrada.';
  end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  update public.reconciliacao_oem
     set ignoradas = nullif(coalesce(ignoradas, '{}'::jsonb) - p_tipo, '{}'::jsonb)
   where (p_recon_id is not null and id = p_recon_id)
      or (p_recon_id is null
          and conta_integration_id = p_conta
          and ds_customer_id = p_cliente_id);

  get diagnostics v_n = row_count;
  return v_n;
end $$;

alter function public.oem_reexibir_divergencia(text, uuid, uuid, uuid) owner to postgres;
revoke all on function public.oem_reexibir_divergencia(text, uuid, uuid, uuid) from public;
revoke all on function public.oem_reexibir_divergencia(text, uuid, uuid, uuid) from anon;
grant execute on function public.oem_reexibir_divergencia(text, uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.oem_reexibir_divergencia(text, uuid, uuid, uuid) is
  'Desfaz o ignorar: a divergência volta a aparecer na aba.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura):
--   select ds_customer_id, razao_ds, ignoradas
--     from public.reconciliacao_oem where ignoradas is not null;
-- ---------------------------------------------------------------------------
