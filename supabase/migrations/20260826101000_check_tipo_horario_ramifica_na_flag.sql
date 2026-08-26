-- CORREÇÃO da 20260825124000 (mesmo defeito C2 da 20260826100000, outra função).
--
-- check_tipo_horario passou a chamar fn_instante_fora_comercial SEMPRE, e com a
-- flag desligada isso mudava o número de dois jeitos:
--
--   1. o p_department_id era ignorado, perdendo o override de
--      support_departments.business_hours (10 setores em produção);
--   2. fn_instante_fora_comercial mede pela JANELA DO DIA (primeira abertura à
--      última fechadura), enquanto is_within_business_hours mede SLOT A SLOT.
--      Com almoço 12:00-13:30, is_within_business_hours diz que 12:45 está FORA
--      e a janela do dia diz que está DENTRO. Não é detalhe: é classificação de
--      ticket de tenant que não pediu nada.
--
-- Por isso o fallback desta função NÃO pode ser o de fn_atendimento_plantao_em
-- (que mede pela janela do dia, com tolerância) nem morar dentro de
-- fn_instante_fora_comercial. Cada chamador ramifica no seu.
--
-- Com a flag OFF o RETURN é LITERALMENTE o de antes de 25/08/2026.
-- Assinatura inalterada.
CREATE OR REPLACE FUNCTION public.check_tipo_horario(p_department_id uuid, p_at timestamp with time zone DEFAULT now(), p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant       uuid;
  v_user_tenant  uuid;
  v_hc_on        boolean := false;
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

  SELECT COALESCE(c.horario_comercial_enabled, false) INTO v_hc_on
  FROM public.configuracoes c
  WHERE c.tenant_id = v_tenant;
  v_hc_on := COALESCE(v_hc_on, false);

  IF v_hc_on THEN
    -- Cadastrou janela comercial: mesma régua do chat (fn_atendimento_plantao_em),
    -- nível tenant, tolerância de 5 min. p_department_id não se aplica — a janela
    -- comercial é do tenant, por decisão do owner.
    RETURN CASE
      WHEN public.fn_instante_fora_comercial(v_tenant, COALESCE(p_at, now()), 5)
      THEN 'plantao'
      ELSE 'comercial'
    END;
  ELSE
    -- Não cadastrou: comportamento idêntico ao de antes de 25/08/2026,
    -- inclusive o override de horário por setor.
    RETURN CASE
      WHEN public.is_within_business_hours(v_tenant, p_department_id, COALESCE(p_at, now()))
      THEN 'comercial'
      ELSE 'plantao'
    END;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) TO authenticated, service_role;
