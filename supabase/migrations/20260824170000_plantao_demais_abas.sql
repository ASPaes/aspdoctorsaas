-- ============================================================================
-- Filtro de plantão nas demais abas do dashboard de Atendimento
--
-- Segunda leva. A primeira (20260824130000) cobriu get_atendimento_velocidade.
-- Aqui entram: volume, agentes, satisfacao, ura, velocidade_timeline, chats e
-- nao_atendidos. Todas ganham `p_plantao text DEFAULT NULL` ('plantao' |
-- 'comercial' | NULL) e o predicado
--     (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(plantao,false))
-- na CTE que lê support_attendances. Custo zero com o filtro desligado: o OR
-- curto-circuita antes de tocar a coluna.
--
-- FICARAM DE FORA, e não por esquecimento:
--
--   get_atendimento_realtime / _realtime_chats (aba Tempo Real)
--     Mostram a fila ABERTA agora. A coluna plantao só é gravada no
--     fechamento, então tudo apareceria como comercial.
--
--   get_atendimento_chats_timeline
--     Divide o MRR do mês pelo número de atendimentos para dar o ticket médio.
--     Com o filtro, o numerador continua sendo o MRR inteiro e o ticket médio
--     dispara. Além disso ela nem recebe o período da barra de filtros.
--
--   get_atendimento_clientes
--     O score de risco soma chats + tickets, e os tickets vêm de
--     support_tickets, que tem mecanismo de horário próprio (tipo_horario).
--     Filtrar só a metade de chats deixaria "interações" misturando uma parte
--     filtrada com outra inteira.
--
--   get_atendimento_cobertura (super admin), _taxonomia, _backlog,
--   _latencia_histograma — ou não leem support_attendances, ou são de ticket.
--
-- Em get_atendimento_agentes as CTEs de latência vêm de whatsapp_messages e
-- não passam por atendimento: ali o recorte é o INSTANTE da resposta do
-- agente, via fn_instante_fora_expediente.
--
-- Em get_atendimento_volume a CTE `firsts` NÃO é filtrada: ela é a referência
-- que separa novos de recorrentes.
--
-- Gerado a partir das definições vigentes em produção em 24/08/2026, depois de
-- aplicadas via apply_migration. O DO block derruba todas as sobrecargas pelo
-- oid antes de recriar — adicionar parâmetro muda a assinatura e um
-- CREATE OR REPLACE deixaria a antiga viva, com o PostgREST ambíguo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- get_atendimento_volume
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_volume'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
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

  WITH firsts AS (
    SELECT contact_id, MIN(opened_at) AS first_at
    FROM support_attendances
    WHERE tenant_id = v_tenant AND closed_reason IS DISTINCT FROM 'ura_autoatendimento' AND contact_id IS NOT NULL
      AND (msg_customer_count > 0 OR last_customer_message_at IS NOT NULL)
      AND (p_unidade_base_id IS NULL OR unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR unidade_base_id IS NULL OR unidade_base_id = ANY(v_unids))
      AND (p_is_group IS NULL OR COALESCE(is_group, false) = p_is_group)
    GROUP BY contact_id
  ),
  base_all AS (
    SELECT a.created_from
    FROM support_attendances a
    WHERE a.tenant_id = v_tenant AND a.closed_reason IS DISTINCT FROM 'ura_autoatendimento'
      AND a.opened_at >= p_date_from AND a.opened_at <= p_date_to
      AND (p_department_id IS NULL OR a.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR a.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR a.unidade_base_id IS NULL OR a.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR a.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(a.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(a.plantao, false))
  ),
  base AS (
    SELECT a.opened_at, a.created_from, a.ai_tags, f.first_at,
           (a.opened_at AT TIME ZONE 'America/Sao_Paulo') AS local_ts
    FROM support_attendances a
    LEFT JOIN firsts f ON f.contact_id = a.contact_id
    WHERE a.tenant_id = v_tenant AND a.closed_reason IS DISTINCT FROM 'ura_autoatendimento'
      AND a.opened_at >= p_date_from AND a.opened_at <= p_date_to
      AND (a.msg_customer_count > 0 OR a.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR a.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR a.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR a.unidade_base_id IS NULL OR a.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR a.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(a.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(a.plantao, false))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'novos',       (SELECT count(*) FROM base WHERE first_at IS NOT NULL AND opened_at = first_at),
    'recorrentes', (SELECT count(*) FROM base WHERE first_at IS NOT NULL AND opened_at > first_at),
    'proativo', (SELECT count(*) FROM base_all WHERE created_from IN ('agent','operator','billing_automation','ticket')),
    'reativo',  (SELECT count(*) FROM base_all WHERE created_from IN ('customer','out_of_hours')),
    'canais', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('canal', COALESCE(created_from,'(sem origem)'), 'qtd', c) ORDER BY c DESC)
      FROM (SELECT created_from, count(*) c FROM base_all GROUP BY created_from) x), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'qtd', c))
      FROM (SELECT EXTRACT(DOW FROM local_ts)::int AS dow, EXTRACT(HOUR FROM local_ts)::int AS hora, count(*) c
            FROM base GROUP BY 1,2) h), '[]'::jsonb),
    'top_motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tag', tag, 'qtd', c) ORDER BY c DESC)
      FROM (SELECT unnest(ai_tags) AS tag, count(*) c FROM base WHERE ai_tags IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 15) t), '[]'::jsonb),
    'motivos_cobertura', (SELECT CASE WHEN count(*)>0
        THEN ROUND(100.0*count(*) FILTER (WHERE ai_tags IS NOT NULL AND array_length(ai_tags,1)>=1)/count(*),1) ELSE NULL END FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_agentes
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_agentes'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_agentes"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
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
           sa.first_response_time_seconds, sa.csat_score, sa.csat_sent, sa.msg_agent_count
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
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_agentes"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_is_group" boolean, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_agentes"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_is_group" boolean, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_agentes"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_is_group" boolean, "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_satisfacao
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_satisfacao'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_satisfacao"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
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

  WITH csat AS (
    SELECT sc.score, COALESCE(sc.department_id, sa.department_id) AS dept_id,
           sa.assigned_to
    FROM support_csat sc
    JOIN support_attendances sa ON sa.id = sc.attendance_id
    WHERE sc.tenant_id = v_tenant
      AND sc.asked_at >= p_date_from AND sc.asked_at <= p_date_to
      AND (p_department_id IS NULL OR COALESCE(sc.department_id, sa.department_id) = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  att AS (
    SELECT sa.csat_score, sa.last_sentiment, sa.reopen_count, sa.ticket_id,
           (COALESCE(sa.wait_seconds,0) + COALESCE(sa.handle_seconds,0))::int AS resol_seconds
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status IN ('closed','inactive_closed')
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  )
  SELECT jsonb_build_object(
    'enviadas',  (SELECT count(*) FROM csat),
    'respostas', (SELECT count(*) FROM csat WHERE score IS NOT NULL),
    'media',     (SELECT ROUND(AVG(score)::numeric,2) FROM csat WHERE score IS NOT NULL),
    'response_rate_pct', (SELECT CASE WHEN count(*)>0
        THEN ROUND(100.0*count(*) FILTER (WHERE score IS NOT NULL)/count(*),1) ELSE NULL END FROM csat),
    'distribuicao', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('score', g.score, 'qtd', COALESCE(c.qtd,0)) ORDER BY g.score)
      FROM generate_series(0,5) g(score)
      LEFT JOIN (SELECT score, count(*) AS qtd FROM csat WHERE score IS NOT NULL GROUP BY score) c ON c.score=g.score
    ), '[]'::jsonb),
    'por_setor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('department_id', s.dept_id, 'setor', COALESCE(d.name,'Sem setor'),
                                          'media', s.media, 'respostas', s.respostas) ORDER BY s.respostas DESC)
      FROM (SELECT dept_id, ROUND(AVG(score)::numeric,2) AS media, count(*) AS respostas
            FROM csat WHERE score IS NOT NULL GROUP BY dept_id) s
      LEFT JOIN support_departments d ON d.id = s.dept_id
    ), '[]'::jsonb),
    'por_agente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'agent_id', s.assigned_to,
               'nome', COALESCE(f.nome, 'Sem agente'),
               'enviadas', s.enviadas,
               'respondidas', s.respondidas,
               'taxa_pct', CASE WHEN s.enviadas > 0 THEN ROUND(100.0*s.respondidas/s.enviadas,1) ELSE NULL END,
               'media', s.media)
             ORDER BY s.respondidas DESC, s.enviadas DESC)
      FROM (SELECT assigned_to,
                   count(*) AS enviadas,
                   count(*) FILTER (WHERE score IS NOT NULL) AS respondidas,
                   ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric,2) AS media
            FROM csat GROUP BY assigned_to) s
      LEFT JOIN profiles p ON p.user_id = s.assigned_to AND p.tenant_id = v_tenant
      LEFT JOIN funcionarios f ON f.id = p.funcionario_id AND f.tenant_id = v_tenant
    ), '[]'::jsonb),
    'div_neg_total',     (SELECT count(*) FROM att WHERE last_sentiment='negative' AND csat_score IS NOT NULL),
    'div_neg_nota_alta', (SELECT count(*) FROM att WHERE last_sentiment='negative' AND csat_score >= 4),
    'resolucao_por_nota', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('score', r.score, 'mediana_seg', r.mediana, 'qtd', r.qtd) ORDER BY r.score)
      FROM (SELECT csat_score AS score,
                   ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY resol_seconds)
                         FILTER (WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')))::int AS mediana,
                   count(*) AS qtd
            FROM att WHERE csat_score IS NOT NULL GROUP BY csat_score) r
    ), '[]'::jsonb),
    'total_encerrados', (SELECT count(*) FROM att),
    'atendeu_na_hora',  (SELECT count(*) FROM att WHERE reopen_count=0 AND ticket_id IS NULL),
    'atendeu_na_hora_pct', (SELECT CASE WHEN count(*)>0
        THEN ROUND(100.0*count(*) FILTER (WHERE reopen_count=0 AND ticket_id IS NULL)/count(*),1) ELSE NULL END FROM att)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_satisfacao"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_satisfacao"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_satisfacao"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_ura
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_ura'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_ura"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
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
    SELECT ura_state, ura_invalid_count, ura_sent_at
    FROM support_attendances
    WHERE tenant_id = v_tenant
      AND opened_at >= p_date_from AND opened_at <= p_date_to
      AND (p_department_id IS NULL OR department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR unidade_base_id IS NULL OR unidade_base_id = ANY(v_unids))
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(plantao, false))
  ),
  enviadas AS (SELECT * FROM base WHERE ura_sent_at IS NOT NULL)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'enviadas', (SELECT count(*) FROM enviadas),
    'com_ura_pct', (SELECT CASE WHEN count(*)>0
        THEN ROUND(100.0*count(*) FILTER (WHERE ura_sent_at IS NOT NULL)/count(*),1) ELSE NULL END FROM base),
    'completadas', (SELECT count(*) FROM enviadas WHERE ura_state='completed'),
    'timeout',     (SELECT count(*) FROM enviadas WHERE ura_state='timeout_fallback'),
    'pendentes',   (SELECT count(*) FROM enviadas WHERE ura_state='pending'),
    'confusas',    (SELECT count(*) FROM enviadas WHERE ura_invalid_count > 0),
    'completadas_pct', (SELECT CASE WHEN count(*)>0 THEN ROUND(100.0*count(*) FILTER (WHERE ura_state='completed')/count(*),1) ELSE NULL END FROM enviadas),
    'timeout_pct',     (SELECT CASE WHEN count(*)>0 THEN ROUND(100.0*count(*) FILTER (WHERE ura_state='timeout_fallback')/count(*),1) ELSE NULL END FROM enviadas),
    'pendentes_pct',   (SELECT CASE WHEN count(*)>0 THEN ROUND(100.0*count(*) FILTER (WHERE ura_state='pending')/count(*),1) ELSE NULL END FROM enviadas),
    'confusas_pct',    (SELECT CASE WHEN count(*)>0 THEN ROUND(100.0*count(*) FILTER (WHERE ura_invalid_count > 0)/count(*),1) ELSE NULL END FROM enviadas)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_ura"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_ura"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_ura"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_velocidade_timeline
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_velocidade_timeline'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_velocidade_timeline"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text" DEFAULT 'day'::"text", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_sla_frt_seconds" integer DEFAULT 900, "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_trunc text;
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

  v_trunc := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;

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
             'tmr_p50', g.tmr_p50
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
  ) g;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_velocidade_timeline"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_department_id" "uuid", "p_sla_frt_seconds" integer, "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_velocidade_timeline"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_department_id" "uuid", "p_sla_frt_seconds" integer, "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_velocidade_timeline"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_department_id" "uuid", "p_sla_frt_seconds" integer, "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_chats
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_chats"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_segmento_ids" bigint[] DEFAULT NULL::bigint[], "p_area_ids" bigint[] DEFAULT NULL::bigint[], "p_estado_ids" bigint[] DEFAULT NULL::bigint[], "p_cidade_ids" bigint[] DEFAULT NULL::bigint[], "p_fornecedor_ids" bigint[] DEFAULT NULL::bigint[], "p_produto_ids" bigint[] DEFAULT NULL::bigint[], "p_closed_reasons" "text"[] DEFAULT NULL::"text"[], "p_has_ticket" boolean DEFAULT NULL::boolean, "p_is_group" boolean DEFAULT NULL::boolean, "p_sentiments" "text"[] DEFAULT NULL::"text"[], "p_resolucoes" "text"[] DEFAULT NULL::"text"[], "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
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
    SELECT status, last_sentiment, resolucao, csat_score, csat_sent, assigned_to, cliente_id, opened_at
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
  ),
  tot AS (SELECT count(*) AS n FROM at),
  st AS (SELECT COALESCE(NULLIF(status,''),'(sem)') AS status, count(*) AS qtd FROM at GROUP BY 1),
  sent AS (SELECT last_sentiment, count(*) AS qtd FROM at WHERE last_sentiment IS NOT NULL GROUP BY last_sentiment),
  res AS (SELECT COALESCE(resolucao, '(sem)') AS resolucao, count(*) AS qtd FROM at GROUP BY 1),
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
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_chats"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_chats"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_chats"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- get_atendimento_nao_atendidos
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_nao_atendidos'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_nao_atendidos"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_limit" integer DEFAULT 200, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    SELECT sa.id, sa.attendance_code, sa.conversation_id, sa.contact_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id, sa.department_id,
           sa.opened_at, sa.closed_at, sa.assumed_at,
           sa.ticket_id, COALESCE(sa.created_from, '') AS created_from,
           COALESCE(sa.msg_agent_count, 0)    AS msg_agent_count,
           COALESCE(sa.msg_customer_count, 0) AS msg_customer_count
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
  nao_assumidos AS (
    -- O conjunto do card, inteiro. O motivo separa o que antes era "vácuo" do
    -- resto: 'ticket' vem primeiro porque encaminhar para ticket é o desfecho —
    -- mesmo que uma mensagem tenha saído antes disso.
    SELECT b.*,
           CASE
             WHEN b.ticket_id IS NOT NULL OR b.created_from = 'ticket' THEN 'ticket'
             WHEN b.msg_agent_count > 0                                THEN 'respondido'
             ELSE 'sem_resposta'
           END AS motivo
    FROM base b
    WHERE b.assumed_at IS NULL
  ),
  chats AS (
    SELECT n.*,
           COALESCE(n.contact_id::text, n.contact_phone, n.id::text) AS grp,
           sd.name AS departamento,
           COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') AS cliente_nome,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(n.closed_at, now()) - n.opened_at))::int, 0) AS aberto_seg
    FROM nao_assumidos n
    LEFT JOIN support_departments sd ON sd.id = n.department_id
    LEFT JOIN clientes c            ON c.id  = n.cliente_id
  ),
  agrupado AS (
    SELECT grp,
           (array_agg(COALESCE(contact_name, contact_phone, 'Sem nome') ORDER BY opened_at DESC))[1] AS contato,
           (array_agg(contact_phone ORDER BY opened_at DESC))[1] AS telefone,
           (array_agg(cliente_id   ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_id,
           (array_agg(cliente_nome ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_nome,
           count(*)::int  AS qtd,
           count(*) FILTER (WHERE motivo = 'sem_resposta')::int AS qtd_sem_resposta,
           max(opened_at) AS ultimo_at,
           jsonb_agg(jsonb_build_object(
             'attendance_id',      id,
             'attendance_code',    attendance_code,
             'conversation_id',    conversation_id,
             'opened_at',          opened_at,
             'closed_at',          closed_at,
             'departamento',       departamento,
             'msg_customer_count', msg_customer_count,
             'msg_agent_count',    msg_agent_count,
             'motivo',             motivo,
             'aberto_seg',         aberto_seg
           ) ORDER BY opened_at DESC) AS chats
    FROM chats
    GROUP BY grp
  )
  SELECT jsonb_build_object(
    'total_card',         (SELECT count(*) FROM nao_assumidos),
    'total_sem_resposta', (SELECT count(*) FROM nao_assumidos WHERE motivo = 'sem_resposta'),
    'total_respondido',   (SELECT count(*) FROM nao_assumidos WHERE motivo = 'respondido'),
    'total_ticket',       (SELECT count(*) FROM nao_assumidos WHERE motivo = 'ticket'),
    'total_chats',        (SELECT count(*) FROM nao_assumidos),
    'total_contatos',     (SELECT count(*) FROM agrupado),
    'truncado',           (SELECT count(*) FROM agrupado) > p_limit,
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contato',          a.contato,
               'telefone',         a.telefone,
               'cliente_id',       a.cliente_id,
               'cliente_nome',     CASE WHEN a.cliente_id IS NULL THEN NULL ELSE a.cliente_nome END,
               'qtd',              a.qtd,
               'qtd_sem_resposta', a.qtd_sem_resposta,
               'ultimo_at',        a.ultimo_at,
               'chats',            a.chats
             ) ORDER BY a.qtd DESC, a.ultimo_at DESC)
      FROM (SELECT * FROM agrupado ORDER BY qtd DESC, ultimo_at DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_nao_atendidos"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_limit" integer, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_nao_atendidos"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_limit" integer, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_nao_atendidos"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_limit" integer, "p_plantao" "text") TO "service_role";
