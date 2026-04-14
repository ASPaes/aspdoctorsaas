
DROP POLICY IF EXISTS "support_attendances_update_by_department" ON support_attendances;

CREATE POLICY "support_attendances_update_by_department"
  ON support_attendances
  FOR UPDATE
  USING (
    is_admin_or_head()
    OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_admin_or_head()
    OR (tenant_id = current_tenant_id() AND current_user_department_id() IS NOT NULL)
  );
