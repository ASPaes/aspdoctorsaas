CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      is_tenant_active_member()
      AND tenant_id = current_tenant_id()
      AND is_tenant_admin()
      AND user_id <> auth.uid()
    )
  );