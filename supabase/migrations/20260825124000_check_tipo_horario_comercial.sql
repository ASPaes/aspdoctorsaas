-- check_tipo_horario (RPC do modal de ticket, modo "auto") passa a responder
-- pela janela COMERCIAL (fn_instante_fora_comercial), a mesma régua que
-- fn_atendimento_plantao_em usa para o chat. Antes usava is_within_business_hours
-- (janela de disponibilidade), o que fazia ticket e chat divergirem.
-- Assinatura inalterada: p_department_id continua aceito e IGNORADO, para não
-- quebrar as duas chamadas do frontend que ainda não sabem da mudança.
CREATE OR REPLACE FUNCTION public.check_tipo_horario(p_department_id uuid, p_at timestamp with time zone DEFAULT now(), p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant       uuid;
  v_user_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_user_tenant
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF p_tenant_id IS NOT NULL
     AND (public.is_super_admin() OR p_tenant_id = v_user_tenant)
  THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := COALESCE(v_user_tenant, public.current_tenant_id());
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  -- p_department_id continua aceito por compatibilidade e é IGNORADO: a janela
  -- comercial é do tenant. Mesma régua do chat (fn_atendimento_plantao_em).
  RETURN CASE
    WHEN public.fn_instante_fora_comercial(v_tenant, COALESCE(p_at, now()))
    THEN 'plantao'
    ELSE 'comercial'
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) TO authenticated, service_role;
