-- F1 do Omie multi-conta: uma conta Omie por unidade base, sem misturar dado entre elas.
--
-- Contexto (06/08/2026): metade do multi-conta ja existia -- omie_integration.unidades_base_ids,
-- o trigger de disjuncao, omie_sync_fila.conta_integration_id (que enfileirar_sync_omie ja
-- carimba pela clientes.unidade_base_id) e as RPCs obter_chave_omie(tenant, unidade) /
-- obter_chave_omie_por_conta(id). Faltavam as tres pecas que impediam a segunda conta de existir:
--
--   1. UNIQUE(tenant_id) na omie_integration -- so cabia 1 linha por tenant.
--   2. salvar_integracao_omie com `on conflict (tenant_id) do update` e segredo unico no Vault
--      chamado 'omie_dmie_key_<tenant>'. Salvar a chave da Digi Up SOBRESCREVIA a da Digi Office.
--   3. omie_espelho_cadastro com UNIQUE(tenant_id, codigo_cliente_omie) -- os codigos de cliente
--      colidem entre contas Omie diferentes, e o recon-espelho-pull apaga o espelho do tenant
--      inteiro no fim do run. Puxar a Digi Up zerava o espelho da Digi Office.
--
-- Esta migration NAO cria a conta da Digi Up. Criar a segunda linha antes do deploy das edge
-- functions (F2) derruba a Digi Office: obter_chave_omie_sistema(tenant) levanta excecao com
-- 2 contas, e isso e a fila (omie-sync-processar), o botao Enviar ao Omie (omie-integration-call)
-- e o recon-espelho-pull de uma vez.

begin;

-- ---------------------------------------------------------------------------
-- 1) Escopo explicito da conta que ja existe.
--    Escopo vazio = "todas as unidades", e trg_omie_integration_unidades_disjuntas recusa
--    uma segunda conta enquanto a primeira estiver vazia. Medido em 06/08/2026: Digi Office
--    917 contratos ativos / 698 ja no Omie; Digi Up 92/0; Nutrebem 44/0; nenhum contrato com
--    unidade nula. Fechar o escopo em Digi Office nao tira do Omie nada que ja esteja la.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant  uuid;
  v_unidade bigint;
  v_qtd     int;
begin
  -- Escopado no tenant que tem a unidade "Digi Office" -- outros tenants com Omie ficam
  -- intocados (1 conta cada, escopo vazio, que segue valido enquanto for uma so).
  select count(distinct u.tenant_id) into v_qtd
  from public.unidades_base u
  join public.omie_integration oi on oi.tenant_id = u.tenant_id
  where u.nome = 'Digi Office';

  if v_qtd <> 1 then
    raise exception 'Esperava 1 tenant com unidade "Digi Office" e integracao Omie, encontrei %.', v_qtd;
  end if;

  select distinct u.tenant_id, u.id into strict v_tenant, v_unidade
  from public.unidades_base u
  join public.omie_integration oi on oi.tenant_id = u.tenant_id
  where u.nome = 'Digi Office';

  select count(*) into v_qtd from public.omie_integration where tenant_id = v_tenant;
  if v_qtd <> 1 then
    raise exception 'Tenant % ja tem % contas Omie -- F1 esperava 1.', v_tenant, v_qtd;
  end if;

  update public.omie_integration
     set unidades_base_ids = array[v_unidade]
   where tenant_id = v_tenant
     and unidades_base_ids is null;

  raise notice 'Tenant % escopado na unidade % (Digi Office).', v_tenant, v_unidade;
end $$;

-- Nenhum tenant pode ter 2 contas neste ponto: os backfills de espelho, reconciliacao e fila
-- resolvem a conta pelo tenant e ficariam ambiguos.
do $$
declare v_dup int;
begin
  select count(*) into v_dup
  from (select tenant_id from public.omie_integration group by tenant_id having count(*) > 1) x;
  if v_dup > 0 then
    raise exception '% tenant(s) com mais de uma conta Omie antes da F1.', v_dup;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Libera N contas por tenant. A disjuncao de unidades continua garantida pelo trigger
--    trg_omie_integration_unidades_disjuntas -- uma unidade nunca pertence a duas contas.
-- ---------------------------------------------------------------------------
alter table public.omie_integration
  drop constraint if exists omie_integration_tenant_id_key;

-- ---------------------------------------------------------------------------
-- 3) Espelho do Omie passa a ser por CONTA, nao por tenant.
--    codigo_cliente_omie so e unico dentro de uma conta Omie.
-- ---------------------------------------------------------------------------
alter table public.omie_espelho_cadastro
  add column if not exists conta_integration_id uuid
    references public.omie_integration(id) on delete cascade;

update public.omie_espelho_cadastro e
   set conta_integration_id = oi.id
  from public.omie_integration oi
 where oi.tenant_id = e.tenant_id
   and e.conta_integration_id is null;

-- A coluna fica NULLABLE e a UNIQUE(tenant_id, codigo_cliente_omie) fica DE PE nesta migration.
-- O recon-espelho-pull que esta em producao hoje faz upsert com onConflict
-- "tenant_id,codigo_cliente_omie" e nao conhece a coluna nova: dropar a constraint ou exigir a
-- coluna aqui derrubaria a Conferencia no intervalo entre a F1 e o deploy da F2.
-- A troca (drop da antiga + set not null) e o ultimo passo da F2, imediatamente antes de criar
-- a conta da Digi Up. Ate la a UNIQUE antiga continua correta, porque so existe 1 conta.
create unique index if not exists omie_espelho_cadastro_conta_codigo_key
  on public.omie_espelho_cadastro (conta_integration_id, codigo_cliente_omie);

-- o match por CNPJ tambem passa a ser por conta (idx_espelho_cad_cnpj continua, e barato)
create index if not exists idx_espelho_cad_conta_cnpj
  on public.omie_espelho_cadastro (conta_integration_id, cnpj_norm);

-- ---------------------------------------------------------------------------
-- 4) Reconciliacao carrega a conta. Deriva do cliente -> unidade -> conta.
--    RESTRICT de proposito: aqui tem decisao de usuario (status_usuario, candidato_escolhido),
--    diferente do espelho, que e cache e se refaz no pull.
-- ---------------------------------------------------------------------------
alter table public.reconciliacao_cadastro
  add column if not exists conta_integration_id uuid
    references public.omie_integration(id) on delete restrict;

update public.reconciliacao_cadastro r
   set conta_integration_id = (
     select oi.id
     from public.omie_integration oi
     join public.contratos c  on c.id = r.ds_contract_id
     join public.clientes   cl on cl.id = c.cliente_id
     where oi.tenant_id = r.tenant_id
       and (oi.unidades_base_ids is null or cl.unidade_base_id = any (oi.unidades_base_ids))
     limit 1
   )
 where r.conta_integration_id is null;

create index if not exists idx_recon_conta
  on public.reconciliacao_cadastro (conta_integration_id, status_usuario);

-- ---------------------------------------------------------------------------
-- 5) Fila: carimba a conta nas linhas antigas (anteriores ao conta_integration_id).
--    Linha sem conta seria pulada pelo omie-sync-processar da F2.
-- ---------------------------------------------------------------------------
update public.omie_sync_fila f
   set conta_integration_id = (
     select oi.id
     from public.omie_integration oi
     join public.contratos c  on c.id = f.contrato_id
     join public.clientes   cl on cl.id = c.cliente_id
     where oi.tenant_id = f.tenant_id
       and (oi.unidades_base_ids is null or cl.unidade_base_id = any (oi.unidades_base_ids))
     limit 1
   )
 where f.conta_integration_id is null;

create index if not exists idx_omie_fila_conta_status
  on public.omie_sync_fila (conta_integration_id, status, proxima_tentativa_em);

-- ---------------------------------------------------------------------------
-- 6) salvar_integracao_omie: por CONTA, com segredo proprio no Vault.
--
--    O DROP e obrigatorio: a assinatura nova tem mais parametros, entao um CREATE OR REPLACE
--    criaria uma SOBRECARGA e a chamada de 3 argumentos continuaria caindo na versao antiga --
--    a que sobrescreve a chave da outra unidade.
--
--    Chamada sem unidade e sem conta continua funcionando enquanto o tenant tiver 1 conta so
--    (e o que o omie-integration-save faz hoje, antes da F2). Com 2+, levanta excecao em vez
--    de escolher errado.
-- ---------------------------------------------------------------------------
drop function if exists public.salvar_integracao_omie(text, uuid, boolean);

create or replace function public.salvar_integracao_omie(
  p_chave              text,
  p_tenant_id          uuid    default null,
  p_ativar             boolean default true,
  p_unidades_base_ids  bigint[] default null,
  p_integration_id     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant      uuid;
  v_id          uuid;
  v_secret_id   uuid;
  v_secret_name text;
  v_qtd         integer;
  v_nova        boolean := false;
  v_invalida    bigint;
begin
  if not public.is_tenant_admin() then
    raise exception 'Apenas admin pode configurar a integracao';
  end if;

  if p_tenant_id is not null and p_tenant_id <> public.current_tenant_id() then
    if not public.is_super_admin() then
      raise exception 'Sem permissao para configurar outro tenant';
    end if;
    v_tenant := p_tenant_id;
  else
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
  end if;

  if v_tenant is null then
    raise exception 'Tenant nao resolvido';
  end if;

  if p_chave is null or length(trim(p_chave)) < 10 then
    raise exception 'Chave invalida';
  end if;

  -- ---- resolve a conta alvo -------------------------------------------------
  if p_integration_id is not null then
    select id into v_id
    from public.omie_integration
    where id = p_integration_id and tenant_id = v_tenant;
    if v_id is null then
      raise exception 'Conta Omie nao encontrada neste tenant';
    end if;

  elsif p_unidades_base_ids is not null and array_length(p_unidades_base_ids, 1) > 0 then
    select x into v_invalida
    from unnest(p_unidades_base_ids) x
    where not exists (
      select 1 from public.unidades_base u where u.id = x and u.tenant_id = v_tenant
    )
    limit 1;
    if v_invalida is not null then
      raise exception 'Unidade base % nao pertence a este tenant', v_invalida;
    end if;

    -- conta que ja cobre alguma dessas unidades = e ela que estamos reconfigurando
    select id into v_id
    from public.omie_integration
    where tenant_id = v_tenant
      and unidades_base_ids && p_unidades_base_ids
    limit 1;

  else
    select count(*) into v_qtd from public.omie_integration where tenant_id = v_tenant;
    if v_qtd > 1 then
      raise exception
        'Tenant tem % contas Omie. Informe a unidade base ou a conta.', v_qtd
        using errcode = '22023';
    end if;
    select id into v_id from public.omie_integration where tenant_id = v_tenant;
  end if;

  v_nova := v_id is null;
  if v_nova then
    v_id := gen_random_uuid();
  else
    select vault_secret_id into v_secret_id from public.omie_integration where id = v_id;
  end if;

  -- ---- segredo por conta ----------------------------------------------------
  -- Contas criadas daqui pra frente usam o id da conta no nome. A conta antiga continua no
  -- segredo 'omie_dmie_key_<tenant>' -- o ponteiro e o vault_secret_id, o nome so serve pra
  -- reencontrar o segredo quando o ponteiro esta vazio.
  if v_secret_id is null then
    v_secret_name := 'omie_dmie_key_' || v_id::text;
    v_secret_id := public.vault_get_secret_id_by_name(v_secret_name);
  end if;

  if v_secret_id is null then
    v_secret_id := public.vault_create_secret(trim(p_chave), v_secret_name);
  else
    perform public.vault_update_secret(v_secret_id, trim(p_chave));
  end if;

  if v_nova then
    -- Conta nova nasce PAUSADA de proposito: 92 contratos da Digi Up sem de-para no Omie
    -- entrariam na fila de uma vez. Despausar e uma acao deliberada, na aba Padroes Omie,
    -- depois da Conferencia. integracao_pausada e o freio que ja tem UI.
    insert into public.omie_integration (
      id, tenant_id, vault_secret_id, ativo, sync_automatica_ativa, integracao_pausada,
      ultimo_status, unidades_base_ids, updated_at
    ) values (
      v_id, v_tenant, v_secret_id, p_ativar, p_ativar, true,
      'nao_testado', p_unidades_base_ids, now()
    );
  else
    update public.omie_integration
       set vault_secret_id   = v_secret_id,
           ativo             = p_ativar,
           unidades_base_ids = coalesce(p_unidades_base_ids, unidades_base_ids),
           updated_at        = now()
     where id = v_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ativo', p_ativar,
    'integration_id', v_id,
    'nova_conta', v_nova,
    'unidades_base_ids', (select unidades_base_ids from public.omie_integration where id = v_id),
    'pausada', (select integracao_pausada from public.omie_integration where id = v_id)
  );
end;
$function$;

revoke all on function public.salvar_integracao_omie(text, uuid, boolean, bigint[], uuid) from public;
grant execute on function public.salvar_integracao_omie(text, uuid, boolean, bigint[], uuid)
  to authenticated, service_role;

commit;
