-- Card "Não Atendido" (aba Velocidade/SLA) contava assumed_at IS NULL, ou seja
-- "ninguém clicou em assumir" — não "o time não respondeu". Onde o operador
-- responde pelo próprio WhatsApp (Look Sistemas), o atendimento real caía no
-- card: 134 dos 169 tinham msg_agent_count > 0.
-- Passa a usar a MESMA regra que a lista (get_atendimento_nao_atendidos) já
-- aplica no motivo 'sem_resposta': sem assumir, sem ticket e sem mensagem do
-- time. A saudação automática não entra em msg_agent_count (verificado).
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_sla_frt_seconds integer DEFAULT 900, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_unids  bigint[];
  v_result jsonb;
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

  WITH base AS (
    SELECT sa.wait_seconds, sa.first_response_time_seconds, sa.handle_seconds,
           sa.first_response_business_seconds,
           sa.opened_at, sa.closed_at, sa.department_id, sa.assumed_at,
           sa.ticket_id, sa.created_from,
           COALESCE(sa.msg_agent_count, 0) AS msg_agent_count,
           COALESCE(sa.plantao, false) AS plantao,
           (COALESCE(sa.wait_seconds,0) + COALESCE(sa.handle_seconds,0))::int AS resol_seconds
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed' AND sa.closed_reason IS DISTINCT FROM 'ura_autoatendimento'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  vacuo AS (
    SELECT * FROM base
    WHERE assumed_at IS NULL
      AND ticket_id IS NULL
      AND created_from IS DISTINCT FROM 'ticket'
      AND msg_agent_count = 0
  )
  SELECT jsonb_build_object(
    'total_encerrados', (SELECT count(*) FROM base),
    'tme_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_seconds))::int FROM base WHERE wait_seconds > 0 AND wait_seconds <= kpi_cap_seconds('tme')),
    'tme_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY wait_seconds))::int FROM base WHERE wait_seconds > 0 AND wait_seconds <= kpi_cap_seconds('tme')),
    'frt_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_time_seconds))::int FROM base WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= kpi_cap_seconds('frt')),
    'frt_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY first_response_time_seconds))::int FROM base WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= kpi_cap_seconds('frt')),
    'tma_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY handle_seconds))::int FROM base WHERE handle_seconds > 0 AND handle_seconds <= kpi_cap_seconds('tma')),
    'tma_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY handle_seconds))::int FROM base WHERE handle_seconds > 0 AND handle_seconds <= kpi_cap_seconds('tma')),
    'tmr_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY resol_seconds))::int FROM base WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')),
    'tmr_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY resol_seconds))::int FROM base WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')),
    'sla_frt_seconds', p_sla_frt_seconds,
    'sla_total',  (SELECT count(*) FROM base WHERE first_response_time_seconds > 0),
    'sla_dentro', (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds),
    'sla_pct', (SELECT CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0) > 0
                  THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds)
                             / count(*) FILTER (WHERE first_response_time_seconds > 0), 1)
                  ELSE NULL END FROM base),
    'sla_util_total',  (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL),
    'sla_util_dentro', (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL AND first_response_business_seconds <= p_sla_frt_seconds),
    'sla_util_pct', (SELECT CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL) > 0
                  THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL AND first_response_business_seconds <= p_sla_frt_seconds)
                             / count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL), 1)
                  ELSE NULL END FROM base),
    'fora_horario', (SELECT count(*) FROM base WHERE plantao),
    'nao_atendido', (SELECT count(*) FROM vacuo),
    'nao_atendido_pct', (SELECT CASE WHEN (SELECT count(*) FROM base) > 0
                  THEN ROUND(100.0 * (SELECT count(*) FROM vacuo) / (SELECT count(*) FROM base), 1) ELSE NULL END),
    'por_departamento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                'department_id', d.department_id, 'nome', d.nome,
                'total', d.total, 'dentro', d.dentro,
                'alvo_seconds', d.alvo_seconds,
                'pct', CASE WHEN d.total > 0 THEN ROUND(100.0 * d.dentro / d.total, 1) ELSE NULL END)
              ORDER BY d.total DESC)
      FROM (
        SELECT b.department_id, sd.name AS nome,
               COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds) AS alvo_seconds,
               count(*) FILTER (WHERE b.first_response_time_seconds > 0) AS total,
               count(*) FILTER (WHERE b.first_response_time_seconds > 0
                                  AND b.first_response_time_seconds <= COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds)) AS dentro
        FROM base b LEFT JOIN support_departments sd ON sd.id = b.department_id
        GROUP BY b.department_id, sd.name, COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds)
      ) d
      WHERE d.total > 0
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
