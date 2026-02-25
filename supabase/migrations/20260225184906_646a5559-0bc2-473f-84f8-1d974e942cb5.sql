
-- Função self-serve: cria tenant + profile no primeiro acesso
CREATE OR REPLACE FUNCTION public.create_tenant_for_new_user(p_nome text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Se já tem profile, retorna tenant existente
  SELECT tenant_id INTO v_tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  INSERT INTO public.tenants(nome, plano, status)
  VALUES (coalesce(nullif(trim(p_nome), ''), 'Minha Empresa'), 'trial', 'ativo')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles(user_id, tenant_id, role, is_super_admin, status)
  VALUES (auth.uid(), v_tenant_id, 'admin', false, 'ativo');

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_for_new_user(text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_tenant_for_new_user(text) TO authenticated;
