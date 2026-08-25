-- ============================================================================
-- Corrigir o cadastro e a divergência CONTINUAR na tela
--
-- O QUE ACONTECEU (25/08/2026, testado pelo Alexandre no cliente ACAI-SE BV 2)
-- Ele clicou em "Atualizar no DoctorSaaS", a tela disse que atualizou, e a
-- linha continuou lá. A gravação funcionou: o que não mudou foi o ESPELHO.
--
-- `reconciliacao_oem` é uma fotografia, reescrita a cada carga (de 6 em 6h).
-- É dela que a aba lê `razao_ds`, `cnpj_ds` e o array `divergencias` — e quem
-- decide o que é divergência é a `apurarDivergencias`, que roda na
-- `oem-espelho-sync`, não no banco. Mexer em `clientes` não toca nessa linha,
-- então o painel seguia mostrando o nome antigo e o apontamento de pé até a
-- próxima sincronização.
--
-- O CONSERTO
-- A própria função passa a acertar a fotografia do lado do DoctorSaaS: grava o
-- valor novo em `razao_ds`/`cnpj_ds` e tira 'nome'/'cnpj' do array. A linha sai
-- da lista na hora, que é o que a pessoa espera de um botão que acabou de
-- dizer "atualizado".
--
-- POR QUE ISSO NÃO É O "ECO" QUE JÁ NOS MORDEU
-- Em [[omie-espelho-valor-nao-confirmado]] o erro foi gravar no espelho o
-- valor que o DS DECLAROU ter mandado para o parceiro, sem nunca reler: a
-- conferência passava a comparar o sistema com ele mesmo. Aqui é o contrário:
-- `razao_ds` e `cnpj_ds` são, por definição, o que o DoctorSaaS tem — e é
-- exatamente o que acabou de ser gravado em `clientes`, na mesma transação. O
-- lado do parceiro (`razao_oem`, `cnpj_norm`) não é tocado.
--
-- E se a próxima carga discordar, ela reescreve a linha e a divergência volta.
-- É a rede de proteção certa: o espelho continua sendo a fotografia do
-- parceiro, e esta escrita só antecipa o que ela vai confirmar.
--
-- Vale para TODAS as linhas do cliente: um cliente com três filiais tem três
-- linhas na reconciliação, e o nome dele é o mesmo nas três.
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
  v_linhas int;
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

    -- A fotografia acompanha, senão a linha fica na tela dizendo o valor velho.
    update public.reconciliacao_oem r
       set razao_ds     = v_depois,
           divergencias = nullif(array_remove(coalesce(r.divergencias, '{}'::text[]), 'nome'), '{}'::text[])
     where r.tenant_id      = v_l.tenant_id
       and r.ds_customer_id = v_l.ds_customer_id;
    get diagnostics v_linhas = row_count;

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

    -- Só o lado do DoctorSaaS. `cnpj_norm` é o documento do parceiro e é chave
    -- de match em meia dúzia de consultas: reescrevê-lo daqui trocaria a
    -- identidade da linha, não corrigiria uma divergência.
    update public.reconciliacao_oem r
       set cnpj_ds      = v_depois,
           divergencias = nullif(array_remove(coalesce(r.divergencias, '{}'::text[]), 'cnpj'), '{}'::text[])
     where r.tenant_id      = v_l.tenant_id
       and r.ds_customer_id = v_l.ds_customer_id;
    get diagnostics v_linhas = row_count;
  end if;

  return jsonb_build_object(
    'campo',        p_campo,
    'cliente_id',   v_l.ds_customer_id,
    'antes',        v_antes,
    'depois',       v_depois,
    'linhas_espelho', v_linhas,
    'sem_mudanca',  false
  );
end $fn$;

revoke all on function public.oem_trazer_cadastro_do_parceiro(uuid, text) from public;
revoke all on function public.oem_trazer_cadastro_do_parceiro(uuid, text) from anon;
grant execute on function public.oem_trazer_cadastro_do_parceiro(uuid, text) to authenticated, service_role;

comment on function public.oem_trazer_cadastro_do_parceiro(uuid, text) is
  'Copia para o cliente do DoctorSaaS o nome fantasia ou o CNPJ que o OEM tem naquela licença, e acerta o lado DS do espelho para a divergência sair da lista na hora. Recusa CNPJ que já seja de outro cliente do tenant. A escrita enfileira o cadastro no Omie pelo gatilho de sempre.';

-- ------------------------------------------------- a mesma poda, pelo outro lado
--
-- O botão que escreve NO OEM passa pela edge function, e lá o array não tem
-- como ser podado: PostgREST não expõe array_remove, e ler-modificar-gravar do
-- outro lado da rede abriria corrida com a carga do espelho.
--
-- service_role e mais ninguém: quem chama é a `oem-atualizar-cadastro-licenca`,
-- depois de o parceiro confirmar a gravação. Exposta a `authenticated`, seria
-- um jeito de apagar apontamento da tela sem corrigir nada.
create or replace function public.oem_tirar_divergencia_da_linha(
  p_recon_id uuid,
  p_tipo     text
) returns void
language sql
security definer
set search_path to 'public'
as $fn$
  update public.reconciliacao_oem
     set divergencias = nullif(
           array_remove(coalesce(divergencias, '{}'::text[]), p_tipo),
           '{}'::text[])
   where id = p_recon_id;
$fn$;

revoke all on function public.oem_tirar_divergencia_da_linha(uuid, text) from public;
revoke all on function public.oem_tirar_divergencia_da_linha(uuid, text) from anon;
revoke all on function public.oem_tirar_divergencia_da_linha(uuid, text) from authenticated;
grant execute on function public.oem_tirar_divergencia_da_linha(uuid, text) to service_role;

comment on function public.oem_tirar_divergencia_da_linha(uuid, text) is
  'Tira UM tipo do array de divergências de uma linha da reconciliação. Chamada pela edge function depois que o parceiro confirma a gravação; a próxima carga do espelho é quem confirma de verdade.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura). Depois de corrigir um cliente, a linha dele não
-- pode mais listar 'nome' — e o razao_ds tem que ser o mesmo do razao_oem:
--
--   select filial_codigo, razao_oem, razao_ds, divergencias
--     from public.reconciliacao_oem
--    where ds_customer_id = '<id do cliente>';
-- ---------------------------------------------------------------------------
