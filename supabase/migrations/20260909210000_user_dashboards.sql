-- Painel pessoal do gestor ("Meu Painel"). Uma linha por usuário/tenant.
--
-- Descartamos guardar isso em user_preferences: é a tabela de preferências de
-- NOTIFICAÇÃO, com linha por (user_id, department_id) e a flag
-- prefer_department_overrides. O layout do painel não tem dimensão de setor —
-- ficaria ambíguo qual das linhas manda.
--
-- 100% aditiva: não lê, não altera e não referencia nenhuma tabela existente.

create table if not exists public.user_dashboards (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  user_id    uuid not null,
  layout     jsonb not null default '{"versao":1,"secoes":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_dashboards_tenant_user_key unique (tenant_id, user_id)
);

comment on table public.user_dashboards is
  'Layout do painel personalizado (Meu Painel). Pessoal: cada usuário só lê e escreve o seu.';

create index if not exists idx_user_dashboards_user
  on public.user_dashboards (user_id, tenant_id);

alter table public.user_dashboards enable row level security;

drop policy if exists user_dashboards_select on public.user_dashboards;
create policy user_dashboards_select on public.user_dashboards
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_insert on public.user_dashboards;
create policy user_dashboards_insert on public.user_dashboards
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_update on public.user_dashboards;
create policy user_dashboards_update on public.user_dashboards
  for update to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_delete on public.user_dashboards;
create policy user_dashboards_delete on public.user_dashboards
  for delete to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- Confirmado em pg_proc antes de escrever: a função existe com este nome.
drop trigger if exists trg_user_dashboards_updated_at on public.user_dashboards;
create trigger trg_user_dashboards_updated_at
  before update on public.user_dashboards
  for each row execute function public.set_updated_at();
