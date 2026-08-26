-- Task 9: aba Tickets (get_atendimento_taxonomia) ignorava o filtro "Só plantão" em
-- silêncio. As outras 8 RPCs do dashboard já recebem p_plantao; esta ficou para trás.
--
-- DROP + CREATE (não CREATE OR REPLACE): parâmetro novo no fim cria sobrecarga e o
-- PostgREST fica ambíguo entre as duas assinaturas. O DROP leva os grants junto —
-- repostos no fim desta migration.
--
-- Corpo lido de PRODUÇÃO em 25/08 via pg_get_functiondef antes de editar (o local
-- está atrasado). Duas inserções sobre esse corpo:
--   1. validação de p_plantao logo após resolver v_tenant, antes do WITH cli_ok;
--   2. predicado "AND (p_plantao IS NULL OR st.tipo_horario = p_plantao)" só na CTE
--      tk — nunca em media_tickets_cliente.clientes_ativos, que conta CLIENTES, não
--      tickets (numerador filtrado sobre denominador inteiro, o defeito de 24/08).

DROP FUNCTION IF EXISTS public.get_atendimento_taxonomia(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid,
  bigint[], bigint[], bigint[], bigint[], bigint[], bigint[]);

CREATE OR REPLACE FUNCTION public.get_atendimento_taxonomia(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid     DEFAULT NULL::uuid,
  p_unidade_base_id bigint   DEFAULT NULL::bigint,
  p_agent_id        uuid     DEFAULT NULL::uuid,
  p_segmento_ids    bigint[] DEFAULT NULL::bigint[],
  p_area_ids        bigint[] DEFAULT NULL::bigint[],
  p_estado_ids      bigint[] DEFAULT NULL::bigint[],
  p_cidade_ids      bigint[] DEFAULT NULL::bigint[],
  p_fornecedor_ids  bigint[] DEFAULT NULL::bigint[],
  p_produto_ids     bigint[] DEFAULT NULL::bigint[],
  p_plantao         text     DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
  v_has_cli boolean;
  v_mrr_min numeric := 50;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: %', p_plantao;
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
$function$
;

REVOKE ALL ON FUNCTION "public"."get_atendimento_taxonomia"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_taxonomia"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_taxonomia"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_plantao" "text") TO "service_role";
