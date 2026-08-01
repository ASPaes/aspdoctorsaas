-- Go-live previsto passa a sair da soma das etapas do trilho.
-- Antes lia onboarding_demand_types.sla_total_minutos: em 01/08, 7 dos 8 tipos estavam
-- em 0 (jornada nascia sem go-live) e o único preenchido prometia 5 dias úteis contra
-- um trilho bem maior configurado nas etapas. O campo do tipo de demanda vira
-- referência sem cálculo — é a metade "baseline" do padrão planejado-vs-comprometido.
--
-- A assinatura muda (3º parâmetro: produto, não tipo de demanda), então é DROP + CREATE.
-- Os dois callers do frontend vão no mesmo push.
--
-- Base: md5 e36f2ef18f9558b46e6f3d81e3143521, idêntico em local e produção em 01/08.

DROP FUNCTION IF EXISTS public.fn_journey_go_live(uuid, timestamptz, uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_journey_go_live(
  p_tenant_id uuid,
  p_start timestamptz,
  p_produto_id bigint,
  p_department_id uuid DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_min integer;
  v_days integer;
  v_tz text;
  v_start_date date;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  v_min := public.fn_onb_trilho_sla_min(p_tenant_id, p_produto_id);
  IF v_min IS NULL OR v_min <= 0 THEN
    RETURN NULL;
  END IF;

  -- base_dia_util_8h: 1 dia util = 480 minutos
  v_days := CEIL(v_min::numeric / 480.0)::int;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  v_start_date := (COALESCE(p_start, now()) AT TIME ZONE v_tz)::date;

  RETURN public.fn_add_business_days(v_start_date, v_days, p_tenant_id, p_department_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid)
  TO authenticated, service_role;

COMMENT ON COLUMN public.onboarding_demand_types.sla_total_minutos IS
  'Prazo prometido (referência). NÃO gera go-live — serve para a config acusar divergência contra a soma das etapas do trilho.';
