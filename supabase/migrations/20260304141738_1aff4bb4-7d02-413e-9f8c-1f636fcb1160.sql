
-- 1. Add cnpj column to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cnpj text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_cnpj_unique ON public.tenants (cnpj) WHERE cnpj IS NOT NULL;

-- 2. Replace the RPC to accept cnpj + allowed_domain + audit
CREATE OR REPLACE FUNCTION public.create_tenant_for_new_user(
  p_nome text,
  p_cnpj text DEFAULT NULL,
  p_allowed_domain text DEFAULT NULL,
  p_plano text DEFAULT 'trial'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_nome text;
  v_cnpj text;
  v_domain text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- If already has profile, return existing tenant
  SELECT tenant_id INTO v_tenant_id FROM public.profiles WHERE user_id = v_user_id LIMIT 1;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Sanitize name
  v_nome := coalesce(nullif(trim(p_nome), ''), 'Minha Empresa');
  IF length(v_nome) > 100 THEN
    RAISE EXCEPTION 'Tenant name too long (max 100 characters)';
  END IF;

  -- Sanitize CNPJ (digits only)
  v_cnpj := nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');

  -- Check CNPJ uniqueness
  IF v_cnpj IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE cnpj = v_cnpj) THEN
    RAISE EXCEPTION 'CNPJ already registered';
  END IF;

  -- Sanitize domain
  v_domain := nullif(lower(trim(coalesce(p_allowed_domain, ''))), '');

  -- Create tenant
  INSERT INTO public.tenants(nome, cnpj, plano, status)
  VALUES (v_nome, v_cnpj, coalesce(nullif(trim(p_plano), ''), 'trial'), 'ativo')
  RETURNING id INTO v_tenant_id;

  -- Create profile
  INSERT INTO public.profiles(user_id, tenant_id, role, is_super_admin, status, access_status, allowed_domain)
  VALUES (v_user_id, v_tenant_id, 'admin', false, 'ativo', 'active', v_domain);

  -- Create default config
  INSERT INTO public.configuracoes(tenant_id) VALUES (v_tenant_id);

  -- Audit event
  INSERT INTO public.audit_events(tenant_id, actor_user_id, event_type, metadata)
  VALUES (v_tenant_id, v_user_id, 'TENANT_CREATED', jsonb_build_object(
    'nome', v_nome,
    'cnpj', v_cnpj,
    'allowed_domain', v_domain
  ));

  RETURN v_tenant_id;
END;
$$;
