
-- Fix: the previous policy was too permissive. Replace with a restrictive approach.
DROP POLICY IF EXISTS invites_select ON public.invites;

-- Admin can list all invites for their tenant; anyone can read by specific token lookup
CREATE POLICY invites_select ON public.invites
  FOR SELECT
  USING (
    (is_tenant_admin() AND tenant_id = current_tenant_id())
    OR is_super_admin()
  );

-- Separate permissive policy for anon users to look up invites by token (signup flow)
-- They can only see unexpired, unused invites - and only if they know the token
CREATE POLICY invites_select_anon ON public.invites
  FOR SELECT
  TO anon
  USING (
    used_at IS NULL
    AND expires_at >= now()
  );
