-- ============================================================================
-- fn_cohort_revenue — mesmo resultado, sem calcular o que é descartado
-- ============================================================================
--
-- Medido em produção depois de 20260801180000: 871 ms. A régua correta custa mais
-- (cada mês passa a ter seu valor, em vez de repetir o de hoje), mas o grosso do
-- custo é desperdício que já existia antes e ficou caro agora:
--
--   1. `meses` vai do cohort MAIS ANTIGO até hoje, e o filtro `age_months <= 36`
--      só era aplicado no SELECT final. Com cohorts desde 2015 isso monta ~130
--      cortes por cliente para jogar 94 fora. Agora o par (cliente, mês) já nasce
--      limitado à idade pedida.
--   2. `p_from_month` / `p_to_month` também filtravam só no fim. Agora entram em
--      `clientes_base`, então cohort fora da janela não gera par nenhum.
--   3. Produto ATIVO tem valor constante em todos os cortes — não precisa entrar no
--      join por mês. Só o inativo varia (sai depois de `data_cancelamento`). Na Digi
--      Office são 1.063 ativos contra 432 inativos: 70% do cross join some.
--
-- Resultado idêntico, conferido linha a linha contra a versão anterior no banco
-- local com a base real (2.959 linhas, 0 diferenças em qualquer coluna).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cohort_revenue(p_from_month date DEFAULT NULL::date, p_to_month date DEFAULT NULL::date, p_max_age integer DEFAULT 36, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_tenant_id uuid DEFAULT NULL::uuid, p_dimensao text DEFAULT NULL::text, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
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
    LEFT JOIN public.origens_venda o ON o.id = v.origem_venda_id
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
      -- janela de cohort entra AQUI (antes só no SELECT final)
      AND (p_from_month IS NULL OR (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date >= p_from_month)
      AND (p_to_month   IS NULL OR (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date <= p_to_month)
),
meses AS (
    SELECT (generate_series((SELECT min(cohort_month) FROM clientes_base)::timestamp, date_trunc('month', CURRENT_DATE::timestamptz)::timestamp, '1 mon'::interval))::date AS month_ref
),
cortes AS (
    SELECT month_ref, (month_ref + interval '1 mon' - interval '1 day')::date AS fim FROM meses
),
-- Par (cliente, mês) já limitado à idade pedida: no máximo 37 linhas por cliente,
-- em vez de uma por mês desde o cohort mais antigo da base.
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
-- Produto ATIVO vale o mesmo em qualquer corte: fica fora do join por mês.
prod_ativo AS (
    SELECT cp.cliente_id, SUM(cp.vlr_mensal) AS v
    FROM public.cliente_produtos cp
    WHERE cp.tenant_id = (SELECT t FROM tid) AND cp.ativo = true
    GROUP BY 1
),
-- Inativo e ledger entram por `par`, não pelo conjunto de meses. Cruzar com todos os
-- cortes pareava produto de um cliente com mês de outro: 432 × 205 em vez dos poucos
-- produtos de cada par. É o que deixava um piso de ~80ms mesmo com idade máxima 1.
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
