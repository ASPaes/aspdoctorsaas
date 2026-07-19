-- Integração PortalHiper — tabela de configuração por tenant.
-- Clona o padrão de public.omie_integration (RLS + grants) e acrescenta base_url
-- (o Omie tem URL fixa; o PortalHiper é chamado por HTTP, então guardamos a base).
-- Token de integração fica no Vault (vault_secret_id), nunca em coluna plain.

create table if not exists public.hiper_integration (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  base_url              text not null default 'https://portalhiper.com.br',
  vault_secret_id       uuid,
  ativo                 boolean not null default false,
  ultimo_status         text not null default 'nao_testado'
                          check (ultimo_status in ('ok','erro','nao_testado')),
  ultimo_teste_at       timestamptz,
  -- watermark do pull incremental: maior last_scraped_at recebido (contrato §4)
  puxar_desde           timestamptz,
  sync_automatica_ativa boolean not null default false,
  sync_lote_tamanho     integer not null default 200,
  sync_max_tentativas   integer not null default 5,
  integracao_pausada    boolean not null default false,
  updated_at            timestamptz not null default now(),
  constraint hiper_integration_tenant_id_key unique (tenant_id)
);

alter table public.hiper_integration enable row level security;

-- Políticas espelhadas de omie_integration: super admin faz bypass; membros do tenant
-- leem (admin/head) e escrevem (admin) apenas o próprio tenant.
drop policy if exists hiper_integration_select on public.hiper_integration;
create policy hiper_integration_select on public.hiper_integration
  for select using (
    (select is_super_admin())
    or (tenant_id = (select current_tenant_id()) and (select is_tenant_admin_or_head()))
  );

drop policy if exists hiper_integration_insert on public.hiper_integration;
create policy hiper_integration_insert on public.hiper_integration
  for insert with check (
    (select is_super_admin())
    or ((select is_tenant_active_member()) and tenant_id = (select current_tenant_id()) and (select is_tenant_admin()))
  );

drop policy if exists hiper_integration_update on public.hiper_integration;
create policy hiper_integration_update on public.hiper_integration
  for update using (
    (select is_super_admin())
    or ((select is_tenant_active_member()) and tenant_id = (select current_tenant_id()) and (select is_tenant_admin()))
  );

drop policy if exists hiper_integration_delete on public.hiper_integration;
create policy hiper_integration_delete on public.hiper_integration
  for delete using (
    (select is_super_admin())
    or ((select is_tenant_active_member()) and tenant_id = (select current_tenant_id()) and (select is_tenant_admin()))
  );

grant select, insert, update, delete on public.hiper_integration to authenticated, service_role;
