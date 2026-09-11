-- O relatorio de CSAT recebia o periodo como DATE, e a tela montava essa date
-- com toISOString() -- que converte para UTC. 31/08 23:59 (BR) virava 01/09, e a
-- RPC ainda somava +1 dia: o modal varria ate 02/09 e contava pesquisa de
-- setembro dentro de agosto (17 x 16 no dashboard).
-- Agora o periodo e timestamptz e vale o instante exato, igual
-- get_atendimento_satisfacao, que ja recebia ISO com fuso.

DROP FUNCTION IF EXISTS public.get_csat_report_list(uuid,date,date,uuid,integer,uuid,integer,boolean,uuid,boolean,boolean,bigint,text);
DROP FUNCTION IF EXISTS public.get_csat_report_list(uuid,timestamptz,timestamptz,uuid,integer,uuid,integer,boolean,uuid,boolean,boolean,bigint,text);

CREATE FUNCTION public.get_csat_report_list(
  p_tenant_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_department_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 200,
  p_agent_id uuid DEFAULT NULL::uuid,
  p_score integer DEFAULT NULL::integer,
  p_has_comment boolean DEFAULT NULL::boolean,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_is_group boolean DEFAULT NULL::boolean,
  p_respondida boolean DEFAULT true,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_plantao text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid, score integer, reason text,
  responded_at timestamptz, asked_at timestamptz,
  department_id uuid, setor text, cliente_nome text,
  attendance_id uuid, attendance_code text, agente text, status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unids bigint[];
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  RETURN QUERY
  SELECT
    sc.id, sc.score, sc.reason, sc.responded_at, sc.asked_at,
    COALESCE(sc.department_id, sa.department_id) AS department_id,
    COALESCE(d.name, 'Sem setor') AS setor,
    COALESCE(c.nome_fantasia, c.razao_social, wc.name, 'Cliente') AS cliente_nome,
    sa.id AS attendance_id, sa.attendance_code, f.nome AS agente, sc.status
  FROM support_csat sc
  JOIN support_attendances sa ON sa.id = sc.attendance_id
  LEFT JOIN clientes c ON c.id = sa.cliente_id
  LEFT JOIN whatsapp_contacts wc ON wc.id = sa.contact_id
  LEFT JOIN support_departments d ON d.id = COALESCE(sc.department_id, sa.department_id)
  LEFT JOIN profiles p ON p.user_id = sa.assigned_to AND p.tenant_id = p_tenant_id
  LEFT JOIN funcionarios f ON f.id = p.funcionario_id AND f.tenant_id = p_tenant_id
  WHERE sc.tenant_id = p_tenant_id
    AND sc.asked_at >= p_date_from
    AND sc.asked_at <= p_date_to
    AND (p_respondida IS NULL OR (sc.score IS NOT NULL) = p_respondida)
    AND (p_department_id IS NULL OR COALESCE(sc.department_id, sa.department_id) = p_department_id)
    AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
    AND (p_score IS NULL OR sc.score = p_score)
    AND (p_has_comment IS NULL
      OR (p_has_comment = true AND sc.reason IS NOT NULL AND sc.reason != '')
      OR (p_has_comment = false AND (sc.reason IS NULL OR sc.reason = '')))
    AND (p_cliente_id IS NULL OR sa.cliente_id = p_cliente_id)
    AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
    AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
    AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
    AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ORDER BY COALESCE(sc.responded_at, sc.asked_at) DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_csat_report_list(uuid,timestamptz,timestamptz,uuid,integer,uuid,integer,boolean,uuid,boolean,boolean,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_csat_report_list(uuid,timestamptz,timestamptz,uuid,integer,uuid,integer,boolean,uuid,boolean,boolean,bigint,text) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.get_csat_report_summary(uuid,date,date,uuid,uuid,integer,boolean,uuid,boolean,bigint,text);
DROP FUNCTION IF EXISTS public.get_csat_report_summary(uuid,timestamptz,timestamptz,uuid,uuid,integer,boolean,uuid,boolean,bigint,text);

CREATE FUNCTION public.get_csat_report_summary(
  p_tenant_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_department_id uuid DEFAULT NULL::uuid,
  p_agent_id uuid DEFAULT NULL::uuid,
  p_score integer DEFAULT NULL::integer,
  p_has_comment boolean DEFAULT NULL::boolean,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_is_group boolean DEFAULT NULL::boolean,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_plantao text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_unids bigint[];
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  WITH base AS (
    SELECT sc.id, sc.score, sc.status, sc.reason,
           COALESCE(sc.department_id, sa.department_id) AS dept_id,
           sa.assigned_to, sa.cliente_id, sa.is_group
    FROM support_csat sc
    JOIN support_attendances sa ON sa.id = sc.attendance_id
    WHERE sc.tenant_id = p_tenant_id
      AND sc.asked_at >= p_date_from
      AND sc.asked_at <= p_date_to
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (p_department_id IS NULL OR dept_id = p_department_id)
      AND (p_agent_id IS NULL OR assigned_to = p_agent_id)
      AND (p_score IS NULL OR score = p_score)
      AND (p_has_comment IS NULL
        OR (p_has_comment = true AND reason IS NOT NULL AND reason != '')
        OR (p_has_comment = false AND (reason IS NULL OR reason = '')))
      AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
      AND (p_is_group IS NULL OR COALESCE(is_group, false) = p_is_group)
  )
  SELECT jsonb_build_object(
    'enviadas',   (SELECT count(*) FROM filtered),
    'respostas',  (SELECT count(*) FROM filtered WHERE score IS NOT NULL),
    'media',      (SELECT round(avg(score)::numeric, 1) FROM filtered WHERE score IS NOT NULL),
    'por_setor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'department_id', s.dept_id,
        'setor', COALESCE(d.name, 'Sem setor'),
        'media', s.media,
        'respostas', s.respostas
      ) ORDER BY s.respostas DESC)
      FROM (
        SELECT dept_id, round(avg(score)::numeric, 1) AS media,
               count(*) FILTER (WHERE score IS NOT NULL) AS respostas
        FROM filtered WHERE score IS NOT NULL GROUP BY dept_id
      ) s
      LEFT JOIN support_departments d ON d.id = s.dept_id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_csat_report_summary(uuid,timestamptz,timestamptz,uuid,uuid,integer,boolean,uuid,boolean,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_csat_report_summary(uuid,timestamptz,timestamptz,uuid,uuid,integer,boolean,uuid,boolean,bigint,text) TO authenticated, service_role;
