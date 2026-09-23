-- DEM-0446: líder de setor (role 'head') passa a poder manter as regras de Atribuição.
--
-- Até aqui as tres policies de escrita exigiam is_tenant_admin() (role = 'admin').
-- Para um head a tela abria normalmente (o RBAC dá view em cfg.distribuicao), mas o
-- UPDATE afetava 0 linhas e o .single() do PostgREST devolvia
-- "Cannot coerce the result to a single JSON object" na cara do usuário.
--
-- is_tenant_admin_or_head() já existe e já é usada em outras policies do projeto.
-- A trava de tenant (membro ativo + tenant_id = current_tenant_id()) não muda.

alter policy assignment_rules_admin_update on public.assignment_rules
  using (
    (
      (select public.is_super_admin())
      or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  )
  with check (
    (
      (select public.is_super_admin())
      or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );

alter policy assignment_rules_admin_insert on public.assignment_rules
  with check (
    (
      (select public.is_super_admin())
      or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );

alter policy assignment_rules_admin_delete on public.assignment_rules
  using (
    (
      (select public.is_super_admin())
      or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );
