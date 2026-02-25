
CREATE OR REPLACE FUNCTION public.create_tenant_for_new_user(p_nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_nome text;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Se já tem profile, retorna tenant existente
  SELECT tenant_id INTO v_tenant_id FROM public.profiles WHERE user_id = v_user_id LIMIT 1;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Sanitize and validate tenant name
  v_nome := coalesce(nullif(trim(p_nome), ''), 'Minha Empresa');
  
  IF length(v_nome) > 100 THEN
    RAISE EXCEPTION 'Tenant name too long (max 100 characters)';
  END IF;

  INSERT INTO public.tenants(nome, plano, status)
  VALUES (v_nome, 'trial', 'ativo')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles(user_id, tenant_id, role, is_super_admin, status)
  VALUES (v_user_id, v_tenant_id, 'admin', false, 'ativo');

  RETURN v_tenant_id;
END;
$$;
