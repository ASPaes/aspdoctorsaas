-- ============================================================================
-- get_atendimento_velocidade: filtro de plantão (p_plantao)
--
-- Primeira das 11 RPCs get_atendimento_* que leem support_attendances a
-- receber o recorte. As outras 10 entram uma a uma.
--
-- DROP + CREATE porque a lista de argumentos muda. CREATE OR REPLACE criaria
-- uma SOBRECARGA (assinatura diferente) e o PostgREST passaria a não resolver
-- a chamada — 404 PGRST202, tela quebrada. Já aconteceu neste repo com
-- create_additional_ticket_from_attendance.
--
-- Duas mudanças além do parâmetro novo:
--
-- 1) O KPI 'fora_horario' contava whatsapp_conversations.opened_out_of_hours,
--    que é flag DA CONVERSA: gruda e sobrevive aos atendimentos seguintes.
--    Medido em 90 dias: na CONSYSA, 144 dos 162 marcados estavam DENTRO do
--    expediente; na Digi Office ela via 71 de 352. Ninguém percebeu porque o
--    campo é lido pelo hook e nunca renderizado na VelocidadeTab. Agora lê a
--    coluna support_attendances.plantao.
--
-- 2) O LEFT JOIN whatsapp_conversations existia SÓ para alimentar aquela flag.
--    Sai junto — um join a menos por linha na aba mais consultada do dash.
--
-- Custo do filtro: zero quando p_plantao é NULL (o OR curto-circuita antes de
-- tocar a coluna). Ativo, usa idx_support_attendances_plantao.
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_atendimento_velocidade(
  uuid, timestamptz, timestamptz, uuid, integer, bigint, uuid, boolean);
DROP FUNCTION IF EXISTS public.get_atendimento_velocidade(
  uuid, timestamptz, timestamptz, uuid, integer, bigint, uuid, boolean, text);

CREATE FUNCTION public.get_atendimento_velocidade(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid DEFAULT NULL::uuid,
  p_sla_frt_seconds integer DEFAULT 900,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_agent_id        uuid DEFAULT NULL::uuid,
  p_is_group        boolean DEFAULT NULL::boolean,
  p_plantao         text DEFAULT NULL::text
)
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
    'nao_atendido', (SELECT count(*) FROM base WHERE assumed_at IS NULL),
    'nao_atendido_pct', (SELECT CASE WHEN count(*) > 0
                  THEN ROUND(100.0 * count(*) FILTER (WHERE assumed_at IS NULL) / count(*), 1) ELSE NULL END FROM base),
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

REVOKE ALL ON FUNCTION public.get_atendimento_velocidade(uuid, timestamptz, timestamptz, uuid, integer, bigint, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_atendimento_velocidade(uuid, timestamptz, timestamptz, uuid, integer, bigint, uuid, boolean, text)
  TO authenticated, service_role;
