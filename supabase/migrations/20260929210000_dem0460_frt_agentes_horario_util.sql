-- DEM-0460 (2º passo) — 1ª resposta por agente em horário útil do setor
--
-- A aba Velocidade passou a medir TME e 1ª Resposta só no expediente do setor
-- (`20260929200000`). A aba Agentes seguia com `first_response_time_seconds` no
-- relógio de parede, e as duas telas mostravam números diferentes para a mesma
-- coisa. Aqui só o `frt_p50` de cada agente muda; o resto da função é o corpo de
-- produção de 29/09/2026 (pg_get_functiondef), sem outra alteração.
--
-- Quem mexer de novo nesta função: copie o corpo de produção na hora. Ela carrega
-- DEM-0315, DEM-0462, DEM-0464 e agora DEM-0460; confira as quatro depois.

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

  WITH base0 AS (
    SELECT sa.id, sa.assigned_to, sa.status, sa.reopen_count, sa.handle_seconds,
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
  -- DEM-0460: 1ª resposta em tempo útil do setor, mesma régua da aba Velocidade.
  util AS (
    SELECT * FROM public.fn_atendimento_tempos_uteis(v_tenant, ARRAY(SELECT id FROM base0))
  ),
  base AS (
    SELECT b.*, u.frt_util AS frt_seg
    FROM base0 b
    LEFT JOIN util u ON u.attendance_id = b.id
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
  -- DEM-0462: o relógio da latência só corre dentro do expediente. `jan` traz as
  -- janelas abertas do período e a latência do par (bloco do cliente -> primeira
  -- resposta do agente) é a soma da interseção com essas janelas.
  jan AS (
    SELECT j.dep_key, j.ini, j.fim
    FROM public.fn_expediente_slots(v_tenant, p_date_from, p_date_to) j
  ),
  lat_par AS (
    SELECT a.agente AS sent_by_user_id, c.conversation_id, c.block_id,
           c.cli_first, a.agt_first,
           COALESCE(att_resp.department_id, wc.department_id,
                    '00000000-0000-0000-0000-000000000000'::uuid) AS dep_key
    FROM lat_cli c
    JOIN lat_agt a ON a.conversation_id = c.conversation_id AND a.block_id = c.block_id + 1
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    -- DEM-0464: o atendimento em que o agente respondeu precisa ja existir
    -- quando o cliente mandou a mensagem. Se ele nasceu DEPOIS, esta resposta
    -- nao e resposta aquela mensagem: e alguem voltando a uma conversa antiga.
    -- DEM-0462: e é dele que sai o setor cujo expediente vale, porque
    -- `whatsapp_conversations.department_id` é limpo no fechamento.
    LEFT JOIN LATERAL (
      SELECT sa.opened_at, sa.department_id
      FROM support_attendances sa
      WHERE sa.conversation_id = c.conversation_id
        AND sa.tenant_id = v_tenant
        AND sa.opened_at <= a.agt_first
        AND COALESCE(sa.closed_at, now()) >= a.agt_first
      ORDER BY sa.opened_at DESC
      LIMIT 1
    ) att_resp ON true
    WHERE a.agente IS NOT NULL
      AND (p_is_group IS NULL OR COALESCE(wc.is_group, false) = p_is_group)
      AND (att_resp.opened_at IS NULL
           OR att_resp.opened_at <= c.cli_first + interval '5 minutes')
      -- O teto (`kpi_cap_seconds`) passou a valer sobre o tempo útil; aqui fica só
      -- a guarda de sanidade, para um par muito distante não virar varredura.
      AND a.agt_first > c.cli_first
      AND a.agt_first <= c.cli_first + interval '7 days'
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
  lat_gap AS (
    SELECT p.sent_by_user_id,
           -- LEAST/GREATEST ignoram NULL: sem o CASE, par sem janela nenhuma
           -- voltaria com o tempo corrido inteiro.
           COALESCE(SUM(CASE WHEN w.ini IS NULL THEN 0
                             ELSE GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p.agt_first, w.fim)
                                                               - GREATEST(p.cli_first, w.ini)))) END), 0) AS gap
    FROM lat_par p
    LEFT JOIN jan w ON w.dep_key = p.dep_key AND w.fim > p.cli_first AND w.ini < p.agt_first
    GROUP BY p.sent_by_user_id, p.conversation_id, p.block_id, p.cli_first, p.agt_first
  ),
  lat AS (
    SELECT sent_by_user_id,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap))::int AS lat_p50,
           (ARRAY['<30s','30s-1min','1-2min','2-5min','5-10min','10-30min','30min+'])[
              mode() WITHIN GROUP (ORDER BY width_bucket(gap, ARRAY[30,60,120,300,600,1800])) + 1
           ] AS lat_faixa
    FROM lat_gap
    WHERE gap BETWEEN 1 AND kpi_cap_seconds('latencia')
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
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.frt_seg)
            FILTER (WHERE b.frt_seg BETWEEN 1 AND kpi_cap_seconds('frt')))::int AS frt_p50,
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

COMMIT;
