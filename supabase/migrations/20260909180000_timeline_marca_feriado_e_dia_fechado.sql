-- O gráfico "Tendência diária" mergulhava para 0% em feriado e domingo. Não era
-- "dia sem atendimento" (aí a RPC já devolve NULL e o ponto some): era UM chat
-- decidindo o dia. Na ASP, 07/09 teve 2 atendimentos, 1 medido, fora do alvo.
--
-- A RPC passa a marcar o dia como fechado; quem decide não desenhar é o gráfico.
-- Os cartões do topo continuam contando o feriado — ele sai só da linha.
--
-- A precedência é a MESMA de segundos_uteis, de propósito: exceção de data
-- (feriado/fechamento) vence; senão, o dia da semana inativo no horário do setor
-- e, na falta dele, no da empresa. Duplicar essa regra com outro critério criaria
-- duas verdades sobre "a empresa estava aberta?".
--
-- Não resolve tudo, e isso é decisão do owner: sábado é dia útil no cadastro da
-- maioria dos tenants, então sábado de pouco movimento continua desenhando pico
-- de 100% ou queda de 57%. A causa real é amostra pequena, não calendário.
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade_timeline(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_department_id uuid DEFAULT NULL::uuid, p_sla_frt_seconds integer DEFAULT 900, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_trunc text;
  v_result jsonb;
  v_bh jsonb;
  v_por_dia boolean;
  dow_map text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_trunc := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;
  -- Semana engloba dia aberto e fechado; a marca só faz sentido no bucket diário.
  v_por_dia := (v_trunc = 'day');

  -- Horário vigente: o do setor filtrado, se ele tiver o próprio; senão o da
  -- empresa. NULL = ninguém configurou expediente, então nenhum dia é "fechado".
  SELECT business_hours INTO v_bh
  FROM support_departments
  WHERE id = p_department_id AND tenant_id = v_tenant AND business_hours_enabled = true;

  IF v_bh IS NULL THEN
    SELECT business_hours INTO v_bh
    FROM configuracoes
    WHERE tenant_id = v_tenant AND business_hours_enabled = true;
  END IF;

  WITH base AS (
    SELECT
      date_trunc(v_trunc, (sa.opened_at AT TIME ZONE 'America/Sao_Paulo'))::date AS bucket,
      sa.wait_seconds, sa.first_response_time_seconds,
      (COALESCE(sa.wait_seconds,0) + COALESCE(sa.handle_seconds,0))::int AS resol_seconds
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'bucket', to_char(g.bucket,'YYYY-MM-DD'),
             'volume', g.volume,
             'sla_total', g.sla_total,
             'sla_dentro', g.sla_dentro,
             'sla_pct', g.sla_pct,
             'tme_p50', g.tme_p50,
             'frt_p50', g.frt_p50,
             'tmr_p50', g.tmr_p50,
             'dia_fechado', COALESCE(f.fechado, false),
             'fechado_motivo', f.motivo
           ) ORDER BY g.bucket
         ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      bucket,
      count(*) AS volume,
      count(*) FILTER (WHERE first_response_time_seconds > 0) AS sla_total,
      count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds) AS sla_dentro,
      CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0) > 0
        THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds)
                   / count(*) FILTER (WHERE first_response_time_seconds > 0), 1)
        ELSE NULL END AS sla_pct,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_seconds) FILTER (WHERE wait_seconds > 0 AND wait_seconds <= kpi_cap_seconds('tme')))::int AS tme_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_time_seconds) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= kpi_cap_seconds('frt')))::int AS frt_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY resol_seconds) FILTER (WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')))::int AS tmr_p50
    FROM base
    GROUP BY bucket
  ) g
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(exc.id IS NOT NULL, false)
        OR (v_bh IS NOT NULL
            AND NOT COALESCE((v_bh -> dow_map[EXTRACT(DOW FROM g.bucket)::int + 1] ->> 'active')::boolean, false))
        AS fechado,
      CASE
        WHEN exc.id IS NOT NULL THEN COALESCE(NULLIF(btrim(exc.name), ''), 'Feriado')
        WHEN v_bh IS NOT NULL
         AND NOT COALESCE((v_bh -> dow_map[EXTRACT(DOW FROM g.bucket)::int + 1] ->> 'active')::boolean, false)
         THEN 'Fora do expediente'
        ELSE NULL
      END AS motivo
    FROM (SELECT 1) _
    LEFT JOIN LATERAL (
      SELECT e.id, e.name
      FROM business_hours_exceptions e
      WHERE e.tenant_id = v_tenant
        AND e.date = g.bucket
        AND e.is_closed = true
        AND (e.department_id = p_department_id OR e.department_id IS NULL)
      -- Exceção do setor vence a global quando as duas existem.
      ORDER BY (e.department_id IS NULL)
      LIMIT 1
    ) exc ON true
    WHERE v_por_dia
  ) f ON true;

  RETURN v_result;
END;
$function$;
