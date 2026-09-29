-- Visão 360° do colaborador (parte 1): números de um agente no período,
-- comparados com o setor dele, e o status ao vivo.
--
-- Quem vê quem (decisão de 28/09/2026):
--   user  -> só a própria visão
--   head  -> ele e a equipe dos setores em que é membro ativo
--   admin / super admin -> todos do tenant
-- O recorte é feito AQUI, não na tela: pedir o id de alguém fora do escopo
-- levanta erro, e a lista `equipe` só traz quem o chamador pode abrir.
--
-- Comparação: cada agente é comparado com os colegas do próprio setor
-- (support_department_members, a mesma tabela que o motor de distribuição lê).
-- Setor com menos de 3 agentes elegíveis compara com o tenant inteiro.
-- Elegível = pelo menos 5 atendimentos encerrados no período.
--
-- `pct` de cada métrica = fração do grupo que o agente iguala ou supera
-- (cume_dist na direção "melhor"). A nota final é montada na tela a partir
-- desses pct, com pesos (src/components/colaborador360/colaborador360Calc.ts).

CREATE OR REPLACE FUNCTION public.get_colaborador_360(
  p_user_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_super boolean := COALESCE(public.is_super_admin(), false);
  v_tenant uuid;
  v_role text;
  v_escopo text;
  v_alvo uuid;
  v_visiveis uuid[];
  v_from timestamptz := COALESCE(p_date_from, date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' - interval '29 days');
  v_to timestamptz := COALESCE(p_date_to, now());
  v_hoje timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  IF p_tenant_id IS NOT NULL AND v_super THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  SELECT p.role INTO v_role FROM profiles p WHERE p.user_id = v_caller LIMIT 1;
  v_escopo := CASE WHEN v_super OR v_role = 'admin' THEN 'todos'
                   WHEN v_role = 'head' THEN 'setor'
                   ELSE 'proprio' END;

  v_alvo := COALESCE(p_user_id, v_caller);

  -- Quem o chamador pode abrir.
  IF v_escopo = 'todos' THEN
    SELECT array_agg(p.user_id) INTO v_visiveis FROM profiles p
    WHERE p.tenant_id = v_tenant;
  ELSIF v_escopo = 'setor' THEN
    SELECT array_agg(DISTINCT m.user_id) INTO v_visiveis FROM support_department_members m
    WHERE m.tenant_id = v_tenant AND COALESCE(m.is_active, true)
      AND m.department_id IN (SELECT m2.department_id FROM support_department_members m2
                              WHERE m2.user_id = v_caller AND m2.tenant_id = v_tenant AND COALESCE(m2.is_active, true));
  END IF;
  v_visiveis := array_append(COALESCE(v_visiveis, '{}'::uuid[]), v_caller);

  IF NOT (v_alvo = ANY(v_visiveis))
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = v_alvo AND p.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para ver este colaborador' USING ERRCODE = '42501';
  END IF;

  WITH setor AS (
    -- 1 agente = 1 setor; se houver mais de uma linha, fica a mais antiga.
    SELECT DISTINCT ON (m.user_id) m.user_id, m.department_id, d.name AS setor
    FROM support_department_members m
    JOIN support_departments d ON d.id = m.department_id
    WHERE m.tenant_id = v_tenant AND COALESCE(m.is_active, true)
    ORDER BY m.user_id, m.created_at
  ),
  base AS (
    SELECT sa.assigned_to, sa.status, sa.reopen_count, sa.handle_seconds, sa.handoffs_count,
           sa.first_response_time_seconds, sa.csat_score, sa.csat_sent, sa.ticket_id,
           sa.resolucao, sa.sentiment_final
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= v_from AND sa.opened_at <= v_to
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= now())
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND sa.assigned_to IS NOT NULL
  ),
  tk AS (
    SELECT t.responsavel_user_id AS user_id,
           count(*) FILTER (WHERE t.concluido_em >= v_from AND t.concluido_em <= v_to
                              AND t.motivo_cancelamento IS NULL) AS tk_resolvidos,
           ROUND(AVG(EXTRACT(EPOCH FROM (t.concluido_em - t.aberto_em)) / 86400.0)
                 FILTER (WHERE t.concluido_em >= v_from AND t.concluido_em <= v_to
                           AND t.motivo_cancelamento IS NULL AND t.aberto_em IS NOT NULL), 1) AS tk_dias_medio
    FROM support_tickets t
    WHERE t.tenant_id = v_tenant AND t.deleted_at IS NULL AND t.responsavel_user_id IS NOT NULL
    GROUP BY t.responsavel_user_id
  ),
  tk_abertos AS (
    SELECT t.responsavel_user_id AS user_id, count(*) AS n, MIN(t.aberto_em) AS mais_antigo
    FROM support_tickets t
    LEFT JOIN ticket_statuses s ON s.id = t.status_id
    WHERE t.tenant_id = v_tenant AND t.deleted_at IS NULL AND t.responsavel_user_id IS NOT NULL
      AND t.concluido_em IS NULL AND NOT COALESCE(s.is_terminal, false)
    GROUP BY t.responsavel_user_id
  ),
  ag AS (
    SELECT
      b.assigned_to AS user_id,
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed')) AS encerrados,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.first_response_time_seconds)
            FILTER (WHERE b.first_response_time_seconds BETWEEN 1 AND kpi_cap_seconds('frt')))::int AS frt_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.handle_seconds)
            FILTER (WHERE b.handle_seconds BETWEEN 1 AND kpi_cap_seconds('tma')))::int AS tma_p50,
      ROUND(AVG(b.csat_score) FILTER (WHERE b.csat_score IS NOT NULL), 2) AS csat,
      count(*) FILTER (WHERE b.csat_score IS NOT NULL) AS csat_n,
      count(*) FILTER (WHERE b.csat_score >= 4) AS csat_satisfeitos,
      count(*) FILTER (WHERE COALESCE(b.csat_sent, false)) AS csat_enviados,
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed') AND b.reopen_count > 0) AS reabertos,
      -- Resolvido no 1º contato: a IA selou "resolvido", não virou ticket,
      -- não foi transferido e não reabriu. A base exclui "cliente não respondeu",
      -- que não é mérito nem culpa do agente.
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed') AND b.resolucao = 'resolvido'
                         AND b.ticket_id IS NULL AND COALESCE(b.handoffs_count, 0) = 0
                         AND COALESCE(b.reopen_count, 0) = 0) AS fcr_n,
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed') AND b.resolucao IS NOT NULL
                         AND b.resolucao <> 'sem_resposta_cliente') AS fcr_base,
      count(*) FILTER (WHERE b.status IN ('closed','inactive_closed')
                         AND b.resolucao IN ('resolvido','parcial','nao_resolvido')) AS ia_n,
      count(*) FILTER (WHERE b.sentiment_final = 'positive') AS sent_pos,
      count(*) FILTER (WHERE b.sentiment_final = 'neutral') AS sent_neu,
      count(*) FILTER (WHERE b.sentiment_final = 'negative') AS sent_neg
    FROM base b
    GROUP BY b.assigned_to
  ),
  m AS (
    SELECT a.*, s.department_id, s.setor,
           COALESCE(tk.tk_resolvidos, 0) AS tk_resolvidos, tk.tk_dias_medio,
           -- Resolução e qualidade dependem da IA. Tenant com a análise desligada
           -- tem só um punhado de selos, quase sempre de falha: sem cobertura
           -- mínima (10 selos e metade dos encerrados), a métrica fica NULL
           -- e sai da nota em vez de puxar para zero.
           CASE WHEN a.ia_n >= 10 AND a.ia_n >= 0.5 * a.encerrados AND a.fcr_base > 0
                THEN ROUND(100.0 * a.fcr_n / a.fcr_base, 1) END AS fcr_pct,
           CASE WHEN a.encerrados > 0 THEN ROUND(100.0 * a.reabertos / a.encerrados, 1) END AS reabertura_pct,
           CASE WHEN a.sent_pos + a.sent_neu + a.sent_neg >= 10
                 AND a.sent_pos + a.sent_neu + a.sent_neg >= 0.5 * a.encerrados
                THEN ROUND(100.0 * (a.sent_pos + 0.5 * a.sent_neu) / (a.sent_pos + a.sent_neu + a.sent_neg), 1) END AS qualidade,
           (a.encerrados >= 5) AS elegivel
    FROM ag a
    LEFT JOIN setor s ON s.user_id = a.user_id
    LEFT JOIN tk ON tk.user_id = a.user_id
    JOIN profiles p ON p.user_id = a.user_id AND p.tenant_id = v_tenant
  ),
  -- Grupo de comparação: o setor, se tiver 3+ elegíveis; senão o tenant.
  grp AS (
    SELECT m.*,
           CASE WHEN count(*) FILTER (WHERE m.elegivel) OVER (PARTITION BY m.department_id) >= 3
                THEN m.department_id::text ELSE 'tenant' END AS grupo
    FROM m
  ),
  -- Linhas elegíveis duplicadas no grupo "tenant" para que quem cai nele
  -- seja comparado com todos.
  pool AS (
    SELECT g.*, g.grupo AS g_key FROM grp g WHERE g.elegivel
    UNION ALL
    SELECT g.*, 'tenant' FROM grp g WHERE g.elegivel AND g.grupo <> 'tenant'
  ),
  rk AS (
    SELECT p.user_id, p.g_key,
      count(*) OVER w AS n,
      CASE WHEN p.csat IS NOT NULL AND p.csat_n >= 3 THEN cume_dist() OVER (PARTITION BY p.g_key, (p.csat IS NULL OR p.csat_n < 3) ORDER BY p.csat) END AS pct_csat,
      CASE WHEN p.frt_p50 IS NOT NULL THEN cume_dist() OVER (PARTITION BY p.g_key, (p.frt_p50 IS NULL) ORDER BY p.frt_p50 DESC) END AS pct_frt,
      CASE WHEN p.tma_p50 IS NOT NULL THEN cume_dist() OVER (PARTITION BY p.g_key, (p.tma_p50 IS NULL) ORDER BY p.tma_p50 DESC) END AS pct_tma,
      CASE WHEN p.fcr_pct IS NOT NULL THEN cume_dist() OVER (PARTITION BY p.g_key, (p.fcr_pct IS NULL) ORDER BY p.fcr_pct) END AS pct_fcr,
      cume_dist() OVER (PARTITION BY p.g_key ORDER BY p.encerrados) AS pct_encerrados,
      CASE WHEN p.qualidade IS NOT NULL THEN cume_dist() OVER (PARTITION BY p.g_key, (p.qualidade IS NULL) ORDER BY p.qualidade) END AS pct_qualidade,
      cume_dist() OVER (PARTITION BY p.g_key ORDER BY p.tk_resolvidos) AS pct_tickets,
      -- posição (1 = melhor)
      CASE WHEN p.csat IS NOT NULL AND p.csat_n >= 3 THEN rank() OVER (PARTITION BY p.g_key, (p.csat IS NULL OR p.csat_n < 3) ORDER BY p.csat DESC) END AS pos_csat,
      CASE WHEN p.frt_p50 IS NOT NULL THEN rank() OVER (PARTITION BY p.g_key, (p.frt_p50 IS NULL) ORDER BY p.frt_p50) END AS pos_frt,
      CASE WHEN p.tma_p50 IS NOT NULL THEN rank() OVER (PARTITION BY p.g_key, (p.tma_p50 IS NULL) ORDER BY p.tma_p50) END AS pos_tma,
      CASE WHEN p.fcr_pct IS NOT NULL THEN rank() OVER (PARTITION BY p.g_key, (p.fcr_pct IS NULL) ORDER BY p.fcr_pct DESC) END AS pos_fcr,
      rank() OVER (PARTITION BY p.g_key ORDER BY p.encerrados DESC) AS pos_encerrados,
      rank() OVER (PARTITION BY p.g_key ORDER BY p.tk_resolvidos DESC) AS pos_tickets
    FROM pool p
    WINDOW w AS (PARTITION BY p.g_key)
  ),
  rk_final AS (
    -- cada agente fica com o ranking do SEU grupo
    SELECT r.* FROM rk r JOIN grp g ON g.user_id = r.user_id AND g.grupo = r.g_key
  ),
  medias AS (
    SELECT p.g_key,
      count(*) AS n,
      ROUND(AVG(p.encerrados), 1) AS encerrados,
      ROUND(AVG(p.csat) FILTER (WHERE p.csat_n >= 3), 2) AS csat,
      ROUND(AVG(p.frt_p50))::int AS frt_p50,
      ROUND(AVG(p.tma_p50))::int AS tma_p50,
      ROUND(AVG(p.fcr_pct), 1) AS fcr_pct,
      ROUND(AVG(p.reabertura_pct), 1) AS reabertura_pct,
      ROUND(AVG(p.qualidade), 1) AS qualidade,
      ROUND(AVG(p.tk_resolvidos), 1) AS tk_resolvidos,
      MAX(p.encerrados) AS encerrados_max
    FROM pool p GROUP BY p.g_key
  ),
  linha AS (
    SELECT g.user_id, g.grupo,
      jsonb_build_object(
        'user_id', g.user_id,
        'elegivel', g.elegivel,
        'grupo', CASE WHEN g.grupo = 'tenant' THEN 'tenant' ELSE 'setor' END,
        'encerrados', g.encerrados, 'frt_p50', g.frt_p50, 'tma_p50', g.tma_p50,
        'csat', g.csat, 'csat_n', g.csat_n, 'csat_satisfeitos', g.csat_satisfeitos, 'csat_enviados', g.csat_enviados,
        'fcr_pct', g.fcr_pct, 'fcr_n', g.fcr_n, 'fcr_base', g.fcr_base, 'ia_n', g.ia_n,
        'reabertura_pct', g.reabertura_pct, 'qualidade', g.qualidade,
        'sent_pos', g.sent_pos, 'sent_neu', g.sent_neu, 'sent_neg', g.sent_neg,
        'tk_resolvidos', g.tk_resolvidos, 'tk_dias_medio', g.tk_dias_medio,
        'n', r.n,
        'pct', jsonb_build_object('csat', r.pct_csat, 'frt', r.pct_frt, 'tma', r.pct_tma, 'fcr', r.pct_fcr,
                                  'encerrados', r.pct_encerrados, 'qualidade', r.pct_qualidade, 'tickets', r.pct_tickets),
        'pos', jsonb_build_object('csat', r.pos_csat, 'frt', r.pos_frt, 'tma', r.pos_tma, 'fcr', r.pos_fcr,
                                  'encerrados', r.pos_encerrados, 'tickets', r.pos_tickets)
      ) AS j
    FROM grp g LEFT JOIN rk_final r ON r.user_id = g.user_id
  ),
  perfil AS (
    SELECT p.user_id, f.nome, f.cargo, COALESCE(f.ativo, true) AS ativo, p.role, p.created_at, p.max_concurrent_chats,
           s.department_id, s.setor,
           pr.status AS presenca, pr.shift_started_at, pr.pause_started_at, pr.pause_expected_end_at,
           pr.last_heartbeat_at, pz.name AS pausa_motivo
    FROM profiles p
    LEFT JOIN funcionarios f ON f.id = p.funcionario_id
    LEFT JOIN setor s ON s.user_id = p.user_id
    LEFT JOIN support_agent_presence pr ON pr.user_id = p.user_id
    LEFT JOIN support_pause_reasons pz ON pz.id = pr.pause_reason_id
    WHERE p.tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'escopo', v_escopo,
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'alvo', (
      SELECT jsonb_build_object(
        'user_id', pf.user_id, 'nome', pf.nome, 'cargo', pf.cargo, 'role', pf.role,
        'setor', pf.setor, 'usuario_desde', pf.created_at, 'capacidade', pf.max_concurrent_chats,
        'presenca', pf.presenca, 'expediente_desde', pf.shift_started_at,
        'pausa_desde', pf.pause_started_at, 'pausa_prevista_ate', pf.pause_expected_end_at,
        'pausa_motivo', pf.pausa_motivo, 'ultimo_sinal', pf.last_heartbeat_at,
        'agora', jsonb_build_object(
          'em_atendimento', (SELECT count(*) FROM support_attendances sa
                             WHERE sa.tenant_id = v_tenant AND sa.assigned_to = pf.user_id AND sa.status = 'in_progress'),
          'na_fila', (SELECT count(*) FROM support_attendances sa
                      WHERE sa.tenant_id = v_tenant AND sa.assigned_to = pf.user_id AND sa.status = 'waiting'),
          'encerrados_hoje', (SELECT count(*) FROM support_attendances sa
                              WHERE sa.tenant_id = v_tenant AND sa.assigned_to = pf.user_id
                                AND sa.status IN ('closed','inactive_closed') AND sa.closed_at >= v_hoje),
          'tickets_abertos', COALESCE((SELECT n FROM tk_abertos WHERE user_id = pf.user_id), 0),
          'ticket_mais_antigo', (SELECT mais_antigo FROM tk_abertos WHERE user_id = pf.user_id)
        ),
        'metricas', (SELECT l.j FROM linha l WHERE l.user_id = pf.user_id)
      )
      FROM perfil pf WHERE pf.user_id = v_alvo
    ),
    'time', (
      SELECT to_jsonb(md) - 'g_key'
      FROM medias md
      WHERE md.g_key = COALESCE((SELECT g.grupo FROM grp g WHERE g.user_id = v_alvo),
                                (SELECT CASE WHEN count(*) FILTER (WHERE g2.elegivel) >= 3 THEN s.department_id::text ELSE 'tenant' END
                                 FROM setor s LEFT JOIN grp g2 ON g2.department_id = s.department_id
                                 WHERE s.user_id = v_alvo GROUP BY s.department_id),
                                'tenant')
    ),
    -- Faixa do time: só para head/admin, e só quem ele pode abrir.
    'equipe', CASE WHEN v_escopo = 'proprio' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', pf.user_id, 'nome', pf.nome, 'cargo', pf.cargo, 'setor', pf.setor,
               'presenca', pf.presenca, 'ultimo_sinal', pf.last_heartbeat_at, 'metricas', l.j)
             ORDER BY pf.setor NULLS LAST, pf.nome)
      FROM perfil pf
      LEFT JOIN linha l ON l.user_id = pf.user_id
      WHERE pf.nome IS NOT NULL AND pf.ativo AND pf.user_id = ANY(v_visiveis)
    ), '[]'::jsonb) END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_colaborador_360(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_colaborador_360(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;
