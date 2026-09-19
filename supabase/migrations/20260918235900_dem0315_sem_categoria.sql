-- DEM-0315 (pendência 1): opção "Sem categoria" no filtro do Dashboard de Atendimento.
--
-- Corpos copiados da PRODUÇÃO em 18/09/2026, já com os filtros de categoria
-- publicados hoje. Mesma assinatura: CREATE OR REPLACE, sem DROP, grants intactos.
--
-- O UUID nulo (00000000-...) dentro de p_category_ids significa "Sem categoria":
-- atendimento sem ticket ou com ticket sem categoria (mesmo balde do
-- '(sem categoria)' dos quadros). Combina por OU com as categorias marcadas.
-- Subcategoria só restringe o que TEM categoria: "Sem categoria" + HARDWARE ›
-- Impressora traz os sem categoria mais os de Impressora.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_atendimento_agentes(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- DEM-0315: categoria/subcategoria vêm do ticket vinculado ao atendimento.
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria"
  -- (atendimento sem ticket, ou com ticket sem categoria).
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  WITH base AS (
    SELECT sa.assigned_to, sa.status, sa.reopen_count, sa.handle_seconds,
           sa.first_response_time_seconds, sa.csat_score, sa.csat_sent, sa.msg_agent_count,
           (SELECT tk.category_id FROM support_tickets tk WHERE tk.id = sa.ticket_id) AS category_id
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= now())
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND NOT EXISTS (
                 SELECT 1 FROM support_tickets tk
                 WHERE tk.id = sa.ticket_id AND tk.category_id IS NOT NULL))
           OR EXISTS (
            SELECT 1 FROM support_tickets tk
            WHERE tk.id = sa.ticket_id
              AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
              AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))
      AND sa.assigned_to IS NOT NULL
  ),
  conc_src AS (
    SELECT sa.assigned_to, sa.assumed_at, sa.closed_at
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= now())
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND NOT EXISTS (
                 SELECT 1 FROM support_tickets tk
                 WHERE tk.id = sa.ticket_id AND tk.category_id IS NOT NULL))
           OR EXISTS (
            SELECT 1 FROM support_tickets tk
            WHERE tk.id = sa.ticket_id
              AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
              AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))
      AND sa.assigned_to IS NOT NULL
      AND sa.assumed_at IS NOT NULL AND sa.closed_at IS NOT NULL AND sa.closed_at > sa.assumed_at
  ),
  conc_ev AS (
    SELECT assigned_to, assumed_at AS ts, 1 AS d FROM conc_src
    UNION ALL
    SELECT assigned_to, closed_at  AS ts, -1 AS d FROM conc_src
  ),
  conc_run AS (
    SELECT assigned_to, SUM(d) OVER (PARTITION BY assigned_to ORDER BY ts, d) AS c FROM conc_ev
  ),
  conc AS (
    SELECT assigned_to, MAX(c) AS pico FROM conc_run GROUP BY assigned_to
  ),
  msg_flag AS (
    SELECT m.conversation_id, m.sent_by_user_id, m.is_from_me, m.timestamp,
           CASE WHEN LAG(m.is_from_me) OVER w IS DISTINCT FROM m.is_from_me THEN 1 ELSE 0 END AS new_block
    FROM whatsapp_messages m
    WHERE m.tenant_id = v_tenant
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.timestamp)
  ),
  msg_blk AS (
    SELECT conversation_id, sent_by_user_id, is_from_me, timestamp,
           SUM(new_block) OVER (PARTITION BY conversation_id ORDER BY timestamp) AS block_id
    FROM msg_flag
  ),
  lat_cli AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS cli_first
    FROM msg_blk WHERE is_from_me = false GROUP BY conversation_id, block_id
  ),
  lat_agt AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS agt_first,
           (array_agg(sent_by_user_id ORDER BY timestamp) FILTER (WHERE sent_by_user_id IS NOT NULL))[1] AS agente
    FROM msg_blk WHERE is_from_me = true AND sent_by_user_id IS NOT NULL GROUP BY conversation_id, block_id
  ),
  lat_gap AS (
    SELECT a.agente AS sent_by_user_id,
           EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) AS gap
    FROM lat_cli c
    JOIN lat_agt a ON a.conversation_id = c.conversation_id AND a.block_id = c.block_id + 1
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    WHERE a.agente IS NOT NULL
      AND (p_is_group IS NULL OR COALESCE(wc.is_group, false) = p_is_group)
      AND EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) BETWEEN 1 AND kpi_cap_seconds('latencia')
      AND (NOT v_filtra_cat OR EXISTS (
            SELECT 1 FROM support_attendances sa
            LEFT JOIN support_tickets tk ON tk.id = sa.ticket_id
            WHERE sa.conversation_id = c.conversation_id
              AND sa.tenant_id = v_tenant
              AND a.agt_first >= sa.opened_at
              AND a.agt_first <= COALESCE(sa.closed_at, now())
              AND ((v_sem_cat AND tk.category_id IS NULL)
                   OR (tk.category_id IS NOT NULL
                  AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
                  AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))))
      AND (p_plantao IS NULL
           OR (p_plantao = 'plantao')
              = public.fn_instante_fora_expediente(v_tenant, wc.department_id, a.agt_first))
  ),
  lat AS (
    SELECT sent_by_user_id,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap))::int AS lat_p50,
           (ARRAY['<30s','30s-1min','1-2min','2-5min','5-10min','10-30min','30min+'])[
              mode() WITHIN GROUP (ORDER BY width_bucket(gap, ARRAY[30,60,120,300,600,1800])) + 1
           ] AS lat_faixa
    FROM lat_gap
    GROUP BY sent_by_user_id
  ),
  -- Quadro Agente × Categoria. category_id NULL = atendimento sem ticket categorizado.
  per_cat AS (
    SELECT b.assigned_to, b.category_id,
           count(*) AS total,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.handle_seconds)
                 FILTER (WHERE b.handle_seconds BETWEEN 1 AND kpi_cap_seconds('tma')))::int AS tma_p50,
           ROUND(AVG(b.csat_score) FILTER (WHERE b.csat_score IS NOT NULL), 2) AS csat,
           count(*) FILTER (WHERE b.csat_score IS NOT NULL) AS csat_n
    FROM base b
    GROUP BY b.assigned_to, b.category_id
  ),
  per_agent AS (
    SELECT
      b.assigned_to,
      f.nome AS nome,
      count(*) AS total,
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed')) AS encerrados,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.handle_seconds)
            FILTER (WHERE b.handle_seconds BETWEEN 1 AND kpi_cap_seconds('tma')))::int AS tma_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.first_response_time_seconds)
            FILTER (WHERE b.first_response_time_seconds BETWEEN 1 AND kpi_cap_seconds('frt')))::int AS frt_p50,
      ROUND(AVG(b.csat_score) FILTER (WHERE b.csat_score IS NOT NULL), 2) AS csat,
      count(*) FILTER (WHERE b.csat_score IS NOT NULL) AS csat_n,
      count(*) FILTER (WHERE COALESCE(b.csat_sent, false)) AS csat_sent_n,
      count(*) FILTER (WHERE b.reopen_count > 0 AND b.status IN ('closed','inactive_closed')) AS reabertos,
      ROUND(AVG(b.msg_agent_count) FILTER (WHERE b.status IN ('closed','inactive_closed') AND b.msg_agent_count > 0), 1) AS msgs_atend
    FROM base b
    LEFT JOIN profiles p ON p.user_id = b.assigned_to AND p.tenant_id = v_tenant
    LEFT JOIN funcionarios f ON f.id = p.funcionario_id AND f.tenant_id = v_tenant
    GROUP BY b.assigned_to, f.nome
  )
  SELECT jsonb_build_object(
    'total_encerrados', (SELECT COALESCE(sum(encerrados),0) FROM per_agent),
    'agentes_ativos', (SELECT count(*) FROM per_agent),
    'csat_equipe', (SELECT ROUND(AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL),2) FROM base),
    'csat_equipe_n', (SELECT count(*) FILTER (WHERE csat_score IS NOT NULL) FROM base),
    'csat_equipe_sent_n', (SELECT count(*) FILTER (WHERE COALESCE(csat_sent, false)) FROM base),
    'reabertura_equipe_pct', (SELECT CASE WHEN count(*) FILTER (WHERE status IN ('closed','inactive_closed'))>0
        THEN ROUND(100.0*count(*) FILTER (WHERE reopen_count>0 AND status IN ('closed','inactive_closed'))
             / count(*) FILTER (WHERE status IN ('closed','inactive_closed')),1) ELSE NULL END FROM base),
    'por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', pc.assigned_to, 'category_id', pc.category_id, 'categoria', sc.nome,
        'total', pc.total, 'tma_p50', pc.tma_p50, 'csat', pc.csat, 'csat_n', pc.csat_n))
      FROM per_cat pc
      LEFT JOIN service_categories sc ON sc.id = pc.category_id), '[]'::jsonb),
    'agentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.assigned_to, 'nome', COALESCE(a.nome,'Sem nome'),
        'total', a.total, 'encerrados', a.encerrados,
        'tma_p50', a.tma_p50, 'frt_p50', a.frt_p50,
        'csat', a.csat, 'csat_n', a.csat_n, 'csat_sent_n', a.csat_sent_n,
        'reabertura_pct', CASE WHEN a.encerrados>0 THEN ROUND(100.0*a.reabertos/a.encerrados,1) ELSE NULL END,
        'msgs_atend', a.msgs_atend,
        'pico_simultaneos', COALESCE(cc.pico, 0),
        'latencia_p50', lt.lat_p50,
        'latencia_faixa', lt.lat_faixa)
        ORDER BY a.encerrados DESC)
      FROM per_agent a
      LEFT JOIN conc cc ON cc.assigned_to = a.assigned_to
      LEFT JOIN lat  lt ON lt.sent_by_user_id = a.assigned_to), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_atendimento_latencia_histograma(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- DEM-0315: categoria/subcategoria vêm do ticket vinculado ao atendimento.
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria"
  -- (atendimento sem ticket, ou com ticket sem categoria).
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  v_unids := public.user_effective_unidades();

  WITH msg_flag AS (
    SELECT m.conversation_id, m.sent_by_user_id, m.is_from_me, m.timestamp,
           CASE WHEN LAG(m.is_from_me) OVER w IS DISTINCT FROM m.is_from_me THEN 1 ELSE 0 END AS new_block
    FROM whatsapp_messages m
    WHERE m.tenant_id = v_tenant
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.timestamp)
  ),
  msg_blk AS (
    SELECT conversation_id, sent_by_user_id, is_from_me, timestamp,
           SUM(new_block) OVER (PARTITION BY conversation_id ORDER BY timestamp) AS block_id
    FROM msg_flag
  ),
  lat_cli AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS cli_first
    FROM msg_blk WHERE is_from_me = false GROUP BY conversation_id, block_id
  ),
  lat_agt AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS agt_first,
           (array_agg(sent_by_user_id ORDER BY timestamp) FILTER (WHERE sent_by_user_id IS NOT NULL))[1] AS agente
    FROM msg_blk WHERE is_from_me = true AND sent_by_user_id IS NOT NULL GROUP BY conversation_id, block_id
  ),
  lat_gap AS (
    SELECT a.agente AS sent_by_user_id, c.conversation_id,
           EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) AS gap
    FROM lat_cli c
    JOIN lat_agt a ON a.conversation_id = c.conversation_id AND a.block_id = c.block_id + 1
    WHERE a.agente IS NOT NULL
      AND EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) BETWEEN 1 AND kpi_cap_seconds('latencia')
      AND (NOT v_filtra_cat OR EXISTS (
            SELECT 1 FROM support_attendances sa
            LEFT JOIN support_tickets tk ON tk.id = sa.ticket_id
            WHERE sa.conversation_id = c.conversation_id
              AND sa.tenant_id = v_tenant
              AND a.agt_first >= sa.opened_at
              AND a.agt_first <= COALESCE(sa.closed_at, now())
              AND ((v_sem_cat AND tk.category_id IS NULL)
                   OR (tk.category_id IS NOT NULL
                  AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
                  AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))))
  ),
  filtered AS (
    SELECT g.gap, width_bucket(g.gap, ARRAY[30,60,120,300,600,1800]) AS bucket
    FROM lat_gap g
    JOIN whatsapp_conversations wc ON wc.id = g.conversation_id AND wc.tenant_id = v_tenant
    WHERE (p_agent_id IS NULL OR g.sent_by_user_id = p_agent_id)
      AND (p_department_id IS NULL OR wc.department_id = p_department_id)
      AND (p_is_group IS NULL OR COALESCE(wc.is_group, false) = p_is_group)
      AND (wc.is_group OR (v_unids IS NULL OR wc.unidade_base_id IS NULL OR wc.unidade_base_id = ANY(v_unids)))
  ),
  buckets(idx, lbl) AS (
    VALUES (0,'<30s'),(1,'30s-1min'),(2,'1-2min'),(3,'2-5min'),(4,'5-10min'),(5,'10-30min'),(6,'30min+')
  )
  SELECT jsonb_build_object(
    'total',     (SELECT count(*) FROM filtered),
    'mediana_s', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap))::int FROM filtered),
    'faixas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('idx', b.idx, 'faixa', b.lbl, 'qtd', COALESCE(fc.c, 0)) ORDER BY b.idx)
      FROM buckets b
      LEFT JOIN (SELECT bucket, count(*) AS c FROM filtered GROUP BY bucket) fc ON fc.bucket = b.idx
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_atendimento_latencia_agente(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_agent_id uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- DEM-0315: categoria/subcategoria vêm do ticket vinculado ao atendimento.
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria"
  -- (atendimento sem ticket, ou com ticket sem categoria).
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_tenant uuid;
  v_cap    int;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_agent_id IS NULL THEN
    RAISE EXCEPTION 'p_agent_id é obrigatório';
  END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_cap := public.kpi_cap_seconds('latencia');

  WITH convs AS (
    SELECT DISTINCT m.conversation_id
    FROM whatsapp_messages m
    WHERE m.tenant_id = v_tenant
      AND m.sent_by_user_id = p_agent_id
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
  ),
  msg_flag AS (
    SELECT m.conversation_id, m.sent_by_user_id, m.is_from_me, m.timestamp,
           m.content, m.message_type, m.media_kind,
           CASE WHEN LAG(m.is_from_me) OVER w IS DISTINCT FROM m.is_from_me THEN 1 ELSE 0 END AS new_block
    FROM whatsapp_messages m
    JOIN convs cv ON cv.conversation_id = m.conversation_id
    WHERE m.tenant_id = v_tenant
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.timestamp)
  ),
  msg_blk AS (
    SELECT conversation_id, sent_by_user_id, is_from_me, timestamp,
           content, message_type, media_kind,
           SUM(new_block) OVER (PARTITION BY conversation_id ORDER BY timestamp) AS block_id
    FROM msg_flag
  ),
  lat_cli AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS cli_first,
           (array_agg(
              left(COALESCE(
                     NULLIF(btrim(content), ''),
                     '[' || COALESCE(media_kind, message_type) || ']'
                   ), 160)
              ORDER BY timestamp))[1] AS cli_preview
    FROM msg_blk WHERE is_from_me = false GROUP BY conversation_id, block_id
  ),
  lat_agt AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS agt_first,
           (array_agg(sent_by_user_id ORDER BY timestamp) FILTER (WHERE sent_by_user_id IS NOT NULL))[1] AS agente
    FROM msg_blk WHERE is_from_me = true AND sent_by_user_id IS NOT NULL GROUP BY conversation_id, block_id
  ),
  -- Sem o teto aqui: ele vira a marca `no_calculo`, para a lista poder mostrar
  -- o que ficou de fora do percentil.
  lat_gap AS (
    SELECT c.conversation_id,
           c.cli_first,
           c.cli_preview,
           a.agt_first,
           EXTRACT(EPOCH FROM (a.agt_first - c.cli_first))::int AS seg,
           COALESCE(wc.is_group, false) AS is_group,
           wc.department_id,
           wc.contact_id
    FROM lat_cli c
    JOIN lat_agt a ON a.conversation_id = c.conversation_id AND a.block_id = c.block_id + 1
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    WHERE a.agente = p_agent_id
      AND (p_is_group IS NULL OR COALESCE(wc.is_group, false) = p_is_group)
      AND EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) >= 1
      AND (NOT v_filtra_cat OR EXISTS (
            SELECT 1 FROM support_attendances sa
            LEFT JOIN support_tickets tk ON tk.id = sa.ticket_id
            WHERE sa.conversation_id = c.conversation_id
              AND sa.tenant_id = v_tenant
              AND a.agt_first >= sa.opened_at
              AND a.agt_first <= COALESCE(sa.closed_at, now())
              AND ((v_sem_cat AND tk.category_id IS NULL)
                   OR (tk.category_id IS NOT NULL
                  AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
                  AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))))
      AND (p_plantao IS NULL
           OR (p_plantao = 'plantao')
              = public.fn_instante_fora_expediente(v_tenant, wc.department_id, a.agt_first))
  ),
  itens AS (
    SELECT g.*,
           (g.seg <= v_cap) AS no_calculo,
           width_bucket(g.seg, ARRAY[30,60,120,300,600,1800]) AS faixa_idx,
           COALESCE(ct.name, ct.phone_number, 'Sem nome') AS contato,
           ct.cliente_id,
           COALESCE(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
           sd.name AS departamento
    FROM lat_gap g
    LEFT JOIN whatsapp_contacts   ct ON ct.id = g.contact_id
    LEFT JOIN clientes            cl ON cl.id = ct.cliente_id
    LEFT JOIN support_departments sd ON sd.id = g.department_id
  )
  SELECT jsonb_build_object(
    'agent_id',    p_agent_id,
    'nome',        (SELECT f.nome FROM profiles p
                      LEFT JOIN funcionarios f ON f.id = p.funcionario_id
                     WHERE p.user_id = p_agent_id AND p.tenant_id = v_tenant),
    'cap_seconds', v_cap,
    'total_lista',      (SELECT count(*) FROM itens),
    'total_no_calculo', (SELECT count(*) FROM itens WHERE no_calculo),
    'total_fora_cap',   (SELECT count(*) FROM itens WHERE NOT no_calculo),
    'total_conversas',  (SELECT count(DISTINCT conversation_id) FROM itens),
    'p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY seg))::int FROM itens WHERE no_calculo),
    'p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY seg))::int FROM itens WHERE no_calculo),
    'truncado', (SELECT count(*) FROM itens) > p_limit,
    -- As 7 faixas do histograma da aba, sempre todas, mesmo zeradas.
    'faixas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'idx',   f.idx,
               'faixa', (ARRAY['<30s','30s-1min','1-2min','2-5min','5-10min','10-30min','30min+'])[f.idx + 1],
               'qtd',   (SELECT count(*) FROM itens i WHERE i.no_calculo AND i.faixa_idx = f.idx)
             ) ORDER BY f.idx)
      FROM generate_series(0, 6) AS f(idx)), '[]'::jsonb),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'conversation_id', a.conversation_id,
               'cli_first',       a.cli_first,
               'agt_first',       a.agt_first,
               'preview',         a.cli_preview,
               'contato',         a.contato,
               'cliente_id',      a.cliente_id,
               'cliente_nome',    a.cliente_nome,
               'departamento',    a.departamento,
               'is_group',        a.is_group,
               'seg',             a.seg,
               'no_calculo',      a.no_calculo
             ) ORDER BY a.seg DESC, a.cli_first DESC)
      FROM (SELECT * FROM itens ORDER BY seg DESC, cli_first DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_atendimento_chats(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_segmento_ids bigint[] DEFAULT NULL::bigint[], p_area_ids bigint[] DEFAULT NULL::bigint[], p_estado_ids bigint[] DEFAULT NULL::bigint[], p_cidade_ids bigint[] DEFAULT NULL::bigint[], p_fornecedor_ids bigint[] DEFAULT NULL::bigint[], p_produto_ids bigint[] DEFAULT NULL::bigint[], p_closed_reasons text[] DEFAULT NULL::text[], p_has_ticket boolean DEFAULT NULL::boolean, p_is_group boolean DEFAULT NULL::boolean, p_sentiments text[] DEFAULT NULL::text[], p_resolucoes text[] DEFAULT NULL::text[], p_plantao text DEFAULT NULL::text, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- DEM-0315: categoria/subcategoria vêm do ticket vinculado ao atendimento.
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria"
  -- (atendimento sem ticket, ou com ticket sem categoria).
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
  v_has_cli boolean;
  v_mrr_min numeric := 50;
  v_meses numeric;
  v_mrr_total numeric;
  v_agentes int;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_has_cli := COALESCE(array_length(p_segmento_ids,1),0) > 0
            OR COALESCE(array_length(p_area_ids,1),0) > 0
            OR COALESCE(array_length(p_estado_ids,1),0) > 0
            OR COALESCE(array_length(p_cidade_ids,1),0) > 0
            OR COALESCE(array_length(p_fornecedor_ids,1),0) > 0
            OR COALESCE(array_length(p_produto_ids,1),0) > 0;

  v_meses := GREATEST((p_date_to::date - p_date_from::date + 1) / 30.44, 0.0333);
  SELECT COALESCE(SUM(cp.vlr_mensal),0) INTO v_mrr_total
  FROM cliente_produtos cp
  LEFT JOIN clientes c ON c.id = cp.cliente_id
  WHERE cp.tenant_id = v_tenant AND cp.ativo = true
    AND (v_unids IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_unids));

  WITH cli_ok AS (
    SELECT c.id
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND (COALESCE(array_length(p_segmento_ids,1),0)=0 OR c.segmento_id = ANY(p_segmento_ids))
      AND (COALESCE(array_length(p_area_ids,1),0)=0 OR c.area_atuacao_id = ANY(p_area_ids))
      AND (COALESCE(array_length(p_estado_ids,1),0)=0 OR c.estado_id = ANY(p_estado_ids))
      AND (COALESCE(array_length(p_cidade_ids,1),0)=0 OR c.cidade_id = ANY(p_cidade_ids))
      AND (COALESCE(array_length(p_fornecedor_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.fornecedor_id = ANY(p_fornecedor_ids)))
      AND (COALESCE(array_length(p_produto_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.produto_id = ANY(p_produto_ids)))
  ),
  at AS (
    SELECT status, last_sentiment, resolucao, csat_score, csat_sent, assigned_to, cliente_id, opened_at,
           handle_seconds,
           (SELECT tk.category_id FROM support_tickets tk WHERE tk.id = support_attendances.ticket_id) AS category_id
    FROM support_attendances
    WHERE tenant_id = v_tenant
      AND opened_at >= p_date_from AND opened_at <= p_date_to
      AND (p_unidade_base_id IS NULL OR unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR unidade_base_id IS NULL OR unidade_base_id = ANY(v_unids))
      AND (p_department_id IS NULL OR department_id = p_department_id)
      AND (p_agent_id IS NULL OR assigned_to = p_agent_id)
      AND (NOT v_has_cli OR cliente_id IN (SELECT id FROM cli_ok))
      AND (p_closed_reasons IS NULL OR closed_reason = ANY(p_closed_reasons))
      AND (p_has_ticket IS NULL OR (p_has_ticket AND ticket_id IS NOT NULL) OR (NOT p_has_ticket AND ticket_id IS NULL))
      AND (p_is_group IS NULL OR COALESCE(is_group, false) = p_is_group)
      AND (p_sentiments IS NULL OR last_sentiment = ANY(p_sentiments))
      AND (p_resolucoes IS NULL OR COALESCE(resolucao, '(sem)') = ANY(p_resolucoes))
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(plantao, false))
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND NOT EXISTS (
                 SELECT 1 FROM support_tickets tk
                 WHERE tk.id = support_attendances.ticket_id AND tk.category_id IS NOT NULL))
           OR EXISTS (
            SELECT 1 FROM support_tickets tk
            WHERE tk.id = support_attendances.ticket_id
              AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
              AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))
  ),
  tot AS (SELECT count(*) AS n FROM at),
  st AS (SELECT COALESCE(NULLIF(status,''),'(sem)') AS status, count(*) AS qtd FROM at GROUP BY 1),
  sent AS (SELECT last_sentiment, count(*) AS qtd FROM at WHERE last_sentiment IS NOT NULL GROUP BY last_sentiment),
  res AS (SELECT COALESCE(resolucao, '(sem)') AS resolucao, count(*) AS qtd FROM at GROUP BY 1),
  -- Quantos chats e quanto tempo por categoria do ticket. Horas somam só o que
  -- cabe no teto do TMA, para um chat esquecido aberto não inflar a soma.
  cat AS (
    SELECT category_id, count(*) AS qtd,
           COALESCE(SUM(handle_seconds) FILTER (WHERE handle_seconds BETWEEN 1 AND kpi_cap_seconds('tma')), 0) AS seg,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY handle_seconds)
                 FILTER (WHERE handle_seconds BETWEEN 1 AND kpi_cap_seconds('tma')))::int AS tma_p50
    FROM at GROUP BY category_id
  ),
  atd AS (SELECT assigned_to, count(*) AS qtd FROM at WHERE assigned_to IS NOT NULL GROUP BY assigned_to),
  heat AS (
    SELECT EXTRACT(DOW FROM (opened_at AT TIME ZONE 'America/Sao_Paulo'))::int AS dow,
           EXTRACT(HOUR FROM (opened_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hora,
           count(*) AS qtd
    FROM at GROUP BY 1,2
  ),
  mrr_cli AS (
    SELECT cliente_id, SUM(vlr_mensal) AS mrr
    FROM cliente_produtos
    WHERE tenant_id = v_tenant AND ativo = true
    GROUP BY cliente_id
    HAVING SUM(vlr_mensal) >= v_mrr_min
  ),
  ofens AS (
    SELECT a.cliente_id, count(*) AS qtd, mc.mrr
    FROM at a
    JOIN mrr_cli mc ON mc.cliente_id = a.cliente_id
    WHERE a.cliente_id IS NOT NULL
    GROUP BY a.cliente_id, mc.mrr
  ),
  ofens_rank AS (
    SELECT cliente_id, qtd, mrr,
           row_number() OVER (ORDER BY qtd DESC) AS rn_vol,
           row_number() OVER (ORDER BY (qtd / (mrr/1000.0)) DESC) AS rn_custo,
           sum(qtd) OVER () AS soma_com_cli
    FROM ofens
  ),
  ativos AS (
    SELECT count(*) AS n
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND COALESCE(c.cancelado,false) = false
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_unids))
      AND (NOT v_has_cli OR c.id IN (SELECT id FROM cli_ok))
  )
  SELECT jsonb_build_object(
    'total', (SELECT n FROM tot),
    'por_status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', st.status, 'qtd', st.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*st.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY st.qtd DESC) FROM st), '[]'::jsonb),
    'por_sentimento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('sentimento', sent.last_sentiment, 'qtd', sent.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*sent.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY sent.qtd DESC) FROM sent), '[]'::jsonb),
    'por_resolucao', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('resolucao', res.resolucao, 'qtd', res.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*res.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY res.qtd DESC) FROM res), '[]'::jsonb),
    'csat', (
      SELECT jsonb_build_object(
        'enviados', count(*) FILTER (WHERE csat_sent = true),
        'respondidos', count(*) FILTER (WHERE csat_score IS NOT NULL),
        'response_rate', CASE WHEN count(*) FILTER (WHERE csat_sent=true)>0
                              THEN ROUND(100.0*count(*) FILTER (WHERE csat_score IS NOT NULL)/count(*) FILTER (WHERE csat_sent=true),0) ELSE 0 END,
        'media', ROUND(AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL), 2),
        'distribuicao', COALESCE((SELECT jsonb_agg(jsonb_build_object('nota', nota, 'qtd', q) ORDER BY nota)
                                  FROM (SELECT csat_score AS nota, count(*) AS q FROM at WHERE csat_score IS NOT NULL GROUP BY csat_score) d), '[]'::jsonb)
      ) FROM at
    ),
    'por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category_id', cat.category_id, 'nome', COALESCE(sc.nome, '(sem categoria)'),
               'qtd', cat.qtd, 'horas', ROUND(cat.seg / 3600.0, 1), 'tma_p50', cat.tma_p50,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*cat.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY cat.qtd DESC)
      FROM cat LEFT JOIN service_categories sc ON sc.id = cat.category_id), '[]'::jsonb),
    'por_atendente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', COALESCE(f.nome,'(não atribuído)'), 'qtd', atd.qtd) ORDER BY atd.qtd DESC)
      FROM atd
      LEFT JOIN profiles pr ON pr.user_id = atd.assigned_to AND pr.tenant_id = v_tenant
      LEFT JOIN funcionarios f ON f.id = pr.funcionario_id), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dow', heat.dow, 'hora', heat.hora, 'qtd', heat.qtd)) FROM heat), '[]'::jsonb),
    'ofensores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('cliente_id', orank.cliente_id,
               'nome', COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)'), 'qtd', orank.qtd)
             ORDER BY orank.qtd DESC)
      FROM ofens_rank orank LEFT JOIN clientes c ON c.id = orank.cliente_id
      WHERE orank.rn_vol <= 15), '[]'::jsonb),
    'custo_receita', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('cliente_id', orank.cliente_id,
               'nome', COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)'),
               'atendimentos', orank.qtd, 'mrr', ROUND(orank.mrr,2),
               'atend_por_mil', ROUND(orank.qtd / (orank.mrr/1000.0), 2),
               'receita_por_atend', ROUND((orank.mrr * v_meses) / orank.qtd, 2))
             ORDER BY (orank.qtd / (orank.mrr/1000.0)) DESC)
      FROM ofens_rank orank LEFT JOIN clientes c ON c.id = orank.cliente_id
      WHERE orank.rn_custo <= 15), '[]'::jsonb),
    'concentracao', (
      SELECT jsonb_build_object(
        'clientes_com_chat', (SELECT count(*) FROM ofens),
        'chats_com_cliente', COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0),
        'top1_qtd', COALESCE((SELECT qtd FROM ofens_rank WHERE rn_vol=1),0),
        'top1_pct', CASE WHEN COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0)>0
                         THEN ROUND(100.0*COALESCE((SELECT qtd FROM ofens_rank WHERE rn_vol=1),0)/(SELECT max(soma_com_cli) FROM ofens_rank),1) ELSE 0 END,
        'top10_pct', CASE WHEN COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0)>0
                          THEN ROUND(100.0*(SELECT COALESCE(sum(qtd),0) FROM ofens_rank WHERE rn_vol<=10)/(SELECT max(soma_com_cli) FROM ofens_rank),1) ELSE 0 END
      )
    ),
    'mrr_por_agente', (
      SELECT jsonb_build_object(
        'mrr_total', ROUND(v_mrr_total,2),
        'agentes_ativos', (SELECT count(DISTINCT assigned_to) FROM at WHERE assigned_to IS NOT NULL),
        'valor', CASE WHEN (SELECT count(DISTINCT assigned_to) FROM at WHERE assigned_to IS NOT NULL) > 0
                      THEN ROUND(v_mrr_total / (SELECT count(DISTINCT assigned_to) FROM at WHERE assigned_to IS NOT NULL), 2) ELSE NULL END
      )
    ),
    'media_atend_cliente', jsonb_build_object(
      'clientes_ativos', (SELECT n FROM ativos),
      'total_atendimentos', (SELECT n FROM tot),
      'media', CASE WHEN (SELECT n FROM ativos)>0 THEN ROUND((SELECT n FROM tot)::numeric/(SELECT n FROM ativos),2) ELSE NULL END
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_atendimento_chats_lista(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_segmento_ids bigint[] DEFAULT NULL::bigint[], p_area_ids bigint[] DEFAULT NULL::bigint[], p_estado_ids bigint[] DEFAULT NULL::bigint[], p_cidade_ids bigint[] DEFAULT NULL::bigint[], p_fornecedor_ids bigint[] DEFAULT NULL::bigint[], p_produto_ids bigint[] DEFAULT NULL::bigint[], p_closed_reasons text[] DEFAULT NULL::text[], p_has_ticket boolean DEFAULT NULL::boolean, p_is_group boolean DEFAULT NULL::boolean, p_sentiments text[] DEFAULT NULL::text[], p_resolucoes text[] DEFAULT NULL::text[], p_plantao text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- DEM-0315: categoria/subcategoria vêm do ticket vinculado ao atendimento.
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria"
  -- (atendimento sem ticket, ou com ticket sem categoria).
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
  v_has_cli boolean;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_has_cli := COALESCE(array_length(p_segmento_ids,1),0) > 0
            OR COALESCE(array_length(p_area_ids,1),0) > 0
            OR COALESCE(array_length(p_estado_ids,1),0) > 0
            OR COALESCE(array_length(p_cidade_ids,1),0) > 0
            OR COALESCE(array_length(p_fornecedor_ids,1),0) > 0
            OR COALESCE(array_length(p_produto_ids,1),0) > 0;

  WITH cli_ok AS (
    SELECT c.id
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND (COALESCE(array_length(p_segmento_ids,1),0)=0 OR c.segmento_id = ANY(p_segmento_ids))
      AND (COALESCE(array_length(p_area_ids,1),0)=0 OR c.area_atuacao_id = ANY(p_area_ids))
      AND (COALESCE(array_length(p_estado_ids,1),0)=0 OR c.estado_id = ANY(p_estado_ids))
      AND (COALESCE(array_length(p_cidade_ids,1),0)=0 OR c.cidade_id = ANY(p_cidade_ids))
      AND (COALESCE(array_length(p_fornecedor_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.fornecedor_id = ANY(p_fornecedor_ids)))
      AND (COALESCE(array_length(p_produto_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.produto_id = ANY(p_produto_ids)))
  ),
  -- CÓPIA do WHERE da CTE `at` de get_atendimento_chats. Ver aviso no topo.
  at AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id, sa.department_id,
           sa.assigned_to, sa.opened_at, sa.closed_at, sa.closed_reason,
           sa.status, sa.last_sentiment, sa.resolucao, sa.csat_score,
           COALESCE(sa.plantao, false) AS plantao,
           sa.plantao_em,
           COALESCE(sa.is_group, false) AS is_group,
           sa.ticket_id
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (NOT v_has_cli OR sa.cliente_id IN (SELECT id FROM cli_ok))
      AND (p_closed_reasons IS NULL OR sa.closed_reason = ANY(p_closed_reasons))
      AND (p_has_ticket IS NULL OR (p_has_ticket AND sa.ticket_id IS NOT NULL) OR (NOT p_has_ticket AND sa.ticket_id IS NULL))
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_sentiments IS NULL OR sa.last_sentiment = ANY(p_sentiments))
      AND (p_resolucoes IS NULL OR COALESCE(sa.resolucao, '(sem)') = ANY(p_resolucoes))
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND NOT EXISTS (
                 SELECT 1 FROM support_tickets tk
                 WHERE tk.id = sa.ticket_id AND tk.category_id IS NOT NULL))
           OR EXISTS (
            SELECT 1 FROM support_tickets tk
            WHERE tk.id = sa.ticket_id
              AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
              AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))
  )
  SELECT jsonb_build_object(
    'total',    (SELECT count(*) FROM at),
    'truncado', (SELECT count(*) FROM at) > p_limit,
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'attendance_id',   a.id,
               'attendance_code', a.attendance_code,
               'conversation_id', a.conversation_id,
               'contato',         COALESCE(NULLIF(a.contact_name,''), a.contact_phone, 'Sem nome'),
               'telefone',        a.contact_phone,
               'cliente_id',      a.cliente_id,
               'cliente_nome',    CASE WHEN a.cliente_id IS NULL THEN NULL
                                       ELSE COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') END,
               'agente',          f.nome,
               'departamento',    sd.name,
               'opened_at',       a.opened_at,
               'closed_at',       a.closed_at,
               'closed_reason',   a.closed_reason,
               'status',          a.status,
               'sentimento',      a.last_sentiment,
               'resolucao',       a.resolucao,
               'csat_score',      a.csat_score,
               'plantao',         a.plantao,
               'plantao_em',      a.plantao_em,
               'is_group',        a.is_group,
               'categoria',       tsc.nome,
               'subcategoria',    tss.nome,
               'duracao_seg',     GREATEST(EXTRACT(EPOCH FROM (COALESCE(a.closed_at, now()) - a.opened_at))::int, 0)
             ) ORDER BY a.opened_at DESC)
      FROM (SELECT * FROM at ORDER BY opened_at DESC LIMIT p_limit) a
      LEFT JOIN clientes c             ON c.id  = a.cliente_id
      LEFT JOIN support_departments sd ON sd.id = a.department_id
      LEFT JOIN profiles pr            ON pr.user_id = a.assigned_to AND pr.tenant_id = v_tenant
      LEFT JOIN funcionarios f         ON f.id = pr.funcionario_id AND f.tenant_id = v_tenant
      LEFT JOIN support_tickets tk     ON tk.id = a.ticket_id
      LEFT JOIN service_categories tsc ON tsc.id = tk.category_id
      LEFT JOIN service_subcategories tss ON tss.id = tk.subcategory_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_atendimento_taxonomia(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_segmento_ids bigint[] DEFAULT NULL::bigint[], p_area_ids bigint[] DEFAULT NULL::bigint[], p_estado_ids bigint[] DEFAULT NULL::bigint[], p_cidade_ids bigint[] DEFAULT NULL::bigint[], p_fornecedor_ids bigint[] DEFAULT NULL::bigint[], p_produto_ids bigint[] DEFAULT NULL::bigint[], p_plantao text DEFAULT NULL::text, p_category_ids uuid[] DEFAULT NULL::uuid[], p_subcategory_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- DEM-0315: o UUID nulo dentro de p_category_ids é a opção "Sem categoria".
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
  v_has_cli boolean;
  v_mrr_min numeric := 50;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant nao identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao invalido: %', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_has_cli := COALESCE(array_length(p_segmento_ids,1),0) > 0
            OR COALESCE(array_length(p_area_ids,1),0) > 0
            OR COALESCE(array_length(p_estado_ids,1),0) > 0
            OR COALESCE(array_length(p_cidade_ids,1),0) > 0
            OR COALESCE(array_length(p_fornecedor_ids,1),0) > 0
            OR COALESCE(array_length(p_produto_ids,1),0) > 0;

  WITH cli_ok AS (
    SELECT c.id
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND (COALESCE(array_length(p_segmento_ids,1),0)=0 OR c.segmento_id = ANY(p_segmento_ids))
      AND (COALESCE(array_length(p_area_ids,1),0)=0 OR c.area_atuacao_id = ANY(p_area_ids))
      AND (COALESCE(array_length(p_estado_ids,1),0)=0 OR c.estado_id = ANY(p_estado_ids))
      AND (COALESCE(array_length(p_cidade_ids,1),0)=0 OR c.cidade_id = ANY(p_cidade_ids))
      AND (COALESCE(array_length(p_fornecedor_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.fornecedor_id = ANY(p_fornecedor_ids)))
      AND (COALESCE(array_length(p_produto_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.produto_id = ANY(p_produto_ids)))
  ),
  tk AS (
    SELECT produto_id, category_id, subcategory_id, service_type_id, status_id,
           canal_origem, tipo_horario, closed_by, cliente_id, aberto_em, motivo_cancelamento
    FROM support_tickets
    WHERE tenant_id = v_tenant
      AND deleted_at IS NULL
      AND aberto_em >= p_date_from AND aberto_em <= p_date_to
      AND (p_unidade_base_id IS NULL OR unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR unidade_base_id IS NULL OR unidade_base_id = ANY(v_unids))
      AND (p_department_id IS NULL OR department_id = p_department_id)
      AND (p_agent_id IS NULL OR responsavel_user_id = p_agent_id)
      AND (NOT v_has_cli OR cliente_id IN (SELECT id FROM cli_ok))
      AND (p_plantao IS NULL OR tipo_horario = p_plantao)
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND category_id IS NULL)
           OR (category_id IS NOT NULL
               AND (COALESCE(array_length(p_category_ids,1),0)=0 OR category_id = ANY(p_category_ids))
               AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR subcategory_id = ANY(p_subcategory_ids))))
  ),
  tot AS (SELECT count(*) AS n FROM tk),
  prod AS (SELECT produto_id, count(*) AS qtd FROM tk GROUP BY produto_id),
  cat AS (SELECT category_id, count(*) AS qtd FROM tk GROUP BY category_id),
  subcat AS (SELECT subcategory_id, count(*) AS qtd FROM tk GROUP BY subcategory_id),
  stype AS (SELECT service_type_id, count(*) AS qtd FROM tk GROUP BY service_type_id),
  canal AS (SELECT COALESCE(NULLIF(canal_origem,''),'(sem canal)') AS canal, count(*) AS qtd FROM tk GROUP BY 1),
  horario AS (SELECT COALESCE(NULLIF(tipo_horario,''),'(sem tipo)') AS tipo, count(*) AS qtd FROM tk GROUP BY 1),
  stat AS (
    SELECT COALESCE(ts.slug,'(sem-status)') AS slug,
           count(*) AS qtd,
           max(ts.name) AS nome,
           max(ts.color) AS color
    FROM tk
    LEFT JOIN ticket_statuses ts ON ts.id = tk.status_id
    GROUP BY COALESCE(ts.slug,'(sem-status)')
  ),
  resolv AS (
    SELECT t.closed_by, count(*) AS qtd
    FROM tk t
    JOIN ticket_statuses ts ON ts.id = t.status_id AND ts.is_terminal = true
    WHERE t.motivo_cancelamento IS NULL AND t.closed_by IS NOT NULL
    GROUP BY t.closed_by
  ),
  heat AS (
    SELECT EXTRACT(DOW FROM (aberto_em AT TIME ZONE 'America/Sao_Paulo'))::int AS dow,
           EXTRACT(HOUR FROM (aberto_em AT TIME ZONE 'America/Sao_Paulo'))::int AS hora,
           count(*) AS qtd
    FROM tk
    GROUP BY 1,2
  ),
  mrr_cli AS (
    SELECT cliente_id, SUM(vlr_mensal) AS mrr
    FROM cliente_produtos
    WHERE tenant_id = v_tenant AND ativo = true
    GROUP BY cliente_id
    HAVING SUM(vlr_mensal) >= v_mrr_min
  ),
  ofens AS (
    SELECT t.cliente_id, count(*) AS qtd, mc.mrr
    FROM tk t
    JOIN mrr_cli mc ON mc.cliente_id = t.cliente_id
    WHERE t.cliente_id IS NOT NULL
    GROUP BY t.cliente_id, mc.mrr
  ),
  ofens_rank AS (
    SELECT cliente_id, qtd, mrr,
           row_number() OVER (ORDER BY qtd DESC) AS rn_vol,
           row_number() OVER (ORDER BY (qtd / (mrr/1000.0)) DESC) AS rn_custo,
           sum(qtd) OVER () AS soma_com_cli
    FROM ofens
  ),
  cli AS (
    SELECT cp.produto_id, count(DISTINCT cp.cliente_id) AS clientes
    FROM cliente_produtos cp
    JOIN clientes c ON c.id = cp.cliente_id AND c.tenant_id = v_tenant
    WHERE cp.tenant_id = v_tenant AND cp.ativo = true
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_unids))
      AND (NOT v_has_cli OR cp.cliente_id IN (SELECT id FROM cli_ok))
    GROUP BY cp.produto_id
  ),
  ativos AS (
    SELECT count(*) AS n
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND COALESCE(c.cancelado,false) = false
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_unids))
      AND (NOT v_has_cli OR c.id IN (SELECT id FROM cli_ok))
  )
  SELECT jsonb_build_object(
    'total', (SELECT n FROM tot),
    'por_produto', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'produto_id', prod.produto_id, 'nome', COALESCE(p.nome,'(sem produto)'),
               'qtd', prod.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*prod.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY prod.qtd DESC)
      FROM prod LEFT JOIN produtos p ON p.id = prod.produto_id AND p.tenant_id = v_tenant), '[]'::jsonb),
    'por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'category_id', cat.category_id, 'nome', COALESCE(sc.nome,'(sem categoria)'),
               'qtd', cat.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*cat.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY cat.qtd DESC)
      FROM cat LEFT JOIN service_categories sc ON sc.id = cat.category_id), '[]'::jsonb),
    'por_subcategoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'subcategory_id', subcat.subcategory_id, 'nome', COALESCE(ssc.nome,'(sem subcategoria)'),
               'qtd', subcat.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*subcat.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY subcat.qtd DESC)
      FROM subcat LEFT JOIN service_subcategories ssc ON ssc.id = subcat.subcategory_id), '[]'::jsonb),
    'por_tipo_servico', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'service_type_id', stype.service_type_id, 'nome', COALESCE(stp.nome,'(sem tipo)'),
               'qtd', stype.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*stype.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY stype.qtd DESC)
      FROM stype LEFT JOIN service_types stp ON stp.id = stype.service_type_id), '[]'::jsonb),
    'por_status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', stat.slug, 'nome', COALESCE(stat.nome,'(sem status)'), 'color', stat.color,
               'qtd', stat.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*stat.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY stat.qtd DESC)
      FROM stat), '[]'::jsonb),
    'por_canal', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'canal', canal.canal, 'qtd', canal.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*canal.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY canal.qtd DESC)
      FROM canal), '[]'::jsonb),
    'por_horario', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'tipo', horario.tipo, 'qtd', horario.qtd,
               'pct', CASE WHEN (SELECT n FROM tot)>0 THEN ROUND(100.0*horario.qtd/(SELECT n FROM tot),1) ELSE 0 END)
             ORDER BY horario.qtd DESC)
      FROM horario), '[]'::jsonb),
    'resolvidos_por_atendente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'nome', COALESCE(f.nome,'(desconhecido)'), 'qtd', resolv.qtd)
             ORDER BY resolv.qtd DESC)
      FROM resolv
      LEFT JOIN profiles pr ON pr.user_id = resolv.closed_by AND pr.tenant_id = v_tenant
      LEFT JOIN funcionarios f ON f.id = pr.funcionario_id), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dow', heat.dow, 'hora', heat.hora, 'qtd', heat.qtd))
      FROM heat), '[]'::jsonb),
    'ofensores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'cliente_id', orank.cliente_id,
               'nome', COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)'),
               'qtd', orank.qtd)
             ORDER BY orank.qtd DESC)
      FROM ofens_rank orank LEFT JOIN clientes c ON c.id = orank.cliente_id
      WHERE orank.rn_vol <= 15), '[]'::jsonb),
    'custo_receita', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'cliente_id', orank.cliente_id,
               'nome', COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)'),
               'tickets', orank.qtd,
               'mrr', ROUND(orank.mrr, 2),
               'tickets_por_mil', ROUND(orank.qtd / (orank.mrr/1000.0), 2))
             ORDER BY (orank.qtd / (orank.mrr/1000.0)) DESC)
      FROM ofens_rank orank LEFT JOIN clientes c ON c.id = orank.cliente_id
      WHERE orank.rn_custo <= 15), '[]'::jsonb),
    'concentracao', (
      SELECT jsonb_build_object(
        'clientes_com_ticket', (SELECT count(*) FROM ofens),
        'tickets_com_cliente', COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0),
        'top1_qtd', COALESCE((SELECT qtd FROM ofens_rank WHERE rn_vol=1),0),
        'top1_pct', CASE WHEN COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0)>0
                         THEN ROUND(100.0*COALESCE((SELECT qtd FROM ofens_rank WHERE rn_vol=1),0)/(SELECT max(soma_com_cli) FROM ofens_rank),1) ELSE 0 END,
        'top10_pct', CASE WHEN COALESCE((SELECT max(soma_com_cli) FROM ofens_rank),0)>0
                          THEN ROUND(100.0*(SELECT COALESCE(sum(qtd),0) FROM ofens_rank WHERE rn_vol<=10)/(SELECT max(soma_com_cli) FROM ofens_rank),1) ELSE 0 END
      )
    ),
    'media_tickets_cliente', jsonb_build_object(
      'clientes_ativos', (SELECT n FROM ativos),
      'total_tickets', (SELECT n FROM tot),
      'media', CASE WHEN (SELECT n FROM ativos)>0 THEN ROUND((SELECT n FROM tot)::numeric/(SELECT n FROM ativos),2) ELSE NULL END
    ),
    'densidade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'produto_id', prod.produto_id, 'nome', COALESCE(p.nome,'(sem produto)'),
               'tickets', prod.qtd, 'clientes', COALESCE(cli.clientes,0),
               'ratio', CASE WHEN COALESCE(cli.clientes,0)>0 THEN ROUND(prod.qtd::numeric/cli.clientes,2) ELSE NULL END)
             ORDER BY (CASE WHEN COALESCE(cli.clientes,0)>0 THEN prod.qtd::numeric/cli.clientes ELSE 0 END) DESC)
      FROM prod
      LEFT JOIN produtos p ON p.id = prod.produto_id AND p.tenant_id = v_tenant
      LEFT JOIN cli ON cli.produto_id = prod.produto_id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMIT;
