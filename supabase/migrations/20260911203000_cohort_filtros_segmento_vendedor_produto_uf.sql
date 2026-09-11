-- ============================================================================
-- Aba Cohort: filtros de segmento, area de atuacao, estado, cidade,
-- faixa de mensalidade, vendedor, produto e origem da venda.
--
-- Aditivo: todos os parametros novos sao DEFAULT NULL e NULL = sem filtro,
-- portanto nenhuma chamada existente muda de resultado.
--
-- Vendedor / produto / origem vem de cliente_produtos (fonte de verdade),
-- nao das colunas legadas de `clientes`. Cobertura medida em 11/09/2026:
-- vendedor 2.372 x 2.050, origem 2.918 x 2.245.
--
-- A dimensao 'canal' da tabela de dimensoes passa a agrupar pela MESMA fonte
-- (cliente_produtos, com fallback no legado) para nao discordar do filtro.
-- ============================================================================

-- Parametros novos no fim da assinatura => CREATE OR REPLACE criaria sobrecarga.
DROP FUNCTION IF EXISTS public.fn_cohort_revenue(date, date, integer, bigint, bigint, uuid, text, bigint[]);

CREATE FUNCTION public.fn_cohort_revenue(
    p_from_month date DEFAULT NULL::date,
    p_to_month date DEFAULT NULL::date,
    p_max_age integer DEFAULT 36,
    p_fornecedor_id bigint DEFAULT NULL::bigint,
    p_unidade_base_id bigint DEFAULT NULL::bigint,
    p_tenant_id uuid DEFAULT NULL::uuid,
    p_dimensao text DEFAULT NULL::text,
    p_fornecedor_ids bigint[] DEFAULT NULL::bigint[],
    p_segmento_ids bigint[] DEFAULT NULL::bigint[],
    p_area_atuacao_ids bigint[] DEFAULT NULL::bigint[],
    p_estado_ids bigint[] DEFAULT NULL::bigint[],
    p_cidade_ids bigint[] DEFAULT NULL::bigint[],
    p_faixas text[] DEFAULT NULL::text[],
    p_funcionario_ids bigint[] DEFAULT NULL::bigint[],
    p_produto_ids bigint[] DEFAULT NULL::bigint[],
    p_origem_venda_ids bigint[] DEFAULT NULL::bigint[]
)
 RETURNS TABLE(tenant_id uuid, grupo text, cohort_month date, age_months integer, cohort_size bigint, retained bigint, retention_percent numeric, mrr_inicial numeric, mrr_retido numeric, revenue_retention_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH tid AS (SELECT COALESCE(p_tenant_id, current_tenant_id()) AS t),
lim AS (SELECT LEAST(COALESCE(p_max_age, 36), 36) AS max_age),
clientes_base AS (
    SELECT v.id, v.tenant_id,
        CASE p_dimensao
          WHEN 'canal'    THEN COALESCE(NULLIF(o.nome, ''), '(sem informação)')
          WHEN 'segmento' THEN COALESCE(NULLIF(s.nome, ''), '(sem informação)')
          WHEN 'uf'       THEN COALESCE(NULLIF(e.sigla, ''), '(sem informação)')
          WHEN 'faixa_ticket' THEN CASE
                WHEN COALESCE(v.mensalidade, 0) < 200  THEN 'Até R$ 200'
                WHEN v.mensalidade < 500  THEN 'R$ 200–500'
                WHEN v.mensalidade < 1000 THEN 'R$ 500–1k'
                ELSE 'Acima de R$ 1k' END
          ELSE 'Geral'
        END AS grupo,
        (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) AS data_entrada,
        v.cancelado, v.data_cancelamento
    FROM vw_clientes_financeiro v
    -- Venda (vendedor/origem/produto) mora em cliente_produtos; o registro
    -- ativo mais antigo representa o cliente. As colunas de `clientes` sao
    -- legado e so entram como fallback.
    LEFT JOIN LATERAL (
        SELECT cp.origem_venda_id
        FROM public.cliente_produtos cp
        WHERE cp.cliente_id = v.id AND cp.tenant_id = (SELECT t FROM tid)
        ORDER BY cp.ativo DESC NULLS LAST, cp.created_at, cp.id
        LIMIT 1
    ) cpx ON true
    LEFT JOIN public.origens_venda o ON o.id = COALESCE(cpx.origem_venda_id, v.origem_venda_id)
    LEFT JOIN public.segmentos s ON s.id = v.segmento_id
    LEFT JOIN public.estados e ON e.id = v.estado_id
    WHERE COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) IS NOT NULL
      AND v.tenant_id = (SELECT t FROM tid)
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND ((SELECT public.is_super_admin()) OR (SELECT public.user_allowed_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_allowed_unidades())::bigint[]))
      AND ((SELECT public.user_view_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_view_unidades())::bigint[]))
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = (SELECT t FROM tid) AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
      -- Filtros da aba Cohort. Array vazio conta como "sem filtro".
      AND (COALESCE(cardinality(p_segmento_ids), 0) = 0     OR v.segmento_id     = ANY(p_segmento_ids))
      AND (COALESCE(cardinality(p_area_atuacao_ids), 0) = 0 OR v.area_atuacao_id = ANY(p_area_atuacao_ids))
      AND (COALESCE(cardinality(p_estado_ids), 0) = 0       OR v.estado_id       = ANY(p_estado_ids))
      AND (COALESCE(cardinality(p_cidade_ids), 0) = 0       OR v.cidade_id       = ANY(p_cidade_ids))
      AND (COALESCE(cardinality(p_faixas), 0) = 0 OR (CASE
                WHEN COALESCE(v.mensalidade, 0) < 200  THEN 'ate_200'
                WHEN v.mensalidade < 500  THEN '200_500'
                WHEN v.mensalidade < 1000 THEN '500_1k'
                ELSE 'acima_1k' END) = ANY(p_faixas))
      AND (COALESCE(cardinality(p_funcionario_ids), 0) = 0 OR EXISTS (
            SELECT 1 FROM public.cliente_produtos cp
            WHERE cp.cliente_id = v.id AND cp.tenant_id = (SELECT t FROM tid)
              AND cp.funcionario_id = ANY(p_funcionario_ids)))
      AND (COALESCE(cardinality(p_produto_ids), 0) = 0 OR EXISTS (
            SELECT 1 FROM public.cliente_produtos cp
            WHERE cp.cliente_id = v.id AND cp.tenant_id = (SELECT t FROM tid)
              AND cp.produto_id = ANY(p_produto_ids)))
      AND (COALESCE(cardinality(p_origem_venda_ids), 0) = 0 OR EXISTS (
            SELECT 1 FROM public.cliente_produtos cp
            WHERE cp.cliente_id = v.id AND cp.tenant_id = (SELECT t FROM tid)
              AND cp.origem_venda_id = ANY(p_origem_venda_ids)))
      AND (p_from_month IS NULL OR (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date >= p_from_month)
      AND (p_to_month   IS NULL OR (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date <= p_to_month)
),
meses AS (
    SELECT (generate_series((SELECT min(cohort_month) FROM clientes_base)::timestamp, date_trunc('month', CURRENT_DATE::timestamptz)::timestamp, '1 mon'::interval))::date AS month_ref
),
cortes AS (
    SELECT month_ref, (month_ref + interval '1 mon' - interval '1 day')::date AS fim FROM meses
),
par AS (
    SELECT cb.id, cb.tenant_id, cb.grupo, cb.cohort_month, cb.data_entrada,
           cb.cancelado, cb.data_cancelamento, k.month_ref, k.fim,
           ((EXTRACT(year FROM age(k.month_ref::timestamp, cb.cohort_month::timestamp)) * 12)
            + EXTRACT(month FROM age(k.month_ref::timestamp, cb.cohort_month::timestamp)))::integer AS age_months
    FROM clientes_base cb
    JOIN cortes k
      ON k.month_ref >= cb.cohort_month
     AND k.month_ref <= (cb.cohort_month + (((SELECT max_age FROM lim)) || ' months')::interval)::date
),
prod_ativo AS (
    SELECT cp.cliente_id, SUM(cp.vlr_mensal) AS v
    FROM public.cliente_produtos cp
    WHERE cp.tenant_id = (SELECT t FROM tid) AND cp.ativo = true
    GROUP BY 1
),
prod_inativo AS (
    SELECT p.id AS cliente_id, p.month_ref, SUM(cp.vlr_mensal) AS v
    FROM par p
    JOIN public.cliente_produtos cp
      ON cp.cliente_id = p.id
     AND cp.tenant_id = (SELECT t FROM tid)
     AND cp.ativo = false
     AND cp.data_cancelamento > p.fim
    GROUP BY 1, 2
),
mov AS (
    SELECT p.id AS cliente_id, p.month_ref, SUM(mv.valor_delta) AS v
    FROM par p
    JOIN public.movimentos_mrr mv
      ON mv.cliente_id = p.id
     AND mv.tenant_id = (SELECT t FROM tid)
     AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
     AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
     AND mv.data_movimento <= p.fim
    GROUP BY 1, 2
),
val AS (
    SELECT p.id, p.month_ref,
           COALESCE(pa.v, 0) + COALESCE(pi.v, 0) + COALESCE(m.v, 0) AS mrr
    FROM par p
    LEFT JOIN prod_ativo   pa ON pa.cliente_id = p.id
    LEFT JOIN prod_inativo pi ON pi.cliente_id = p.id AND pi.month_ref = p.month_ref
    LEFT JOIN mov          m  ON m.cliente_id  = p.id AND m.month_ref  = p.month_ref
),
cohort_sizes AS (
    SELECT cb.tenant_id, cb.grupo, cb.cohort_month,
           count(DISTINCT cb.id) AS cohort_size,
           sum(COALESCE(v0.mrr, 0)) AS mrr_inicial
    FROM clientes_base cb
    LEFT JOIN val v0 ON v0.id = cb.id AND v0.month_ref = cb.cohort_month
    GROUP BY cb.tenant_id, cb.grupo, cb.cohort_month
),
agg AS (
    SELECT p.tenant_id, p.grupo, p.cohort_month, p.age_months,
        sum(CASE WHEN p.data_entrada <= p.fim
                  AND (p.cancelado <> true OR (p.data_cancelamento IS NOT NULL AND p.data_cancelamento > p.fim))
                 THEN 1 ELSE 0 END) AS retained,
        sum(CASE WHEN p.data_entrada <= p.fim
                  AND (p.cancelado <> true OR (p.data_cancelamento IS NOT NULL AND p.data_cancelamento > p.fim))
                 THEN COALESCE(v.mrr, 0) ELSE 0 END) AS mrr_retido
    FROM par p
    LEFT JOIN val v ON v.id = p.id AND v.month_ref = p.month_ref
    GROUP BY p.tenant_id, p.grupo, p.cohort_month, p.age_months
)
SELECT a.tenant_id, a.grupo, a.cohort_month, a.age_months, cs.cohort_size, a.retained,
    round((a.retained::numeric / NULLIF(cs.cohort_size, 0)::numeric) * 100, 2) AS retention_percent,
    round(cs.mrr_inicial, 2) AS mrr_inicial,
    round(a.mrr_retido, 2) AS mrr_retido,
    round((a.mrr_retido / NULLIF(cs.mrr_inicial, 0)) * 100, 2) AS revenue_retention_percent
FROM agg a JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.grupo = a.grupo AND cs.cohort_month = a.cohort_month
WHERE a.age_months >= 0 AND a.age_months <= (SELECT max_age FROM lim);
$function$;

REVOKE ALL ON FUNCTION public.fn_cohort_revenue(date, date, integer, bigint, bigint, uuid, text, bigint[], bigint[], bigint[], bigint[], bigint[], text[], bigint[], bigint[], bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cohort_revenue(date, date, integer, bigint, bigint, uuid, text, bigint[], bigint[], bigint[], bigint[], bigint[], text[], bigint[], bigint[], bigint[]) TO authenticated, service_role;


-- ============================================================================
-- Previsao de saldo: mesma aba, mesmos filtros. Sem isso ela mentiria quando
-- o usuario filtrasse a matriz.
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_cohort_saldo_forecast(uuid, bigint, bigint, integer, integer[], bigint[]);

CREATE FUNCTION public.fn_cohort_saldo_forecast(
    p_tenant_id uuid DEFAULT NULL::uuid,
    p_fornecedor_id bigint DEFAULT NULL::bigint,
    p_unidade_base_id bigint DEFAULT NULL::bigint,
    p_janela_meses integer DEFAULT 12,
    p_horizontes integer[] DEFAULT ARRAY[3, 6, 12],
    p_fornecedor_ids bigint[] DEFAULT NULL::bigint[],
    p_segmento_ids bigint[] DEFAULT NULL::bigint[],
    p_area_atuacao_ids bigint[] DEFAULT NULL::bigint[],
    p_estado_ids bigint[] DEFAULT NULL::bigint[],
    p_cidade_ids bigint[] DEFAULT NULL::bigint[],
    p_faixas text[] DEFAULT NULL::text[],
    p_funcionario_ids bigint[] DEFAULT NULL::bigint[],
    p_produto_ids bigint[] DEFAULT NULL::bigint[],
    p_origem_venda_ids bigint[] DEFAULT NULL::bigint[]
)
 RETURNS TABLE(horizonte_meses integer, base_clientes bigint, base_mrr numeric, perda_clientes numeric, ganho_clientes numeric, saldo_clientes numeric, perda_mrr numeric, ganho_mrr numeric, saldo_mrr numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT
    count(*) FILTER (WHERE cancelado = false) AS base_cli,
    COALESCE(sum(mensalidade) FILTER (WHERE cancelado = false), 0) AS base_mrr,
    count(*) FILTER (WHERE cancelado = true AND data_cancelamento >= (CURRENT_DATE - make_interval(months => p_janela_meses))) AS churn_cli,
    COALESCE(sum(mensalidade) FILTER (WHERE cancelado = true AND data_cancelamento >= (CURRENT_DATE - make_interval(months => p_janela_meses))), 0) AS churn_mrr,
    count(*) FILTER (WHERE COALESCE(data_venda_efetiva, data_venda, data_ativacao, data_cadastro) >= (CURRENT_DATE - make_interval(months => p_janela_meses))) AS vendas_cli,
    COALESCE(sum(mensalidade) FILTER (WHERE COALESCE(data_venda_efetiva, data_venda, data_ativacao, data_cadastro) >= (CURRENT_DATE - make_interval(months => p_janela_meses))), 0) AS vendas_mrr
  FROM vw_clientes_financeiro v
  WHERE v.tenant_id = COALESCE(p_tenant_id, current_tenant_id())
    AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
    AND ((SELECT public.is_super_admin()) OR (SELECT public.user_allowed_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_allowed_unidades())::bigint[]))
    AND ((SELECT public.user_view_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_view_unidades())::bigint[]))
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = COALESCE(p_tenant_id, current_tenant_id()) AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
    )
    -- Mesmos filtros da matriz de coorte. Array vazio conta como "sem filtro".
    AND (COALESCE(cardinality(p_segmento_ids), 0) = 0     OR v.segmento_id     = ANY(p_segmento_ids))
    AND (COALESCE(cardinality(p_area_atuacao_ids), 0) = 0 OR v.area_atuacao_id = ANY(p_area_atuacao_ids))
    AND (COALESCE(cardinality(p_estado_ids), 0) = 0       OR v.estado_id       = ANY(p_estado_ids))
    AND (COALESCE(cardinality(p_cidade_ids), 0) = 0       OR v.cidade_id       = ANY(p_cidade_ids))
    AND (COALESCE(cardinality(p_faixas), 0) = 0 OR (CASE
              WHEN COALESCE(v.mensalidade, 0) < 200  THEN 'ate_200'
              WHEN v.mensalidade < 500  THEN '200_500'
              WHEN v.mensalidade < 1000 THEN '500_1k'
              ELSE 'acima_1k' END) = ANY(p_faixas))
    AND (COALESCE(cardinality(p_funcionario_ids), 0) = 0 OR EXISTS (
          SELECT 1 FROM public.cliente_produtos cp
          WHERE cp.cliente_id = v.id AND cp.tenant_id = COALESCE(p_tenant_id, current_tenant_id())
            AND cp.funcionario_id = ANY(p_funcionario_ids)))
    AND (COALESCE(cardinality(p_produto_ids), 0) = 0 OR EXISTS (
          SELECT 1 FROM public.cliente_produtos cp
          WHERE cp.cliente_id = v.id AND cp.tenant_id = COALESCE(p_tenant_id, current_tenant_id())
            AND cp.produto_id = ANY(p_produto_ids)))
    AND (COALESCE(cardinality(p_origem_venda_ids), 0) = 0 OR EXISTS (
          SELECT 1 FROM public.cliente_produtos cp
          WHERE cp.cliente_id = v.id AND cp.tenant_id = COALESCE(p_tenant_id, current_tenant_id())
            AND cp.origem_venda_id = ANY(p_origem_venda_ids)))
),
h AS (SELECT unnest(p_horizontes) AS hz)
SELECT
  h.hz AS horizonte_meses, b.base_cli AS base_clientes, round(b.base_mrr, 2) AS base_mrr,
  round(b.churn_cli::numeric / p_janela_meses * h.hz, 0) AS perda_clientes,
  round(b.vendas_cli::numeric / p_janela_meses * h.hz, 0) AS ganho_clientes,
  b.base_cli + round(b.vendas_cli::numeric / p_janela_meses * h.hz, 0) - round(b.churn_cli::numeric / p_janela_meses * h.hz, 0) AS saldo_clientes,
  round(b.churn_mrr / p_janela_meses * h.hz, 2) AS perda_mrr,
  round(b.vendas_mrr / p_janela_meses * h.hz, 2) AS ganho_mrr,
  round(b.base_mrr + b.vendas_mrr / p_janela_meses * h.hz - b.churn_mrr / p_janela_meses * h.hz, 2) AS saldo_mrr
FROM base b CROSS JOIN h ORDER BY h.hz;
$function$;

REVOKE ALL ON FUNCTION public.fn_cohort_saldo_forecast(uuid, bigint, bigint, integer, integer[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], bigint[], bigint[], bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cohort_saldo_forecast(uuid, bigint, bigint, integer, integer[], bigint[], bigint[], bigint[], bigint[], bigint[], text[], bigint[], bigint[], bigint[]) TO authenticated, service_role;
