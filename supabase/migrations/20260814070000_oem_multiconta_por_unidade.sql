-- ============================================================================
-- Integração OEM: uma conta POR UNIDADE BASE, chave no Vault
--
-- A primeira versão foi feita por TENANT, com a chave em texto puro numa
-- coluna. Está errado nas duas pontas, e o Omie já resolveu isso em 07/08/2026:
--
--   omie_integration  ->  unidades_base_ids bigint[] · vault_secret_id
--   espelho e reconciliação carregam conta_integration_id
--   chave sai por obter_chave_omie_por_conta(id), nunca por SELECT
--
-- O tenant Digi Office tem 4 unidades (Digi Office 6 · Digi Up 10 ·
-- Nutrebem 11 · Teste 12) e já tem DUAS contas Omie. Vai ter mais de uma de
-- OEM também. Sem a coluna de conta, as filiais da Digi Up cairiam no mesmo
-- balaio da Digi Office e o de/para passaria a casar cliente de uma unidade
-- com filial da outra.
--
-- Preserva o que já foi carregado: cria a conta a partir da linha existente,
-- move a chave para o Vault e carimba as 2.564 linhas do espelho e as 2.966 do
-- de/para com o id dela. Nenhum vínculo se perde.
--
-- ORDEM IMPORTA: as colunas de conta são criadas ANTES do bloco que as
-- preenche, e a chave estrangeira só depois que a tabela nova assume o nome
-- definitivo — senão apontaria para a tabela velha.
-- ============================================================================

begin;

-- ------------------------------------------------- 1. conta (uma por unidade)
create table if not exists public.oem_integration_v2 (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  unidades_base_ids   bigint[],                 -- null = todas as unidades
  vault_secret_id     uuid,                     -- ponteiro para a chave no Vault
  chave_prefixo       text,                     -- só para exibição na tela
  api_url             text not null default 'https://furohpfhukwajhvnnbiw.functions.supabase.co',
  ativo               boolean not null default true,
  ultimo_status       text not null default 'nao_testado',
  ultimo_teste_at     timestamptz,
  ultimo_sync_em      timestamptz,
  ultimo_sync_status  text,
  ultimo_sync_msg     text,
  criado_em           timestamptz not null default now(),
  criado_por          uuid
);

-- ------------------- 2. colunas de conta ANTES de qualquer coisa preenchê-las
alter table public.oem_espelho_filial add column if not exists conta_integration_id uuid;
alter table public.reconciliacao_oem  add column if not exists conta_integration_id uuid;

-- ------------------------------------- 3. migra a linha antiga (chave -> Vault)
do $$
declare
  v_old   record;
  v_sid   uuid;
  v_nome  text;
  v_conta uuid;
begin
  if to_regclass('public.oem_integration') is null then return; end if;

  for v_old in select * from public.oem_integration loop
    v_nome := 'oem_api_key_' || v_old.tenant_id::text;
    begin
      v_sid := public.vault_get_secret_id_by_name(v_nome);
    exception when others then v_sid := null;
    end;
    if v_sid is null then
      v_sid := public.vault_create_secret(v_old.api_key, v_nome);
    end if;

    -- A chave existente é a da Digi Office (unidade 6) — foi com ela que as
    -- 2.564 filiais entraram.
    insert into public.oem_integration_v2
      (tenant_id, unidades_base_ids, vault_secret_id, chave_prefixo, api_url,
       ultimo_sync_em, ultimo_sync_status, ultimo_sync_msg)
    values
      (v_old.tenant_id, array[6]::bigint[], v_sid, v_old.chave_prefixo, v_old.api_url,
       v_old.ultimo_sync_em, v_old.ultimo_sync_status, v_old.ultimo_sync_msg)
    returning id into v_conta;

    update public.oem_espelho_filial set conta_integration_id = v_conta
      where tenant_id = v_old.tenant_id and conta_integration_id is null;
    update public.reconciliacao_oem   set conta_integration_id = v_conta
      where tenant_id = v_old.tenant_id and conta_integration_id is null;
  end loop;
end $$;

-- ------------------------------ 4. a tabela nova assume o nome definitivo
drop view  if exists public.oem_integration_status;
drop table if exists public.oem_integration;
alter table public.oem_integration_v2 rename to oem_integration;

create index if not exists idx_oem_integration_tenant on public.oem_integration (tenant_id, ativo);

-- ---------------------- 5. só agora as FKs, apontando para o nome definitivo
do $$ begin
  alter table public.oem_espelho_filial
    add constraint oem_espelho_conta_fk
    foreign key (conta_integration_id) references public.oem_integration(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.reconciliacao_oem
    add constraint reconciliacao_oem_conta_fk
    foreign key (conta_integration_id) references public.oem_integration(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- A unicidade era por tenant. Com duas contas no mesmo tenant, duas filiais de
-- contas diferentes podem repetir o codfilial — a chave passa a ser a conta.
alter table public.oem_espelho_filial drop constraint if exists oem_espelho_filial_unica;
create unique index if not exists oem_espelho_filial_unica
  on public.oem_espelho_filial (conta_integration_id, filial_codigo);

alter table public.reconciliacao_oem drop constraint if exists reconciliacao_oem_unica;
create index if not exists idx_recon_oem_conta
  on public.reconciliacao_oem (conta_integration_id, estado_match);

-- ------------------------------------------------------------- 6. as RPCs
-- Mesmo desenho de obter_chave_omie_por_conta: a chave sai por função, nunca
-- por SELECT, e só para o service_role — o navegador não tem como pedi-la.
create or replace function public.obter_chave_oem_por_conta(p_integration_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_sid uuid; v_chave text;
begin
  select vault_secret_id into v_sid from public.oem_integration where id = p_integration_id;
  if v_sid is null then return null; end if;
  select decrypted_secret into v_chave from vault.decrypted_secrets where id = v_sid;
  return v_chave;
end $$;

revoke all on function public.obter_chave_oem_por_conta(uuid) from public;
grant execute on function public.obter_chave_oem_por_conta(uuid) to service_role;

-- Grava/atualiza a chave de uma conta. Recebe a chave em claro, devolve o id
-- da conta — e a chave só existe no Vault a partir daqui.
create or replace function public.salvar_chave_oem(
  p_tenant_id uuid,
  p_unidades  bigint[],
  p_chave     text,
  p_api_url   text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_sid uuid; v_nome text;
begin
  if not (public.is_super_admin()
          or exists (select 1 from public.profiles p
                      where p.user_id = auth.uid()
                        and p.tenant_id = p_tenant_id
                        and p.role in ('admin','head'))) then
    raise exception 'Apenas administradores podem configurar a integração OEM.';
  end if;
  if coalesce(trim(p_chave), '') = '' then
    raise exception 'Chave vazia.';
  end if;

  -- Uma unidade não pode estar em duas contas: o espelho ficaria ambíguo.
  select id into v_id from public.oem_integration
   where tenant_id = p_tenant_id and unidades_base_ids && p_unidades limit 1;

  v_nome := 'oem_api_key_' || p_tenant_id::text || '_' || coalesce(p_unidades[1], 0)::text;
  begin
    v_sid := public.vault_get_secret_id_by_name(v_nome);
  exception when others then v_sid := null;
  end;
  if v_sid is null then
    v_sid := public.vault_create_secret(trim(p_chave), v_nome);
  else
    -- É public.vault_update_secret, não vault.update_secret: o projeto tem
    -- wrappers próprios, e é assim que salvar_chave_omie faz.
    perform public.vault_update_secret(v_sid, trim(p_chave));
  end if;

  if v_id is null then
    insert into public.oem_integration
      (tenant_id, unidades_base_ids, vault_secret_id, chave_prefixo, api_url, criado_por)
    values (p_tenant_id, p_unidades, v_sid, left(trim(p_chave), 17),
            coalesce(p_api_url, 'https://furohpfhukwajhvnnbiw.functions.supabase.co'), auth.uid())
    returning id into v_id;
  else
    update public.oem_integration
       set unidades_base_ids = p_unidades,
           vault_secret_id   = v_sid,
           chave_prefixo     = left(trim(p_chave), 17),
           api_url           = coalesce(p_api_url, api_url),
           ultimo_status     = 'nao_testado'
     where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.salvar_chave_oem(uuid, bigint[], text, text) from public;
grant execute on function public.salvar_chave_oem(uuid, bigint[], text, text) to authenticated, service_role;

-- --------------------------------------------------- 7. RLS e view de status
alter table public.oem_integration enable row level security;
grant all on public.oem_integration to service_role;
-- Sem grant para authenticated: nem a linha, nem o ponteiro do Vault.

create or replace view public.oem_integration_status as
  select id, tenant_id, unidades_base_ids, chave_prefixo, api_url, ativo,
         ultimo_status, ultimo_teste_at, ultimo_sync_em, ultimo_sync_status,
         ultimo_sync_msg, criado_em
    from public.oem_integration;

grant select on public.oem_integration_status to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--   select id, unidades_base_ids, chave_prefixo, ultimo_sync_status
--     from public.oem_integration_status;
--   select conta_integration_id, count(*) from public.reconciliacao_oem group by 1;
-- ---------------------------------------------------------------------------
