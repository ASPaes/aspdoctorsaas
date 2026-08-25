-- ============================================================================
-- Divergência de cadastro ganha a saída que faltava: trazer o dado do OEM
--
-- Hoje, "Só o nome diferente" e "CNPJ diferente dos dois lados" só oferecem
-- Trocar cliente, Desfazer e Ignorar — todas partindo do princípio de que o
-- VÍNCULO está errado. Quando o vínculo está certo e quem está desatualizado é
-- o cadastro daqui, não havia botão: a pessoa saía da tela, abria a ficha e
-- digitava à mão.
--
-- Esta função é esse botão. Ela copia para o cliente do DoctorSaaS o valor que
-- o parceiro tem, um campo por vez, sempre na direção OEM -> DS.
--
-- POR QUE SÓ ESSA DIREÇÃO
-- Custo não entra aqui de propósito: quem fatura é o parceiro, e o DS não tem
-- o que dizer sobre ele (a saída do custo já existe e é a `atualizar_custo_ds_oem`).
-- Nome e CNPJ no sentido DS -> OEM dependem de `POST /v1/licenciamento/filial`,
-- que salva a filial INTEIRA e exige três códigos que nenhuma leitura devolve:
-- é trabalho no DoctorOEM, não uma linha aqui.
--
-- O QUE ESTA ESCRITA DISPARA, e não é pouco
-- `trg_cliente_cadastro_enfileirar_omie` observa `cnpj`, `razao_social` e
-- `nome_fantasia`. Mexer em qualquer um deles ENFILEIRA a alteração do cadastro
-- no Omie — para cada CONTRATO ATIVO do cliente, e só se a integração Omie
-- estiver ligada e não pausada para a unidade dele (os portões da
-- `enfileirar_sync_omie`). Medido no smoke: cliente sem contrato ativo não
-- enfileira nada; com contrato ativo e Omie ligado, entra 1 linha na fila.
-- É o comportamento desejado — cadastro certo tem que ficar certo nos três
-- lugares — mas quem clica precisa saber, e a tela avisa antes.
--
-- A GUARDA DO CNPJ
-- Divergência de CNPJ quase nunca é cadastro velho: é licença vinculada ao
-- cliente errado. Gravar o CNPJ do OEM em cima do cliente errado criaria dois
-- clientes com o mesmo CNPJ, quebrando o de-para do Omie e a própria
-- conferência. Por isso, se o CNPJ já for de OUTRO cliente do tenant, a função
-- se recusa e diz de quem é, apontando o caminho certo (Trocar cliente).
-- Decisão do Alexandre em 24/08/2026, ciente dessa ressalva.
--
-- `cnpj_digits` é coluna GERADA a partir de `cnpj` — grava-se só `cnpj`.
-- ============================================================================

begin;

create or replace function public.oem_trazer_cadastro_do_parceiro(
  p_recon_id uuid,
  p_campo    text   -- 'nome' | 'cnpj'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_l      public.reconciliacao_oem;
  v_antes  text;
  v_depois text;
  v_dono   text;
begin
  if p_campo not in ('nome', 'cnpj') then
    raise exception 'Campo inválido: %. Só nome e cnpj.', p_campo;
  end if;

  select * into v_l from public.reconciliacao_oem where id = p_recon_id;
  if v_l.id is null then
    raise exception 'Linha da conferência não encontrada. Atualize o espelho e tente de novo.';
  end if;

  -- Mesma permissão das outras decisões da aba.
  if not public.pode_decidir_oem(v_l.tenant_id) then
    raise exception 'Sem permissão para decidir divergências do OEM.';
  end if;

  if v_l.ds_customer_id is null then
    raise exception 'Esta licença ainda não tem cliente no DoctorSaaS.';
  end if;

  if p_campo = 'nome' then
    -- `razao_oem` é o nome fantasia da loja no OEM, e é ele que a conferência
    -- compara com `clientes.nome_fantasia`. Gravar em razao_social resolveria
    -- outra divergência que não é esta.
    if coalesce(btrim(v_l.razao_oem), '') = '' then
      raise exception 'O OEM não tem nome para esta licença.';
    end if;
    v_depois := btrim(v_l.razao_oem);

    select nome_fantasia into v_antes from public.clientes where id = v_l.ds_customer_id;
    if v_antes is not distinct from v_depois then
      return jsonb_build_object('campo', p_campo, 'sem_mudanca', true, 'valor', v_depois);
    end if;

    update public.clientes
       set nome_fantasia = v_depois, updated_at = now()
     where id = v_l.ds_customer_id;

  else
    if coalesce(btrim(v_l.cnpj_norm), '') = '' then
      raise exception 'O OEM não tem CNPJ para esta licença.';
    end if;
    v_depois := regexp_replace(v_l.cnpj_norm, '[^0-9]', '', 'g');

    -- A guarda. Vem ANTES de qualquer escrita.
    select coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social)
      into v_dono
      from public.clientes c
     where c.tenant_id = v_l.tenant_id
       and c.id <> v_l.ds_customer_id
       and c.cnpj_digits = v_depois
     limit 1;
    if v_dono is not null then
      raise exception 'O CNPJ % já é do cliente "%". Se a licença é dele, use Trocar cliente.',
        v_depois, v_dono;
    end if;

    select cnpj into v_antes from public.clientes where id = v_l.ds_customer_id;
    if regexp_replace(coalesce(v_antes, ''), '[^0-9]', '', 'g') = v_depois then
      return jsonb_build_object('campo', p_campo, 'sem_mudanca', true, 'valor', v_depois);
    end if;

    update public.clientes
       set cnpj = v_depois, updated_at = now()
     where id = v_l.ds_customer_id;
  end if;

  return jsonb_build_object(
    'campo',       p_campo,
    'cliente_id',  v_l.ds_customer_id,
    'antes',       v_antes,
    'depois',      v_depois,
    'sem_mudanca', false
  );
end $fn$;

-- `revoke from public` sozinho não restringe: o privilégio padrão já concede
-- EXECUTE a `authenticated`. Os revokes vão por papel, e a permissão de fato é
-- a `pode_decidir_oem` lá dentro.
revoke all on function public.oem_trazer_cadastro_do_parceiro(uuid, text) from public;
revoke all on function public.oem_trazer_cadastro_do_parceiro(uuid, text) from anon;
grant execute on function public.oem_trazer_cadastro_do_parceiro(uuid, text) to authenticated, service_role;

comment on function public.oem_trazer_cadastro_do_parceiro(uuid, text) is
  'Copia para o cliente do DoctorSaaS o nome fantasia ou o CNPJ que o OEM tem naquela licença. Recusa CNPJ que já seja de outro cliente do tenant. A escrita enfileira o cadastro no Omie pelo gatilho de sempre.';

commit;

-- ---------------------------------------------------------------------------
-- ENSAIO SEGURO — roda de verdade e NÃO grava (a exceção provoca rollback).
-- No SQL Editor não há usuário logado, então `pode_decidir_oem` devolve falso e
-- a função barra: o set_config apresenta um admin só para esta transação.
--
--   do $$
--   declare r jsonb;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', '<user_id de um admin>', 'role', 'authenticated')::text, true);
--     r := public.oem_trazer_cadastro_do_parceiro('<id de uma linha de recon>', 'nome');
--     raise exception 'SMOKE_OK|%', r::text;
--   end $$;
-- ---------------------------------------------------------------------------
