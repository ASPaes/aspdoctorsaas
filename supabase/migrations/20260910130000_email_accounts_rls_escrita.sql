-- ============================================================================
-- email_accounts: separar leitura de escrita no RLS
--
-- A policy que subiu em 20260910120000 era `for all` para qualquer membro ativo
-- do tenant. Isso deixava um operador (role 'user') apagar ou alterar conta de
-- e-mail direto pelo PostgREST, contornando a checagem de papel que existe
-- dentro das RPCs. Ver não é problema; escrever é.
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- ============================================================================

begin;

drop policy if exists email_accounts_tenant_rw on public.email_accounts;

-- leitura: qualquer membro ativo do tenant
drop policy if exists email_accounts_tenant_select on public.email_accounts;
create policy email_accounts_tenant_select on public.email_accounts
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

-- escrita: só admin ou head do próprio tenant (e super admin)
drop policy if exists email_accounts_tenant_insert on public.email_accounts;
create policy email_accounts_tenant_insert on public.email_accounts
  for insert to authenticated
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_accounts_tenant_update on public.email_accounts;
create policy email_accounts_tenant_update on public.email_accounts
  for update to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_accounts_tenant_delete on public.email_accounts;
create policy email_accounts_tenant_delete on public.email_accounts
  for delete to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  );

commit;
