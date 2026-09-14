-- Feriado/folga por setor: a exceção do setor VENCE a geral na mesma data.
--
-- Contexto: a Digi Office precisou, em 07/09, fechar Onboarding e Implantação
-- enquanto o Suporte atendia em plantão. A coluna department_id já existe, mas
-- o unique (tenant_id, date) impede uma geral + uma por setor na mesma data.
-- Antes de liberar isso (migration seguinte), as funções precisam escolher UMA
-- exceção por dia com a precedência certa. Hoje três delas usam
-- "EXISTS alguma fechada entre a do setor e a geral": com a geral fechada e o
-- setor aberto, o setor continuaria fechado.
--
-- Regra única, igual à de is_within_business_hours, fn_expediente_janela_do_dia
-- e _shared/business-hours.ts:
--   exceção efetiva = a do setor, se existir; senão a geral.
--
-- Só CREATE OR REPLACE: nenhuma tabela é travada. Assinaturas, SECURITY DEFINER,
-- search_path e grants iguais aos de produção (conferidos em 13/09/2026).

-- ── segundos_uteis ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.segundos_uteis(p_start timestamp with time zone, p_end timestamp with time zone, p_tenant_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_bh jsonb;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day date;
  v_dow text;
  v_total integer := 0;
  v_slots jsonb;
  v_slot jsonb;
  v_seg_start timestamp;
  v_seg_end timestamp;
  v_is_closed boolean;
  dow_map text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo')
    INTO v_tz FROM configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  SELECT business_hours INTO v_bh
  FROM support_departments
  WHERE id = p_department_id AND tenant_id = p_tenant_id AND business_hours_enabled = true;

  IF v_bh IS NULL THEN
    SELECT business_hours INTO v_bh
    FROM configuracoes
    WHERE tenant_id = p_tenant_id AND business_hours_enabled = true;
  END IF;

  IF v_bh IS NULL THEN
    RETURN EXTRACT(EPOCH FROM (p_end - p_start))::int;
  END IF;

  v_start_local := p_start AT TIME ZONE v_tz;
  v_end_local := p_end AT TIME ZONE v_tz;
  v_day := v_start_local::date;

  WHILE v_day <= v_end_local::date LOOP
    v_dow := dow_map[EXTRACT(DOW FROM v_day)::int + 1];

    -- Exceção do setor vence a geral.
    v_is_closed := COALESCE((
      SELECT e.is_closed FROM business_hours_exceptions e
      WHERE e.tenant_id = p_tenant_id AND e.date = v_day
        AND (e.department_id = p_department_id OR e.department_id IS NULL)
      ORDER BY (e.department_id IS NOT NULL) DESC
      LIMIT 1
    ), false);

    IF NOT v_is_closed AND COALESCE((v_bh -> v_dow ->> 'active')::boolean, false) THEN
      v_slots := v_bh -> v_dow -> 'slots';
      IF v_slots IS NULL OR jsonb_typeof(v_slots) <> 'array' OR jsonb_array_length(v_slots) = 0 THEN
        IF (v_bh -> v_dow ->> 'start') IS NOT NULL AND (v_bh -> v_dow ->> 'end') IS NOT NULL THEN
          v_slots := jsonb_build_array(jsonb_build_object('start', v_bh -> v_dow ->> 'start', 'end', v_bh -> v_dow ->> 'end'));
        ELSE
          v_slots := '[]'::jsonb;
        END IF;
      END IF;

      FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
        v_seg_start := GREATEST(v_start_local, v_day + (v_slot ->> 'start')::time);
        v_seg_end   := LEAST(v_end_local,   v_day + (v_slot ->> 'end')::time);
        IF v_seg_end > v_seg_start THEN
          v_total := v_total + EXTRACT(EPOCH FROM (v_seg_end - v_seg_start))::int;
        END IF;
      END LOOP;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN v_total;
END;
$function$;

-- ── fn_add_business_days ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_add_business_days(p_start date, p_days integer, p_tenant_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bh jsonb;
  v_day date := p_start;
  v_added int := 0;
  v_dow text;
  v_active boolean;
  v_is_closed boolean;
  v_guard int := 0;
  dow_map text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_start IS NULL OR p_days IS NULL OR p_days <= 0 THEN
    RETURN p_start;
  END IF;

  SELECT business_hours INTO v_bh
  FROM support_departments
  WHERE id = p_department_id AND tenant_id = p_tenant_id AND business_hours_enabled = true;

  IF v_bh IS NULL THEN
    SELECT business_hours INTO v_bh
    FROM configuracoes
    WHERE tenant_id = p_tenant_id AND business_hours_enabled = true;
  END IF;

  WHILE v_added < p_days AND v_guard < 3650 LOOP
    v_guard := v_guard + 1;
    v_day := v_day + 1;
    v_dow := dow_map[EXTRACT(DOW FROM v_day)::int + 1];

    -- Exceção do setor vence a geral.
    v_is_closed := COALESCE((
      SELECT e.is_closed FROM business_hours_exceptions e
      WHERE e.tenant_id = p_tenant_id AND e.date = v_day
        AND (e.department_id = p_department_id OR e.department_id IS NULL)
      ORDER BY (e.department_id IS NOT NULL) DESC
      LIMIT 1
    ), false);

    IF v_bh IS NULL THEN
      -- sem expediente configurado: seg-sex por padrao
      v_active := EXTRACT(DOW FROM v_day) BETWEEN 1 AND 5;
    ELSE
      v_active := COALESCE((v_bh -> v_dow ->> 'active')::boolean, false);
    END IF;

    IF v_active AND NOT v_is_closed THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RETURN v_day;
END;
$function$;

-- ── fn_business_due_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_business_due_at(p_start timestamp with time zone, p_minutes_uteis integer, p_tenant_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_bh jsonb;
  v_target_sec integer;
  v_acc integer := 0;
  v_start_local timestamp;
  v_day date;
  v_dow text;
  v_slots jsonb;
  v_slot jsonb;
  v_seg_start timestamp;
  v_seg_end timestamp;
  v_dur integer;
  v_is_closed boolean;
  v_max_days int := 60;
  dow_map text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_start IS NULL OR p_minutes_uteis IS NULL OR p_minutes_uteis <= 0 THEN
    RETURN NULL;
  END IF;
  v_target_sec := p_minutes_uteis * 60;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo')
    INTO v_tz FROM configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  SELECT business_hours INTO v_bh
  FROM support_departments
  WHERE id = p_department_id AND tenant_id = p_tenant_id AND business_hours_enabled = true;

  IF v_bh IS NULL THEN
    SELECT business_hours INTO v_bh
    FROM configuracoes
    WHERE tenant_id = p_tenant_id AND business_hours_enabled = true;
  END IF;

  -- Sem expediente configurado: tempo corrido (consistente com segundos_uteis)
  IF v_bh IS NULL THEN
    RETURN p_start + make_interval(secs => v_target_sec);
  END IF;

  v_start_local := p_start AT TIME ZONE v_tz;
  v_day := v_start_local::date;

  FOR i IN 0..v_max_days LOOP
    v_dow := dow_map[EXTRACT(DOW FROM v_day)::int + 1];

    -- Exceção do setor vence a geral.
    v_is_closed := COALESCE((
      SELECT e.is_closed FROM business_hours_exceptions e
      WHERE e.tenant_id = p_tenant_id AND e.date = v_day
        AND (e.department_id = p_department_id OR e.department_id IS NULL)
      ORDER BY (e.department_id IS NOT NULL) DESC
      LIMIT 1
    ), false);

    IF NOT v_is_closed AND COALESCE((v_bh -> v_dow ->> 'active')::boolean, false) THEN
      v_slots := v_bh -> v_dow -> 'slots';
      IF v_slots IS NULL OR jsonb_typeof(v_slots) <> 'array' OR jsonb_array_length(v_slots) = 0 THEN
        IF (v_bh -> v_dow ->> 'start') IS NOT NULL AND (v_bh -> v_dow ->> 'end') IS NOT NULL THEN
          v_slots := jsonb_build_array(jsonb_build_object('start', v_bh -> v_dow ->> 'start', 'end', v_bh -> v_dow ->> 'end'));
        ELSE
          v_slots := '[]'::jsonb;
        END IF;
      END IF;

      FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
        v_seg_start := GREATEST(v_start_local, v_day + (v_slot ->> 'start')::time);
        v_seg_end   := v_day + (v_slot ->> 'end')::time;
        IF v_seg_end > v_seg_start THEN
          v_dur := EXTRACT(EPOCH FROM (v_seg_end - v_seg_start))::int;
          IF v_acc + v_dur >= v_target_sec THEN
            RETURN (v_seg_start + make_interval(secs => (v_target_sec - v_acc))) AT TIME ZONE v_tz;
          END IF;
          v_acc := v_acc + v_dur;
        END IF;
      END LOOP;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN NULL;
END;
$function$;

-- ── fn_onb_util_min ────────────────────────────────────────────────────────
-- O desconto do feriado reduzido (20260911180000) passa a olhar só a exceção
-- efetiva do dia. Antes, uma geral "reduzido" descontaria o dia mesmo com o
-- setor marcado "aberto", e duas reduzidas na mesma data descontariam 2x.
CREATE OR REPLACE FUNCTION public.fn_onb_util_min(p_start timestamp with time zone, p_end timestamp with time zone, p_tenant_id uuid, p_department_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tz AS (
    SELECT COALESCE(
      (SELECT business_hours_timezone FROM public.configuracoes WHERE tenant_id = p_tenant_id),
      'America/Sao_Paulo') AS v
  ), tem_expediente AS (
    -- mesma cascata de segundos_uteis: setor -> global do tenant
    SELECT EXISTS (
             SELECT 1 FROM public.support_departments
              WHERE id = p_department_id AND tenant_id = p_tenant_id
                AND business_hours_enabled = true AND business_hours IS NOT NULL)
        OR EXISTS (
             SELECT 1 FROM public.configuracoes
              WHERE tenant_id = p_tenant_id
                AND business_hours_enabled = true AND business_hours IS NOT NULL) AS v
  ), efetiva AS (
    -- uma exceção por dia: a do setor vence a geral
    SELECT DISTINCT ON (e.date) e.date, e.is_closed, e.use_template
      FROM public.business_hours_exceptions e, tz
     WHERE e.tenant_id = p_tenant_id
       AND (e.department_id = p_department_id OR e.department_id IS NULL)
       AND e.date BETWEEN (p_start AT TIME ZONE tz.v)::date AND (p_end AT TIME ZONE tz.v)::date
     ORDER BY e.date, (e.department_id IS NOT NULL) DESC
  ), reduzido AS (
    SELECT GREATEST(p_start, e.date::timestamp AT TIME ZONE tz.v)      AS ini,
           LEAST(p_end, (e.date + 1)::timestamp AT TIME ZONE tz.v)     AS fim
      FROM efetiva e, tz, tem_expediente x
     WHERE x.v
       AND e.use_template = true
       AND e.is_closed = false
  )
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0
    ELSE (GREATEST(0,
            public.segundos_uteis(p_start, p_end, p_tenant_id, p_department_id)
            - COALESCE((SELECT SUM(public.segundos_uteis(r.ini, r.fim, p_tenant_id, p_department_id))
                          FROM reduzido r), 0)
          ) / 60)::integer
  END;
$function$;

-- ── fn_is_business_hours ───────────────────────────────────────────────────
-- Pergunta do TENANT (usada por fn_assign_conversation_if_ready). Antes lia
-- "qualquer exceção do dia" com LIMIT 1 sem ordem: com a Implantação fechada
-- num dia, podia pegar essa linha e responder "fechado" para a empresa toda.
-- Agora só a exceção geral decide aqui.
CREATE OR REPLACE FUNCTION public.fn_is_business_hours(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled BOOLEAN;
  v_timezone TEXT;
  v_business_hours JSONB;
  v_now_local TIMESTAMPTZ;
  v_today_date DATE;
  v_day_key TEXT;
  v_current_time TIME;
  v_day_config JSONB;
  v_slot JSONB;
  v_exception RECORD;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN true; -- sem tenant, assume 24/7
  END IF;

  SELECT business_hours_enabled,
         COALESCE(business_hours_timezone, 'America/Sao_Paulo'),
         business_hours
    INTO v_enabled, v_timezone, v_business_hours
  FROM public.configuracoes
  WHERE tenant_id = p_tenant_id
  LIMIT 1;

  -- Se tenant não tem configuracoes OU business_hours_enabled=false -> 24/7 (Opção A)
  IF v_enabled IS NULL OR v_enabled = false THEN
    RETURN true;
  END IF;

  -- Se habilitado mas sem JSONB -> seguro: 24/7
  IF v_business_hours IS NULL OR v_business_hours = '{}'::jsonb THEN
    RETURN true;
  END IF;

  -- Calcular hora/dia no timezone do tenant
  v_now_local := now() AT TIME ZONE v_timezone;
  v_today_date := (v_now_local::timestamp)::date;
  v_current_time := (v_now_local::timestamp)::time;

  -- Checar exceções (feriados etc.). Só a geral: exceção de setor não fecha o tenant.
  SELECT is_closed INTO v_exception
  FROM public.business_hours_exceptions
  WHERE tenant_id = p_tenant_id
    AND date = v_today_date
    AND department_id IS NULL
  LIMIT 1;

  IF FOUND AND v_exception.is_closed = true THEN
    RETURN false;
  END IF;

  -- Mapear dia da semana (extract dow no timezone local)
  v_day_key := CASE EXTRACT(DOW FROM v_now_local AT TIME ZONE v_timezone)::INT
    WHEN 0 THEN 'sun'
    WHEN 1 THEN 'mon'
    WHEN 2 THEN 'tue'
    WHEN 3 THEN 'wed'
    WHEN 4 THEN 'thu'
    WHEN 5 THEN 'fri'
    WHEN 6 THEN 'sat'
  END;

  v_day_config := v_business_hours -> v_day_key;

  -- Dia não configurado ou inativo
  IF v_day_config IS NULL OR COALESCE((v_day_config->>'active')::BOOLEAN, false) = false THEN
    RETURN false;
  END IF;

  -- Verificar se hora atual cai em algum slot ativo
  FOR v_slot IN SELECT * FROM jsonb_array_elements(v_day_config->'slots') LOOP
    IF v_current_time >= (v_slot->>'start')::TIME
       AND v_current_time < (v_slot->>'end')::TIME THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
EXCEPTION
  WHEN OTHERS THEN
    -- Qualquer erro inesperado: fail-open (permite distribuição)
    RAISE LOG '[fn_is_business_hours] Erro para tenant %: %', p_tenant_id, SQLERRM;
    RETURN true;
END;
$function$;

-- Grants explícitos (CREATE OR REPLACE preserva, mas o padrão do projeto é declarar).
REVOKE ALL ON FUNCTION public.segundos_uteis(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_add_business_days(date, integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_business_due_at(timestamptz, integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_is_business_hours(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segundos_uteis(timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_add_business_days(date, integer, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_business_due_at(timestamptz, integer, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_business_hours(uuid) TO authenticated, service_role;
