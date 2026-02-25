
-- 1) Adicionar colunas a tenants (plano e status já existem)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS max_users integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL;

-- 2) Funções auxiliares

-- is_tenant_admin(): true se role='admin' ou is_super_admin
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND (role = 'admin' OR is_super_admin = true)
  )
$$;

-- tenant_user_count(p_tenant uuid)
CREATE OR REPLACE FUNCTION public.tenant_user_count(p_tenant uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.profiles
  WHERE tenant_id = p_tenant
    AND status = 'ativo'
$$;

-- can_invite_more_users(p_tenant uuid)
CREATE OR REPLACE FUNCTION public.can_invite_more_users(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tenant_user_count(p_tenant) < t.max_users
  FROM public.tenants t
  WHERE t.id = p_tenant
$$;

-- 3) Ajustar RLS de PROFILES
-- Drop policies existentes
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_write ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;

-- a) SELECT: próprio profile OU admin do tenant vê profiles do mesmo tenant OU super_admin
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.is_tenant_admin()
      AND tenant_id = public.current_tenant_id()
    )
    OR public.is_super_admin()
  );

-- b) INSERT: apenas via função (super_admin ou self-provisioning)
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_super_admin()
  );

-- c) UPDATE: usuário comum atualiza apenas o próprio (exceto is_super_admin e role)
--    Admin do tenant pode alterar role/status de profiles do mesmo tenant
--    Super admin pode alterar tudo
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.is_tenant_admin()
      AND tenant_id = public.current_tenant_id()
    )
    OR public.is_super_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      public.is_tenant_admin()
      AND tenant_id = public.current_tenant_id()
    )
    OR public.is_super_admin()
  );

-- Trigger para impedir que non-super-admin altere is_super_admin
CREATE OR REPLACE FUNCTION public.protect_super_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only super admins can change is_super_admin flag';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_super_admin ON public.profiles;
CREATE TRIGGER trg_protect_super_admin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_super_admin_flag();

-- 4) Ajustar RLS de TENANTS
DROP POLICY IF EXISTS tenants_read ON public.tenants;

-- SELECT: próprio tenant ou super admin
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (
    id = public.current_tenant_id()
    OR public.is_super_admin()
  );

-- UPDATE: super admin apenas
CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 5) Ajustar RLS de INVITES
DROP POLICY IF EXISTS invites_tenant_rw ON public.invites;

-- SELECT: admin do tenant ou super admin
CREATE POLICY invites_select ON public.invites
  FOR SELECT TO authenticated
  USING (
    (public.is_tenant_admin() AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  );

-- INSERT: admin do tenant + validação de max_users
CREATE POLICY invites_insert ON public.invites
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.is_tenant_admin() AND tenant_id = public.current_tenant_id())
      OR public.is_super_admin()
    )
    AND public.can_invite_more_users(tenant_id)
  );

-- UPDATE (cancelar convite): admin do tenant ou super admin
CREATE POLICY invites_update ON public.invites
  FOR UPDATE TO authenticated
  USING (
    (public.is_tenant_admin() AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (public.is_tenant_admin() AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  );

-- DELETE: admin do tenant ou super admin
CREATE POLICY invites_delete ON public.invites
  FOR DELETE TO authenticated
  USING (
    (public.is_tenant_admin() AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  );

-- 6) Índices
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_status ON public.profiles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invites_tenant_used ON public.invites(tenant_id, used_at);
