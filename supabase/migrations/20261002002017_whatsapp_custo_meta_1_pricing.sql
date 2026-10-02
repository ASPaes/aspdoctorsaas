-- =============================================================================
-- Custo do WhatsApp Oficial (Meta) — fase 1a: pricing por mensagem
--
-- whatsapp_message_pricing: uma linha por mensagem enviada com o objeto
-- `pricing` que a Meta manda nos webhooks de status (sent / delivered / read).
-- Chega até 2x por mensagem: a PK (tenant_id, message_id) + upsert com
-- ignoreDuplicates no meta-webhook guarda só a primeira.
-- Escrita só pelo service role (meta-webhook). Leitura: admin/head do tenant
-- e super admin.
--
-- Grants: o default ACL do Supabase dá arwdDxtm (inclui TRUNCATE, REFERENCES,
-- TRIGGER) a anon e authenticated em toda tabela nova de public. Por isso
-- REVOKE ALL dos dois e GRANT SELECT de volta só para authenticated —
-- revogar só insert/update/delete deixaria TRUNCATE aberto.
--
-- Separado da fase 1b (colunas em configuracoes): os FKs pegam
-- ShareRowExclusive em tenants/whatsapp_instances e o ALTER de configuracoes
-- pega AccessExclusive — numa transação só, risco de deadlock (ver 15/09).
-- =============================================================================

begin;
set local lock_timeout = '5s';

create table if not exists public.whatsapp_message_pricing (
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  message_id     text        not null,  -- wamid = whatsapp_messages.message_id
  instance_id    uuid        references public.whatsapp_instances(id) on delete set null,
  billable       boolean     not null,
  pricing_model  text,
  category       text,
  pricing_type   text,
  pricing_raw    jsonb,
  billed_at      timestamptz not null,
  created_at     timestamptz not null default now(),
  primary key (tenant_id, message_id)
);
create index if not exists idx_wmp_tenant_instance_billed
  on public.whatsapp_message_pricing (tenant_id, instance_id, billed_at);

alter table public.whatsapp_message_pricing enable row level security;
drop policy if exists wmp_select on public.whatsapp_message_pricing;
create policy wmp_select on public.whatsapp_message_pricing
  for select to authenticated
  using ((tenant_id = public.current_tenant_id() and public.is_admin_or_head()) or public.is_super_admin());

revoke all on public.whatsapp_message_pricing from public, anon, authenticated;
grant select on public.whatsapp_message_pricing to authenticated;
grant all on public.whatsapp_message_pricing to service_role;

commit;
