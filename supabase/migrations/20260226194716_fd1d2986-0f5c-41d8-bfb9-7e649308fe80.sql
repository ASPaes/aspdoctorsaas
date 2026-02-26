
-- 1. Create secure RPC to validate invite tokens (replaces anonymous table access)
CREATE OR REPLACE FUNCTION public.validate_invite_token(p_token uuid)
RETURNS TABLE(email text, role text, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT i.email, i.role, i.tenant_id
  FROM public.invites i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND i.expires_at >= now()
  LIMIT 1;
$$;

-- 2. Drop the overly permissive anonymous SELECT policy
DROP POLICY IF EXISTS invites_select_anon ON public.invites;

-- 3. Enable RLS on unprotected tables
ALTER TABLE public.clientes_csv_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_match_log ENABLE ROW LEVEL SECURITY;

-- 4. Add super-admin-only policies for staging/import tables
CREATE POLICY csv_map_super_only ON public.clientes_csv_map
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY match_log_super_only ON public.clientes_match_log
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
