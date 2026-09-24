-- ⛔ NAO RODE ESTE ARQUIVO SOZINHO. Ele ja esta contido na migration
-- `20260924030000_dem0462_latencia_horario_comercial.sql`, que e a versao boa.
--
-- Historico: esta migration foi aplicada em 24/09/2026 DEPOIS da DEM-0462, que
-- mexe nas MESMAS tres funcoes, e apagou o calculo de latencia por expediente —
-- os corpos abaixo foram copiados de producao antes daquela subir. A DEM-0462 foi
-- reaplicada no mesmo dia, ja com a regra desta aqui dentro, e producao hoje
-- confere byte a byte com o arquivo `…030000`.
--
-- Licao, para a proxima: `CREATE OR REPLACE` de funcao inteira e destrutivo por
-- natureza. Copie o corpo de producao no INSTANTE de aplicar, nunca no instante
-- de gerar o SQL, e confira com `pg_get_functiondef` por TODAS as DEMs que
-- deveriam estar ali depois de aplicar. Ver `colisao-create-or-replace-entre-sessoes`.

-- DEM-0464 - a latencia do agente parava de contar quem ele nao estava atendendo.
--
-- A latencia nasce em whatsapp_messages, casando bloco do cliente -> primeiro
-- bloco do agente seguinte, e nunca olhava support_attendances. Entao qualquer
-- mensagem de agente numa conversa cobrava dele TODA a espera desde a ultima
-- fala do cliente, mesmo que o atendimento daquela fala ja tivesse encerrado
-- horas antes e com outro agente.
--
-- Caso que abriu a demanda (Digi Office, 17/09/2026, conversa 89abc2ef):
-- o cliente respondeu a pesquisa de CSAT com "5" as 13:36, o atendimento
-- 07904/26 ja estava encerrado desde 13:31 pelo Igor, e as 14:46 a Kimberly
-- digitou "Oii" numa aba esquecida. O par casou e cobrou 4.207 s (1h10) dela,
-- abaixo do teto de 4h, ou seja, dentro da mediana e do p90.
--
-- A trava do compositor (composerTravado.ts + a guarda na send-whatsapp-message)
-- impede a mensagem acidental daqui pra frente, mas nao resolve isto sozinha:
-- quando alguem clica REABRIR e responde de proposito, a mensagem antiga do
-- cliente continua casando com a resposta nova.
--
-- Regra: o atendimento vigente no instante da RESPOSTA precisa ter nascido ate
-- 5 minutos depois da mensagem do cliente. As tres funcoes mudam juntas porque
-- o card, o histograma e a lista do drill-down tem de fechar no mesmo numero.
--
-- Medido em producao (Digi Office, 30 dias): remove 38 pares de 13.700 (0,3%).
-- Efeito maior no p90 e nos outliers, que e onde o erro aparecia:
--   Matheus   p50 1067s -> 292s
--   Fabricio  p90 1340s -> 856s
--   Geovanna  p50  254s -> 220s
--
-- Corpos copiados de producao em 24/09/2026 (pg_get_functiondef), nao do repo:
-- as tres ja tinham p_category_ids/p_subcategory_ids do DEM-0315, que a
-- migration 20260916190000 deste repo nao conhece.

CREATE OR REPLACE FUNCTION "public"."get_atendimento_agentes"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text", "p_category_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_subcategory_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    -- DEM-0464: o atendimento em que o agente respondeu precisa ja existir
    -- quando o cliente mandou a mensagem. Se ele nasceu DEPOIS, esta resposta
    -- nao e resposta aquela mensagem: e alguem voltando a uma conversa antiga.
    LEFT JOIN LATERAL (
      SELECT sa.opened_at
      FROM support_attendances sa
      WHERE sa.conversation_id = c.conversation_id
        AND sa.tenant_id = v_tenant
        AND sa.opened_at <= a.agt_first
        AND COALESCE(sa.closed_at, now()) >= a.agt_first
      ORDER BY sa.opened_at DESC
      LIMIT 1
    ) att_resp ON true
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    WHERE a.agente IS NOT NULL
      AND (att_resp.opened_at IS NULL
           OR att_resp.opened_at <= c.cli_first + interval '5 minutes')
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
$$;;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_latencia_histograma"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_category_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_subcategory_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    -- DEM-0464: o atendimento em que o agente respondeu precisa ja existir
    -- quando o cliente mandou a mensagem. Se ele nasceu DEPOIS, esta resposta
    -- nao e resposta aquela mensagem: e alguem voltando a uma conversa antiga.
    LEFT JOIN LATERAL (
      SELECT sa.opened_at
      FROM support_attendances sa
      WHERE sa.conversation_id = c.conversation_id
        AND sa.tenant_id = v_tenant
        AND sa.opened_at <= a.agt_first
        AND COALESCE(sa.closed_at, now()) >= a.agt_first
      ORDER BY sa.opened_at DESC
      LIMIT 1
    ) att_resp ON true
    WHERE a.agente IS NOT NULL
      AND (att_resp.opened_at IS NULL
           OR att_resp.opened_at <= c.cli_first + interval '5 minutes')
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
$$;;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_latencia_agente"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_agent_id" "uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 200, "p_category_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_subcategory_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    -- DEM-0464: o atendimento em que o agente respondeu precisa ja existir
    -- quando o cliente mandou a mensagem. Se ele nasceu DEPOIS, esta resposta
    -- nao e resposta aquela mensagem: e alguem voltando a uma conversa antiga.
    LEFT JOIN LATERAL (
      SELECT sa.opened_at
      FROM support_attendances sa
      WHERE sa.conversation_id = c.conversation_id
        AND sa.tenant_id = v_tenant
        AND sa.opened_at <= a.agt_first
        AND COALESCE(sa.closed_at, now()) >= a.agt_first
      ORDER BY sa.opened_at DESC
      LIMIT 1
    ) att_resp ON true
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    WHERE a.agente = p_agent_id
      AND (att_resp.opened_at IS NULL
           OR att_resp.opened_at <= c.cli_first + interval '5 minutes')
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
$$;;

