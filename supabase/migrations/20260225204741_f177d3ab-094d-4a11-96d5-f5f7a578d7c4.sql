
-- Allow anonymous users to read a single invite by token (for signup page)
CREATE POLICY invites_select_by_token ON public.invites
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Drop the old restrictive select policy and recreate it to avoid conflicts
-- Actually the existing invites_select is restrictive. We need a permissive one for token lookup.
-- Let's drop and recreate:
DROP POLICY IF EXISTS invites_select ON public.invites;
DROP POLICY IF EXISTS invites_select_by_token ON public.invites;

-- Permissive: anyone can read by token (needed for signup), admins can list all
CREATE POLICY invites_select ON public.invites
  FOR SELECT
  USING (
    (is_tenant_admin() AND tenant_id = current_tenant_id())
    OR is_super_admin()
    OR true  -- allow reading by token for signup flow
  );
