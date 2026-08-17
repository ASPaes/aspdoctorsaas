-- Cards de indicadores da aba "Atendimentos - Chats" ignoravam a busca e o filtro
-- de instância que a LISTA já aplicava, então os números não batiam com o que
-- estava na tela ao pesquisar um cliente.
--
-- Adiciona p_search (mesmos campos da lista: attendance_code, contact_name,
-- contact_phone) e p_instance_id às 4 queries da função (TME, TPR, TMA e o
-- agregado de total/CSAT).
--
-- Base: definição de PRODUÇÃO lida em 17/08/2026 (md5 fcf4d0728cf529380dd806ba6d434be1).
-- DROP + CREATE porque acrescentar parâmetro cria sobrecarga (PostgREST daria
-- ambiguidade), não substitui. Aditivo: os dois parâmetros novos têm DEFAULT NULL,
-- o frontend antigo continua chamando sem eles.

DROP FUNCTION IF EXISTS public.get_attendance_summary_metrics(
  timestamp with time zone, timestamp with time zone, text, uuid, uuid, text, uuid,
  text, integer, text, text, uuid, bigint, text, boolean
);

CREATE OR REPLACE FUNCTION public.get_attendance_summary_metrics(
  p_date_from timestamp with time zone,
  p_date_to timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_agent_id uuid DEFAULT NULL::uuid,
  p_department_id uuid DEFAULT NULL::uuid,
  p_closure_type text DEFAULT NULL::text,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_csat_filter text DEFAULT NULL::text,
  p_csat_score integer DEFAULT NULL::integer,
  p_ticket_filter text DEFAULT NULL::text,
  p_sentiment_filter text DEFAULT NULL::text,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_resolucao text DEFAULT NULL::text,
  p_is_group boolean DEFAULT NULL::boolean,
  p_instance_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result json;
  v_median_wait int;
  v_median_handle int;
  v_median_frt int;
  v_like text;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant_id := p_tenant_id;
  ELSE
    v_tenant_id := public.current_tenant_id();
  END IF;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  -- Mesma regra da lista: busca só vale a partir de 2 caracteres.
  IF length(btrim(COALESCE(p_search, ''))) >= 2 THEN
    v_like := '%' || btrim(p_search) || '%';
  END IF;

  SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sa.wait_seconds))::int INTO v_median_wait
  FROM support_attendances sa
  WHERE sa.tenant_id = v_tenant_id AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
    AND sa.wait_seconds > 0 AND sa.wait_seconds <= kpi_cap_seconds('tme')
    AND (p_status IS NULL OR sa.status = p_status)
    AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
    AND (p_department_id IS NULL OR sa.department_id = p_department_id)
    AND (p_closure_type IS NULL OR sa.closure_type = p_closure_type)
    AND (p_cliente_id IS NULL OR sa.cliente_id = p_cliente_id)
    AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
    AND public.unidade_visible(sa.unidade_base_id)
    AND (p_csat_filter IS NULL
      OR (p_csat_filter = 'sent' AND sa.csat_sent = true)
      OR (p_csat_filter = 'not_sent' AND sa.csat_sent = false)
      OR (p_csat_filter = 'answered' AND sa.csat_score IS NOT NULL)
      OR (p_csat_filter = 'unanswered' AND sa.csat_sent = true AND sa.csat_score IS NULL))
    AND (p_csat_score IS NULL OR sa.csat_score = p_csat_score)
    AND (p_ticket_filter IS NULL
      OR (p_ticket_filter = 'with' AND sa.ticket_id IS NOT NULL)
      OR (p_ticket_filter = 'without' AND sa.ticket_id IS NULL))
    AND (p_sentiment_filter IS NULL OR sa.last_sentiment = p_sentiment_filter)
    AND (p_resolucao IS NULL OR COALESCE(sa.resolucao, '(sem)') = p_resolucao)
    AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
    AND (p_instance_id IS NULL OR sa.instance_id = p_instance_id)
    AND (v_like IS NULL OR sa.attendance_code ILIKE v_like OR sa.contact_name ILIKE v_like OR sa.contact_phone ILIKE v_like);

  SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sa.first_response_time_seconds))::int INTO v_median_frt
  FROM support_attendances sa
  WHERE sa.tenant_id = v_tenant_id AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
    AND sa.first_response_time_seconds > 0 AND sa.first_response_time_seconds <= kpi_cap_seconds('frt')
    AND (p_status IS NULL OR sa.status = p_status)
    AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
    AND (p_department_id IS NULL OR sa.department_id = p_department_id)
    AND (p_closure_type IS NULL OR sa.closure_type = p_closure_type)
    AND (p_cliente_id IS NULL OR sa.cliente_id = p_cliente_id)
    AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
    AND public.unidade_visible(sa.unidade_base_id)
    AND (p_csat_filter IS NULL
      OR (p_csat_filter = 'sent' AND sa.csat_sent = true)
      OR (p_csat_filter = 'not_sent' AND sa.csat_sent = false)
      OR (p_csat_filter = 'answered' AND sa.csat_score IS NOT NULL)
      OR (p_csat_filter = 'unanswered' AND sa.csat_sent = true AND sa.csat_score IS NULL))
    AND (p_csat_score IS NULL OR sa.csat_score = p_csat_score)
    AND (p_ticket_filter IS NULL
      OR (p_ticket_filter = 'with' AND sa.ticket_id IS NOT NULL)
      OR (p_ticket_filter = 'without' AND sa.ticket_id IS NULL))
    AND (p_sentiment_filter IS NULL OR sa.last_sentiment = p_sentiment_filter)
    AND (p_resolucao IS NULL OR COALESCE(sa.resolucao, '(sem)') = p_resolucao)
    AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
    AND (p_instance_id IS NULL OR sa.instance_id = p_instance_id)
    AND (v_like IS NULL OR sa.attendance_code ILIKE v_like OR sa.contact_name ILIKE v_like OR sa.contact_phone ILIKE v_like);

  SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sa.handle_seconds))::int INTO v_median_handle
  FROM support_attendances sa
  WHERE sa.tenant_id = v_tenant_id AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
    AND sa.handle_seconds > 0 AND sa.handle_seconds <= kpi_cap_seconds('tma')
    AND (p_status IS NULL OR sa.status = p_status)
    AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
    AND (p_department_id IS NULL OR sa.department_id = p_department_id)
    AND (p_closure_type IS NULL OR sa.closure_type = p_closure_type)
    AND (p_cliente_id IS NULL OR sa.cliente_id = p_cliente_id)
    AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
    AND public.unidade_visible(sa.unidade_base_id)
    AND (p_csat_filter IS NULL
      OR (p_csat_filter = 'sent' AND sa.csat_sent = true)
      OR (p_csat_filter = 'not_sent' AND sa.csat_sent = false)
      OR (p_csat_filter = 'answered' AND sa.csat_score IS NOT NULL)
      OR (p_csat_filter = 'unanswered' AND sa.csat_sent = true AND sa.csat_score IS NULL))
    AND (p_csat_score IS NULL OR sa.csat_score = p_csat_score)
    AND (p_ticket_filter IS NULL
      OR (p_ticket_filter = 'with' AND sa.ticket_id IS NOT NULL)
      OR (p_ticket_filter = 'without' AND sa.ticket_id IS NULL))
    AND (p_sentiment_filter IS NULL OR sa.last_sentiment = p_sentiment_filter)
    AND (p_resolucao IS NULL OR COALESCE(sa.resolucao, '(sem)') = p_resolucao)
    AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
    AND (p_instance_id IS NULL OR sa.instance_id = p_instance_id)
    AND (v_like IS NULL OR sa.attendance_code ILIKE v_like OR sa.contact_name ILIKE v_like OR sa.contact_phone ILIKE v_like);

  SELECT json_build_object(
    'total', COUNT(*),
    'median_wait_seconds', COALESCE(v_median_wait, 0),
    'median_handle_seconds', COALESCE(v_median_handle, 0),
    'median_first_response_seconds', COALESCE(v_median_frt, 0),
    'avg_csat', ROUND(COALESCE(AVG(sa.csat_score), 0), 1),
    'csat_count', COUNT(*) FILTER (WHERE sa.csat_score IS NOT NULL),
    'csat_sent_count', COUNT(*) FILTER (WHERE sa.csat_sent = true),
    'total_closed', COUNT(*) FILTER (WHERE sa.status = 'closed'),
    'total_open', COUNT(*) FILTER (WHERE sa.status IN ('waiting', 'in_progress'))
  ) INTO v_result
  FROM support_attendances sa
  WHERE sa.tenant_id = v_tenant_id AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
    AND (p_status IS NULL OR sa.status = p_status)
    AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
    AND (p_department_id IS NULL OR sa.department_id = p_department_id)
    AND (p_closure_type IS NULL OR sa.closure_type = p_closure_type)
    AND (p_cliente_id IS NULL OR sa.cliente_id = p_cliente_id)
    AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
    AND public.unidade_visible(sa.unidade_base_id)
    AND (p_csat_filter IS NULL
      OR (p_csat_filter = 'sent' AND sa.csat_sent = true)
      OR (p_csat_filter = 'not_sent' AND sa.csat_sent = false)
      OR (p_csat_filter = 'answered' AND sa.csat_score IS NOT NULL)
      OR (p_csat_filter = 'unanswered' AND sa.csat_sent = true AND sa.csat_score IS NULL))
    AND (p_csat_score IS NULL OR sa.csat_score = p_csat_score)
    AND (p_ticket_filter IS NULL
      OR (p_ticket_filter = 'with' AND sa.ticket_id IS NOT NULL)
      OR (p_ticket_filter = 'without' AND sa.ticket_id IS NULL))
    AND (p_sentiment_filter IS NULL OR sa.last_sentiment = p_sentiment_filter)
    AND (p_resolucao IS NULL OR COALESCE(sa.resolucao, '(sem)') = p_resolucao)
    AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
    AND (p_instance_id IS NULL OR sa.instance_id = p_instance_id)
    AND (v_like IS NULL OR sa.attendance_code ILIKE v_like OR sa.contact_name ILIKE v_like OR sa.contact_phone ILIKE v_like);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_attendance_summary_metrics(
  timestamp with time zone, timestamp with time zone, text, uuid, uuid, text, uuid,
  text, integer, text, text, uuid, bigint, text, boolean, uuid, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_attendance_summary_metrics(
  timestamp with time zone, timestamp with time zone, text, uuid, uuid, text, uuid,
  text, integer, text, text, uuid, bigint, text, boolean, uuid, text
) TO authenticated, service_role;
