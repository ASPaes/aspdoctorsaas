-- DEM-0315: filtro de categoria e subcategoria na aba Chats do Dashboard de Atendimento.
--
-- Corpos copiados da PRODUÇÃO em 18/09/2026 (pg_get_functiondef), não do repo.
-- As 2 RPCs que respondem aos filtros da aba ganham p_category_ids e
-- p_subcategory_ids no fim, com o MESMO predicado no WHERE de `at` (a lista
-- é cópia do recorte dos quadros e tem que continuar fechando com eles).
--
-- get_atendimento_chats:       chave nova 'por_categoria' (qtd, horas, TMA).
-- get_atendimento_chats_lista: 'categoria' e 'subcategoria' em cada item.
-- get_atendimento_chats_timeline fica como está: a série de 12 meses já ignora
-- data, agente e plantão, e ignora categoria pelo mesmo motivo.
--
-- DROP antes do CREATE: parâmetro novo com CREATE OR REPLACE criaria sobrecarga.

BEGIN;

DROP FUNCTION public.get_atendimento_chats(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text);

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
      AND (NOT v_filtra_cat OR EXISTS (
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

REVOKE ALL ON FUNCTION public.get_atendimento_chats(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_atendimento_chats(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, uuid[], uuid[]) TO authenticated, service_role;

DROP FUNCTION public.get_atendimento_chats_lista(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, integer);

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
      AND (NOT v_filtra_cat OR EXISTS (
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

REVOKE ALL ON FUNCTION public.get_atendimento_chats_lista(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, integer, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_atendimento_chats_lista(uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, integer, uuid[], uuid[]) TO authenticated, service_role;

COMMIT;
