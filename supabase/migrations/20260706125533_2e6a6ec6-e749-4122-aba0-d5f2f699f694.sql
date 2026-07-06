
DROP POLICY IF EXISTS support_attendances_select ON public.support_attendances;

CREATE POLICY support_attendances_select ON public.support_attendances
  FOR SELECT
  USING (
    (SELECT is_admin_or_head())
    OR (
      tenant_id = (SELECT current_tenant_id())
      AND (
        department_id = (SELECT current_user_department_id())
        OR department_id IS NULL
      )
    )
  );
