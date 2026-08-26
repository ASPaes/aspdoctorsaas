-- Irmã de fn_expediente_janela_do_dia, lendo a janela COMERCIAL do tenant.
-- Sem parâmetro de setor: decisão do owner é cadastro só no nível do tenant.
-- Devolve as BORDAS DO DIA (min start, max end) — é sobre elas que a tolerância
-- vale. Por slot, o almoço da ASP viraria plantão no miolo da tarde.
CREATE OR REPLACE FUNCTION public.fn_janela_comercial_do_dia(
  p_tenant_id uuid,
  p_at        timestamptz
)
RETURNS TABLE(abre time, fecha time)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz         text;
  v_enabled    boolean;
  v_hours      jsonb;
  v_local_date date;
  v_local_dow  int;
  v_day_key    text;
  v_day        jsonb;
  v_exc        record;
  v_tpl        record;
BEGIN
  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo'),
         COALESCE(horario_comercial_enabled, false),
         COALESCE(horario_comercial, '{}'::jsonb)
    INTO v_tz, v_enabled, v_hours
  FROM public.configuracoes
  WHERE tenant_id = p_tenant_id;

  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  -- Não cadastrou: comportamento idêntico ao de antes de 25/08/2026.
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN QUERY
      SELECT j.abre, j.fecha
      FROM public.fn_expediente_janela_do_dia(p_tenant_id, NULL, p_at) j;
    RETURN;
  END IF;

  v_local_date := (p_at AT TIME ZONE v_tz)::date;
  v_local_dow  := extract(dow from (p_at AT TIME ZONE v_tz))::int;
  v_day_key    := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[v_local_dow + 1];

  -- Feriado. Só exceção do tenant: não existe janela comercial por setor.
  SELECT is_closed, use_template
    INTO v_exc
  FROM public.business_hours_exceptions
  WHERE tenant_id = p_tenant_id
    AND date = v_local_date
    AND department_id IS NULL
  LIMIT 1;

  IF COALESCE(v_exc.use_template, false) THEN
    SELECT open_at, close_at INTO v_tpl
    FROM public.tenant_holiday_template
    WHERE tenant_id = p_tenant_id;

    IF v_tpl.open_at IS NOT NULL AND v_tpl.close_at IS NOT NULL THEN
      RETURN QUERY SELECT v_tpl.open_at, v_tpl.close_at;
      RETURN;
    END IF;
  END IF;

  IF COALESCE(v_exc.is_closed, false) AND NOT COALESCE(v_exc.use_template, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  v_day := v_hours -> v_day_key;
  IF v_day IS NULL OR NOT COALESCE((v_day ->> 'active')::boolean, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  IF (v_day ? 'slots') AND jsonb_typeof(v_day -> 'slots') = 'array' THEN
    RETURN QUERY
      SELECT min((s ->> 'start')::time), max((s ->> 'end')::time)
      FROM jsonb_array_elements(v_day -> 'slots') s
      WHERE (s ->> 'start') IS NOT NULL AND (s ->> 'end') IS NOT NULL;
    RETURN;
  END IF;

  -- Formato antigo {start,end}: o parse do frontend ainda aceita, então aceite aqui.
  IF (v_day ? 'start') AND (v_day ? 'end') THEN
    RETURN QUERY SELECT (v_day ->> 'start')::time, (v_day ->> 'end')::time;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::time, NULL::time;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_janela_comercial_do_dia(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_janela_comercial_do_dia(uuid, timestamptz) TO authenticated, service_role;
