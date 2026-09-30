-- Relatorios de recorrencia deixam de fora o cliente de EVENTO UNICO.
-- Parte 2: as funcoes que CONTAM cliente.
--
-- 11 funcoes trocam vw_clientes_financeiro por vw_clientes_recorrentes (troca
-- de texto unica em cada uma, nada mais muda). 3 que leem a tabela clientes
-- direto ganham AND NOT c.evento_unico no recorte base:
-- get_cancelamentos_breakdown, get_tenure_medio_meses e fn_cohort_logos.
--
-- Ficam como estao, de proposito:
--   get_vendas_produtos     so usa a view para filtrar unidade de cliente_produtos,
--                           e o cliente de evento nao tem cliente_produtos
--   get_vendas_ticket_stats ja filtra mrr > 0
--   get_mrr_bridge / get_mrr_monthly_snapshots somam valor, e evento vale 0
--   fn_ativacao_dos_modulos le um produto so
-- CREATE OR REPLACE mantem dono, SECURITY DEFINER e grants de cada uma.
-- Base: corpos de producao lidos em 29/09/2026 (pg_get_functiondef).

-- fn_cohort_revenue
CREATE OR REPLACE FUNCTION public.fn_cohort_revenue(p_from_month date DEFAULT NULL::date, p_to_month date DEFAULT NULL::date, p_max_age integer DEFAULT 36, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_tenant_id uuid DEFAULT NULL::uuid, p_dimensao text DEFAULT NULL::text, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[], p_segmento_ids bigint[] DEFAULT NULL::bigint[], p_area_atuacao_ids bigint[] DEFAULT NULL::bigint[], p_estado_ids bigint[] DEFAULT NULL::bigint[], p_cidade_ids bigint[] DEFAULT NULL::bigint[], p_faixas text[] DEFAULT NULL::text[], p_funcionario_ids bigint[] DEFAULT NULL::bigint[], p_produto_ids bigint[] DEFAULT NULL::bigint[], p_origem_venda_ids bigint[] DEFAULT NULL::bigint[])
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
    FROM vw_clientes_recorrentes v
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

-- fn_cohort_saldo_forecast
CREATE OR REPLACE FUNCTION public.fn_cohort_saldo_forecast(p_tenant_id uuid DEFAULT NULL::uuid, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_janela_meses integer DEFAULT 12, p_horizontes integer[] DEFAULT ARRAY[3, 6, 12], p_fornecedor_ids bigint[] DEFAULT NULL::bigint[], p_segmento_ids bigint[] DEFAULT NULL::bigint[], p_area_atuacao_ids bigint[] DEFAULT NULL::bigint[], p_estado_ids bigint[] DEFAULT NULL::bigint[], p_cidade_ids bigint[] DEFAULT NULL::bigint[], p_faixas text[] DEFAULT NULL::text[], p_funcionario_ids bigint[] DEFAULT NULL::bigint[], p_produto_ids bigint[] DEFAULT NULL::bigint[], p_origem_venda_ids bigint[] DEFAULT NULL::bigint[])
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
  FROM vw_clientes_recorrentes v
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

-- fn_cohort_survival_forecast
CREATE OR REPLACE FUNCTION public.fn_cohort_survival_forecast(p_from_month date DEFAULT NULL::date, p_to_month date DEFAULT NULL::date, p_max_age integer DEFAULT 24, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_tenant_id uuid DEFAULT NULL::uuid, p_horizontes integer[] DEFAULT ARRAY[6, 12], p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(horizonte_meses integer, base_clientes bigint, base_mrr numeric, perda_clientes_esp numeric, perda_mrr_esp numeric, retencao_clientes_esp_pct numeric, retencao_mrr_esp_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH cb AS (
  SELECT v.id,
    (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date AS cohort_month,
    COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) AS data_entrada,
    v.cancelado, v.data_cancelamento, COALESCE(v.mensalidade, 0)::numeric AS mrr
  FROM vw_clientes_recorrentes v
  WHERE COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) IS NOT NULL
    AND v.tenant_id = COALESCE(p_tenant_id, current_tenant_id())
    AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
    AND ((SELECT public.is_super_admin()) OR (SELECT public.user_allowed_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_allowed_unidades())::bigint[]))
    AND ((SELECT public.user_view_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_view_unidades())::bigint[]))
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = COALESCE(p_tenant_id, current_tenant_id()) AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
    )
),
curve_cohorts AS (
  SELECT * FROM cb WHERE (p_from_month IS NULL OR cohort_month >= p_from_month) AND (p_to_month IS NULL OR cohort_month <= p_to_month)
),
cohort_sizes AS (
  SELECT cohort_month, count(*) AS sz FROM curve_cohorts GROUP BY cohort_month HAVING count(*) >= 10
),
meses AS (
  SELECT (generate_series((SELECT min(cohort_month) FROM curve_cohorts)::timestamp, date_trunc('month', CURRENT_DATE::timestamptz)::timestamp, '1 mon'::interval))::date AS month_ref
),
cohort_age AS (
  SELECT cc.cohort_month,
    ((EXTRACT(year FROM age(m.month_ref::timestamp, cc.cohort_month::timestamp)) * 12)
     + EXTRACT(month FROM age(m.month_ref::timestamp, cc.cohort_month::timestamp)))::int AS age_months,
    CASE WHEN cc.data_entrada <= (m.month_ref + '1 mon'::interval - '1 day'::interval)
         AND (cc.cancelado <> true OR (cc.data_cancelamento IS NOT NULL AND cc.data_cancelamento > (m.month_ref + '1 mon'::interval - '1 day'::interval)))
         THEN 1 ELSE 0 END AS is_retained
  FROM curve_cohorts cc JOIN cohort_sizes cs ON cs.cohort_month = cc.cohort_month JOIN meses m ON m.month_ref >= cc.cohort_month
),
surv_by_age AS (
  SELECT age_months, sum(is_retained)::numeric / NULLIF(count(*), 0)::numeric AS s_raw
  FROM cohort_age WHERE age_months BETWEEN 0 AND LEAST(p_max_age, 36) GROUP BY age_months
),
grid AS ( SELECT generate_series(0, LEAST(p_max_age, 36)) AS age ),
surv_mono AS (
  SELECT g.age, min(sba.s_raw) OVER (ORDER BY g.age ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS s
  FROM grid g LEFT JOIN surv_by_age sba ON sba.age_months = g.age
),
mx AS (
  SELECT LEAST(p_max_age, 36) AS max_age, LEAST(6, LEAST(p_max_age, 36)) AS ref_age,
    (SELECT s FROM surv_mono WHERE age = LEAST(p_max_age, 36)) AS s_at_max,
    (SELECT s FROM surv_mono WHERE age = LEAST(6, LEAST(p_max_age, 36))) AS s_at_ref
),
tail AS (
  SELECT CASE WHEN mx.max_age > mx.ref_age AND mx.s_at_ref > 0 AND mx.s_at_max > 0
    THEN GREATEST(0.5, LEAST(1, power(mx.s_at_max / mx.s_at_ref, 1.0 / (mx.max_age - mx.ref_age)))) ELSE 1 END AS tf FROM mx
),
surv_ext AS (
  SELECT g.age, CASE WHEN g.age <= mx.max_age THEN sm.s ELSE mx.s_at_max * power(t.tf, g.age - mx.max_age) END AS s
  FROM generate_series(0, LEAST(p_max_age, 36) + 120) g(age) CROSS JOIN mx CROSS JOIN tail t LEFT JOIN surv_mono sm ON sm.age = g.age
),
base_ativa AS (
  SELECT ((EXTRACT(year FROM age(date_trunc('month', CURRENT_DATE)::timestamp, cohort_month::timestamp)) * 12)
        + EXTRACT(month FROM age(date_trunc('month', CURRENT_DATE)::timestamp, cohort_month::timestamp)))::int AS idade,
    count(*) AS qtd, sum(mrr) AS mrr FROM cb WHERE cancelado <> true GROUP BY 1
),
horizontes AS ( SELECT unnest(p_horizontes) AS h ),
fc AS (
  SELECT hz.h, ba.qtd, ba.mrr, LEAST(1, COALESCE(se_ih.s, 0) / NULLIF(se_i.s, 0)) AS surv_cond
  FROM base_ativa ba CROSS JOIN horizontes hz
  LEFT JOIN surv_ext se_i ON se_i.age = GREATEST(ba.idade, 0)
  LEFT JOIN surv_ext se_ih ON se_ih.age = GREATEST(ba.idade, 0) + hz.h
)
SELECT h AS horizonte_meses, sum(qtd)::bigint AS base_clientes, round(sum(mrr), 2) AS base_mrr,
  round(sum(qtd * (1 - COALESCE(surv_cond, 1))), 1) AS perda_clientes_esp,
  round(sum(mrr * (1 - COALESCE(surv_cond, 1))), 2) AS perda_mrr_esp,
  round(100 * (1 - sum(qtd * (1 - COALESCE(surv_cond, 1))) / NULLIF(sum(qtd), 0)), 1) AS retencao_clientes_esp_pct,
  round(100 * (1 - sum(mrr * (1 - COALESCE(surv_cond, 1))) / NULLIF(sum(mrr), 0)), 1) AS retencao_mrr_esp_pct
FROM fc GROUP BY h ORDER BY h;
$function$;

-- get_carteira_breakdown
CREATE OR REPLACE FUNCTION public.get_carteira_breakdown(p_tenant uuid, p_dim text, p_fim date, p_uf text DEFAULT NULL::text, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, qtd bigint, mrr numeric, custo numeric, margem_rs numeric, margem_pct numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      public.fn_mrr_cliente_em(p_tenant, v.id, p_fim)   AS mrr,
      public.fn_custo_cliente_em(p_tenant, v.id, p_fim) AS custo,
      CASE p_dim
        WHEN 'estado'     THEN e.sigla
        WHEN 'cidade'     THEN c.nome
        WHEN 'segmento'   THEN s.nome
        WHEN 'area'       THEN a.nome
        WHEN 'fornecedor' THEN fo.nome
        WHEN 'unidade'    THEN u.nome
      END AS dim_label
    FROM public.vw_clientes_recorrentes v
    LEFT JOIN public.estados       e  ON e.id  = v.estado_id
    LEFT JOIN public.cidades       c  ON c.id  = v.cidade_id
    LEFT JOIN public.segmentos     s  ON s.id  = v.segmento_id
    LEFT JOIN public.areas_atuacao a  ON a.id  = v.area_atuacao_id
    LEFT JOIN public.fornecedores  fo ON fo.id = v.fornecedor_id
    LEFT JOIN public.unidades_base u  ON u.id  = v.unidade_base_id
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva <= p_fim
      AND (v.cancelado IS NOT TRUE OR v.data_cancelamento > p_fim)
      AND (p_uf IS NULL OR e.sigla = p_uf)
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  )
  SELECT
    COALESCE(NULLIF(dim_label, ''), '(sem informação)') AS label,
    count(*)::bigint AS qtd,
    round(sum(mrr), 2) AS mrr,
    round(sum(custo), 2) AS custo,
    round(sum(mrr - custo), 2) AS margem_rs,
    CASE WHEN sum(mrr) > 0 THEN round(sum(mrr - custo) / sum(mrr), 4) ELSE 0 END AS margem_pct,
    CASE WHEN count(*) > 0 THEN round(sum(mrr) / count(*), 2) ELSE 0 END AS ticket
  FROM base
  GROUP BY 1
  ORDER BY qtd DESC NULLS LAST;
$function$;

-- get_carteira_churn
CREATE OR REPLACE FUNCTION public.get_carteira_churn(p_tenant uuid, p_nivel text, p_ini date, p_fim date, p_uf text DEFAULT NULL::text, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, base bigint, cancelados bigint, churn_pct numeric, mrr_perdido numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH dim AS (
    SELECT v.id, v.cancelado, v.data_cancelamento, v.data_venda_efetiva,
           CASE WHEN p_nivel = 'cidade' THEN c.nome ELSE e.sigla END AS lbl
    FROM public.vw_clientes_recorrentes v
    LEFT JOIN public.estados e ON e.id = v.estado_id
    LEFT JOIN public.cidades c ON c.id = v.cidade_id
    WHERE v.tenant_id = p_tenant
      AND (p_uf IS NULL OR e.sigla = p_uf)
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  base AS (
    SELECT lbl, count(*) AS n
    FROM dim
    WHERE data_venda_efetiva < p_ini
      AND (cancelado IS NOT TRUE OR data_cancelamento >= p_ini)
    GROUP BY lbl
  ),
  canc AS (
    SELECT lbl, count(*) AS n,
           sum(public.fn_mrr_cliente_em(p_tenant, id, data_cancelamento - 1)) AS mrr
    FROM dim
    WHERE cancelado IS TRUE
      AND data_cancelamento BETWEEN p_ini AND p_fim
    GROUP BY lbl
  )
  SELECT
    COALESCE(NULLIF(COALESCE(b.lbl, k.lbl), ''), '(sem informação)') AS label,
    COALESCE(b.n, 0)::bigint AS base,
    COALESCE(k.n, 0)::bigint AS cancelados,
    CASE WHEN COALESCE(b.n, 0) > 0 THEN round(COALESCE(k.n, 0)::numeric / b.n, 4) ELSE 0 END AS churn_pct,
    round(COALESCE(k.mrr, 0), 2) AS mrr_perdido
  FROM base b
  FULL OUTER JOIN canc k ON k.lbl = b.lbl
  ORDER BY churn_pct DESC NULLS LAST;
$function$;

-- get_carteira_clientes_cidade
CREATE OR REPLACE FUNCTION public.get_carteira_clientes_cidade(p_tenant uuid, p_uf text, p_cidade text, p_fim date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(cliente text, segmento text, mrr numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(NULLIF(v.nome_fantasia, ''), v.razao_social, '(sem nome)') AS cliente,
    COALESCE(s.nome, '(sem segmento)') AS segmento,
    round(public.fn_mrr_cliente_em(p_tenant, v.id, p_fim), 2) AS mrr
  FROM public.vw_clientes_recorrentes v
  JOIN public.estados   e ON e.id = v.estado_id
  JOIN public.cidades   c ON c.id = v.cidade_id
  LEFT JOIN public.segmentos s ON s.id = v.segmento_id
  WHERE v.tenant_id = p_tenant
    AND e.sigla = p_uf
    AND c.nome = p_cidade
    AND v.data_venda_efetiva <= p_fim
    AND (v.cancelado IS NOT TRUE OR v.data_cancelamento > p_fim)
    AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
    )
  ORDER BY 3 DESC NULLS LAST;
$function$;

-- get_carteira_serie_uf
CREATE OR REPLACE FUNCTION public.get_carteira_serie_uf(p_tenant uuid, p_meses integer DEFAULT 12, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(ym text, uf text, mrr numeric, qtd bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH meses AS (
    SELECT (date_trunc('month', (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo'))
            - (gs || ' months')::interval)::date AS mes_inicio
    FROM generate_series(0, GREATEST(p_meses, 1) - 1) AS gs
  ),
  fins AS (
    SELECT to_char(mes_inicio, 'YYYY-MM') AS ym,
           (mes_inicio + interval '1 month' - interval '1 day')::date AS fim
    FROM meses
  ),
  cli AS (
    SELECT v.id, e.sigla AS uf, v.data_venda_efetiva, v.cancelado, v.data_cancelamento
    FROM public.vw_clientes_recorrentes v
    JOIN public.estados e ON e.id = v.estado_id
    WHERE v.tenant_id = p_tenant
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  prod AS (
    SELECT cp.cliente_id, f.ym, SUM(cp.vlr_mensal) AS v
    FROM public.cliente_produtos cp
    JOIN fins f ON (cp.ativo = true OR cp.data_cancelamento > f.fim)
    WHERE cp.tenant_id = p_tenant
    GROUP BY 1, 2
  ),
  mov AS (
    SELECT mv.cliente_id, f.ym, SUM(mv.valor_delta) AS v
    FROM public.movimentos_mrr mv
    JOIN fins f ON mv.data_movimento <= f.fim
    WHERE mv.tenant_id = p_tenant
      AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
      AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
    GROUP BY 1, 2
  )
  SELECT
    f.ym,
    c.uf,
    round(sum(COALESCE(p.v, 0) + COALESCE(m.v, 0)), 2) AS mrr,
    count(*)::bigint AS qtd
  FROM fins f
  JOIN cli c
    ON c.data_venda_efetiva <= f.fim
   AND (c.cancelado IS NOT TRUE OR c.data_cancelamento > f.fim)
  LEFT JOIN prod p ON p.cliente_id = c.id AND p.ym = f.ym
  LEFT JOIN mov  m ON m.cliente_id = c.id AND m.ym = f.ym
  GROUP BY f.ym, c.uf
  ORDER BY f.ym, c.uf;
$function$;

-- get_carteira_variacao
CREATE OR REPLACE FUNCTION public.get_carteira_variacao(p_tenant uuid, p_fim_atual date, p_fim_anterior date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(uf text, mrr_atual numeric, mrr_anterior numeric, delta_abs numeric, delta_pct numeric, qtd_atual bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH escopo AS (
    SELECT v.id, e.sigla AS uf, v.cancelado, v.data_cancelamento, v.data_venda_efetiva
    FROM public.vw_clientes_recorrentes v
    JOIN public.estados e ON e.id = v.estado_id
    WHERE v.tenant_id = p_tenant
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  a AS (
    SELECT x.uf, sum(public.fn_mrr_cliente_em(p_tenant, x.id, p_fim_atual)) AS mrr, count(*) AS qtd
    FROM escopo x
    WHERE x.data_venda_efetiva <= p_fim_atual
      AND (x.cancelado IS NOT TRUE OR x.data_cancelamento > p_fim_atual)
    GROUP BY x.uf
  ),
  b AS (
    SELECT x.uf, sum(public.fn_mrr_cliente_em(p_tenant, x.id, p_fim_anterior)) AS mrr
    FROM escopo x
    WHERE x.data_venda_efetiva <= p_fim_anterior
      AND (x.cancelado IS NOT TRUE OR x.data_cancelamento > p_fim_anterior)
    GROUP BY x.uf
  )
  SELECT
    COALESCE(a.uf, b.uf) AS uf,
    round(COALESCE(a.mrr, 0), 2) AS mrr_atual,
    round(COALESCE(b.mrr, 0), 2) AS mrr_anterior,
    round(COALESCE(a.mrr, 0) - COALESCE(b.mrr, 0), 2) AS delta_abs,
    CASE WHEN COALESCE(b.mrr, 0) > 0
         THEN round((COALESCE(a.mrr, 0) - COALESCE(b.mrr, 0)) / b.mrr, 4)
         ELSE NULL END AS delta_pct,
    COALESCE(a.qtd, 0)::bigint AS qtd_atual
  FROM a
  FULL OUTER JOIN b ON a.uf = b.uf
  ORDER BY delta_abs DESC NULLS LAST;
$function$;

-- get_churn_detalhe_uf
CREATE OR REPLACE FUNCTION public.get_churn_detalhe_uf(p_tenant uuid, p_uf text, p_ini date, p_fim date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(cliente text, segmento text, cidade text, mrr_perdido numeric, data_cancelamento date, observacao text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(NULLIF(v.nome_fantasia, ''), v.razao_social, '(sem nome)') AS cliente,
    COALESCE(s.nome, '(sem segmento)') AS segmento,
    COALESCE(c.nome, '') AS cidade,
    round(public.fn_mrr_cliente_em(p_tenant, v.id, v.data_cancelamento - 1), 2) AS mrr_perdido,
    v.data_cancelamento,
    v.observacao_cancelamento AS observacao
  FROM public.vw_clientes_recorrentes v
  LEFT JOIN public.estados   e ON e.id = v.estado_id
  LEFT JOIN public.segmentos s ON s.id = v.segmento_id
  LEFT JOIN public.cidades   c ON c.id = v.cidade_id
  WHERE v.tenant_id = p_tenant
    AND e.sigla = p_uf
    AND v.cancelado IS TRUE
    AND v.data_cancelamento >= p_ini
    AND v.data_cancelamento <= p_fim
    AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
    )
  ORDER BY 4 DESC NULLS LAST;
$function$;

-- get_vendas_breakdown
CREATE OR REPLACE FUNCTION public.get_vendas_breakdown(p_tenant uuid, p_ini date, p_fim date, p_dim text, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, qtd bigint, new_mrr numeric, custo numeric, margem_rs numeric, margem_pct numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      public.fn_mrr_cliente_em(p_tenant, v.id, p_fim)   AS mrr,
      public.fn_custo_cliente_em(p_tenant, v.id, p_fim) AS custo,
      CASE p_dim
        WHEN 'vendedor'     THEN f.nome
        WHEN 'canal'        THEN o.nome
        WHEN 'fornecedor'   THEN fo.nome
        WHEN 'segmento'     THEN s.nome
        WHEN 'area'         THEN a.nome
        WHEN 'uf'           THEN e.sigla
        WHEN 'cidade'       THEN c.nome
        WHEN 'unidade'      THEN u.nome
        WHEN 'faixa_ticket' THEN
          CASE
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 200  THEN 'Até R$ 200'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 500  THEN 'R$ 200–500'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 1000 THEN 'R$ 500–1k'
            ELSE 'Acima de R$ 1k'
          END
        WHEN 'faixa_ticket_det' THEN
          CASE
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 100  THEN 'Até R$ 100'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 200  THEN 'R$ 100–200'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 300  THEN 'R$ 200–300'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 500  THEN 'R$ 300–500'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 1000 THEN 'R$ 500–1k'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 2000 THEN 'R$ 1k–2k'
            ELSE 'Acima de R$ 2k'
          END
      END AS dim_label
    FROM public.vw_clientes_recorrentes v
    LEFT JOIN public.funcionarios  f  ON f.id  = v.funcionario_id
    LEFT JOIN public.origens_venda o  ON o.id  = v.origem_venda_id
    LEFT JOIN public.fornecedores  fo ON fo.id = v.fornecedor_id
    LEFT JOIN public.segmentos     s  ON s.id  = v.segmento_id
    LEFT JOIN public.areas_atuacao a  ON a.id  = v.area_atuacao_id
    LEFT JOIN public.estados       e  ON e.id  = v.estado_id
    LEFT JOIN public.cidades       c  ON c.id  = v.cidade_id
    LEFT JOIN public.unidades_base u  ON u.id  = v.unidade_base_id
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva BETWEEN p_ini AND p_fim
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cpf WHERE cpf.cliente_id = v.id AND cpf.tenant_id = p_tenant AND cpf.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
  )
  SELECT
    COALESCE(NULLIF(dim_label, ''), '(sem informação)') AS label,
    count(*)::bigint AS qtd,
    round(sum(mrr), 2) AS new_mrr,
    round(sum(custo), 2) AS custo,
    round(sum(mrr - custo), 2) AS margem_rs,
    CASE WHEN sum(mrr) > 0 THEN round(sum(mrr - custo) / sum(mrr), 4) ELSE 0 END AS margem_pct,
    CASE WHEN count(*) > 0 THEN round(sum(mrr) / count(*), 2) ELSE 0 END AS ticket
  FROM base
  GROUP BY 1
  ORDER BY new_mrr DESC NULLS LAST;
$function$;

-- get_vendas_serie_mensal
CREATE OR REPLACE FUNCTION public.get_vendas_serie_mensal(p_tenant uuid, p_meses integer DEFAULT 12, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(mes date, qtd bigint, new_mrr numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ref AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date AS m0
  ),
  meses AS (
    SELECT generate_series(
      (SELECT m0 FROM ref) - ((p_meses - 1) || ' months')::interval,
      (SELECT m0 FROM ref),
      '1 month'
    )::date AS mes
  ),
  vendas AS (
    SELECT date_trunc('month', v.data_venda_efetiva)::date AS mes,
           public.fn_mrr_cliente_em(
             p_tenant, v.id,
             (date_trunc('month', v.data_venda_efetiva) + interval '1 month' - interval '1 day')::date
           ) AS mrr
    FROM public.vw_clientes_recorrentes v
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva >= (SELECT m0 FROM ref) - ((p_meses - 1) || ' months')::interval
      AND v.data_venda_efetiva <  (SELECT m0 FROM ref) + interval '1 month'
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cpf WHERE cpf.cliente_id = v.id AND cpf.tenant_id = p_tenant AND cpf.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
  )
  SELECT m.mes,
         count(v.mrr)::bigint AS qtd,
         COALESCE(round(sum(v.mrr), 2), 0) AS new_mrr,
         CASE WHEN count(v.mrr) > 0 THEN round(sum(v.mrr) / count(v.mrr), 2) ELSE 0 END AS ticket
  FROM meses m
  LEFT JOIN vendas v ON v.mes = m.mes
  GROUP BY m.mes
  ORDER BY m.mes;
$function$;

-- fn_cohort_logos
CREATE OR REPLACE FUNCTION public.fn_cohort_logos(p_from_month date DEFAULT NULL::date, p_to_month date DEFAULT NULL::date, p_max_age integer DEFAULT 36, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_tenant_id uuid DEFAULT NULL::uuid, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(tenant_id uuid, cohort_month date, age_months integer, cohort_size bigint, retained bigint, retention_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH effective_tenant AS (
    SELECT COALESCE(p_tenant_id, current_tenant_id()) AS tid
),
clientes_base AS (
    SELECT c.id, c.tenant_id,
        (date_trunc('month', COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) AS data_entrada,
        c.cancelado, c.data_cancelamento
    FROM clientes c, effective_tenant et
    WHERE COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) IS NOT NULL
      AND NOT c.evento_unico
      AND c.tenant_id = et.tid
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
      AND ((SELECT public.is_super_admin()) OR (SELECT public.user_allowed_unidades()) IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY((SELECT public.user_allowed_unidades())::bigint[]))
      AND ((SELECT public.user_view_unidades()) IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY((SELECT public.user_view_unidades())::bigint[]))
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR c.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = et.tid AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
), cohort_sizes AS (
    SELECT cb.tenant_id, cb.cohort_month, count(DISTINCT cb.id) AS cohort_size
    FROM clientes_base cb GROUP BY cb.tenant_id, cb.cohort_month
), meses AS (
    SELECT (generate_series((SELECT min(cohort_month) FROM clientes_base)::timestamp, date_trunc('month', CURRENT_DATE::timestamptz)::timestamp, '1 mon'::interval))::date AS month_ref
), cohort_age AS (
    SELECT cb.tenant_id, cb.cohort_month, m.month_ref,
        ((EXTRACT(year FROM age(m.month_ref::timestamp, cb.cohort_month::timestamp)) * 12)
         + EXTRACT(month FROM age(m.month_ref::timestamp, cb.cohort_month::timestamp)))::integer AS age_months,
        CASE WHEN cb.data_entrada <= (m.month_ref + '1 mon'::interval - '1 day'::interval)
                 AND (cb.cancelado <> true OR (cb.data_cancelamento IS NOT NULL AND cb.data_cancelamento > (m.month_ref + '1 mon'::interval - '1 day'::interval)))
            THEN 1 ELSE 0 END AS is_retained
    FROM clientes_base cb JOIN meses m ON m.month_ref >= cb.cohort_month
), agg AS (
    SELECT ca.tenant_id, ca.cohort_month, ca.age_months, sum(ca.is_retained) AS retained
    FROM cohort_age ca GROUP BY ca.tenant_id, ca.cohort_month, ca.age_months
)
SELECT a.tenant_id, a.cohort_month, a.age_months, cs.cohort_size, a.retained,
    round((a.retained::numeric / NULLIF(cs.cohort_size, 0)::numeric) * 100, 2) AS retention_percent
FROM agg a JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.cohort_month = a.cohort_month
WHERE a.age_months >= 0 AND a.age_months <= LEAST(p_max_age, 36)
  AND (p_from_month IS NULL OR a.cohort_month >= p_from_month)
  AND (p_to_month IS NULL OR a.cohort_month <= p_to_month);
$function$;

-- get_cancelamentos_breakdown
CREATE OR REPLACE FUNCTION public.get_cancelamentos_breakdown(p_tenant_id uuid, p_periodo_inicio date, p_periodo_fim date, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(cancelamentos_qtd bigint, mrr_cancelado numeric, clientes_inicio bigint, mrr_inicio numeric, churn_rate_logo numeric, churn_rate_mrr numeric, net_logo_churn bigint, mrr_liquido_perdido numeric, tenure_medio_canc_dias numeric, reativacoes_qtd bigint, mrr_reativado numeric, winback_rate_12m numeric, early_churn_qtd bigint, early_churn_mrr numeric, early_churn_rate numeric, cat_voluntary_mrr numeric, cat_voluntary_qtd bigint, cat_involuntary_mrr numeric, cat_involuntary_qtd bigint, cat_mortality_mrr numeric, cat_mortality_qtd bigint, cat_sem_classif_mrr numeric, cat_sem_classif_qtd bigint, bucket_ate_90d_qtd bigint, bucket_ate_90d_mrr numeric, bucket_91_180d_qtd bigint, bucket_91_180d_mrr numeric, bucket_181_365d_qtd bigint, bucket_181_365d_mrr numeric, bucket_mais_1y_qtd bigint, bucket_mais_1y_mrr numeric, top_motivos jsonb, tendencia_motivos jsonb, churn_por_segmento jsonb, heatmap_motivo_segmento jsonb, top10_cancelados jsonb, evolucao_12m jsonb, reativacoes_12m jsonb, cancelamentos_por_origem jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_super boolean;
  v_allowed bigint[];
  v_view bigint[];
  v_forn_ids bigint[];
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = p_tenant_id
        AND p.role IN ('admin','head','user')
    )
  ) THEN
    RAISE EXCEPTION 'access denied: tenant scope';
  END IF;

  v_is_super := public.is_super_admin();
  v_allowed  := public.user_allowed_unidades();
  v_view     := public.user_view_unidades();
  v_forn_ids := COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END);

  RETURN QUERY
  WITH 
    base_clientes AS (
      SELECT c.*
      FROM public.clientes c
      WHERE c.tenant_id = p_tenant_id
        AND NOT c.evento_unico
        AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
        AND (v_is_super OR v_allowed IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_allowed))
        AND (v_view IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_view))
        AND (v_forn_ids IS NULL OR EXISTS (SELECT 1 FROM public.cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.tenant_id = p_tenant_id AND cp.fornecedor_id = ANY(v_forn_ids)))
    ),
    mrr_cliente AS (
      SELECT bc.id AS cliente_id,
             COALESCE(cp.soma, 0) + COALESCE(mv.soma, 0) AS mrr
      FROM base_clientes bc
      LEFT JOIN LATERAL (
        SELECT SUM(p.vlr_mensal) AS soma
        FROM public.cliente_produtos p
        WHERE p.cliente_id = bc.id
      ) cp ON true
      LEFT JOIN LATERAL (
        SELECT SUM(m.valor_delta) AS soma
        FROM public.movimentos_mrr m
        WHERE m.cliente_id = bc.id
          AND m.tipo IN ('upsell','cross_sell','downsell','reajuste')
          AND m.status = 'ativo'
          AND m.estornado_por IS NULL
          AND m.estorno_de IS NULL
      ) mv ON true
    ),
    origem_primeiro AS (
      SELECT DISTINCT ON (cp.cliente_id)
        cp.cliente_id,
        cp.origem_venda_id
      FROM public.cliente_produtos cp
      JOIN base_clientes bc ON bc.id = cp.cliente_id
      ORDER BY cp.cliente_id, cp.data_venda ASC NULLS LAST, cp.created_at ASC
    ),
    canc AS (
      SELECT 
        bc.id,
        bc.razao_social,
        bc.nome_fantasia,
        bc.data_cadastro,
        bc.data_cancelamento,
        (bc.data_cancelamento - bc.data_cadastro)::int AS tenure_dias,
        COALESCE(mc.descricao, '(sem motivo)') AS motivo,
        COALESCE(mc.categoria_churn, 'sem_classif') AS categoria,
        COALESCE(s.nome, '(sem segmento)') AS segmento,
        COALESCE(mrr.mrr, 0) AS mrr_perdido
      FROM base_clientes bc
      LEFT JOIN public.motivos_cancelamento mc ON mc.id = bc.motivo_cancelamento_id
      LEFT JOIN public.segmentos s ON s.id = bc.segmento_id
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      WHERE bc.cancelado = true
        AND bc.data_cancelamento BETWEEN p_periodo_inicio AND p_periodo_fim
    ),
    canc_12m AS (
      SELECT bc.id
      FROM base_clientes bc
      WHERE bc.cancelado = true
        AND bc.data_cancelamento >= (p_periodo_fim - INTERVAL '12 months')
        AND bc.data_cancelamento <= p_periodo_fim
    ),
    reat AS (
      SELECT 
        bc.id,
        bc.data_reativacao,
        bc.data_cancelamento,
        COALESCE(mrr.mrr, 0) AS mrr_recuperado
      FROM base_clientes bc
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      WHERE bc.data_reativacao BETWEEN p_periodo_inicio AND p_periodo_fim
    ),
    reat_12m AS (
      SELECT bc.id
      FROM base_clientes bc
      WHERE bc.data_reativacao IS NOT NULL
        AND bc.data_reativacao >= (p_periodo_fim - INTERVAL '12 months')
        AND bc.data_reativacao <= p_periodo_fim
    ),
    base_inicio AS (
      SELECT 
        COUNT(*) FILTER (WHERE (bc.cancelado = false OR bc.data_cancelamento >= p_periodo_inicio)) AS qtd,
        COALESCE(SUM(COALESCE(mrr.mrr, 0)) FILTER (WHERE (bc.cancelado = false OR bc.data_cancelamento >= p_periodo_inicio)), 0) AS mrr_total
      FROM base_clientes bc
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      WHERE bc.data_cadastro <= p_periodo_inicio
    ),
    magnitude AS (
      SELECT 
        COUNT(*)::bigint AS qtd,
        COALESCE(SUM(mrr_perdido), 0) AS mrr,
        COALESCE(AVG(tenure_dias)::numeric, 0) AS tenure_medio,
        COUNT(*) FILTER (WHERE tenure_dias <= 90)::bigint AS early_qtd,
        COALESCE(SUM(mrr_perdido) FILTER (WHERE tenure_dias <= 90), 0) AS early_mrr
      FROM canc
    ),
    reat_mag AS (
      SELECT 
        COUNT(*)::bigint AS qtd,
        COALESCE(SUM(mrr_recuperado), 0) AS mrr
      FROM reat
    ),
    categorias AS (
      SELECT categoria, SUM(mrr_perdido) AS mrr, COUNT(*)::bigint AS qtd
      FROM canc GROUP BY categoria
    ),
    buckets AS (
      SELECT 
        CASE 
          WHEN tenure_dias <= 90 THEN 'ate_90d'
          WHEN tenure_dias BETWEEN 91 AND 180 THEN 'd91_180'
          WHEN tenure_dias BETWEEN 181 AND 365 THEN 'd181_365'
          ELSE 'mais_1y'
        END AS bucket,
        COUNT(*)::bigint AS qtd,
        SUM(mrr_perdido) AS mrr
      FROM canc GROUP BY bucket
    ),
    top_motivos_q AS (
      SELECT motivo, categoria, COUNT(*)::bigint AS qtd, SUM(mrr_perdido) AS mrr_perdido,
             AVG(tenure_dias)::int AS tenure_medio,
             COUNT(*) FILTER (WHERE tenure_dias <= 90)::bigint AS qtd_early
      FROM canc GROUP BY motivo, categoria
      ORDER BY mrr_perdido DESC NULLS LAST
      LIMIT 7
    ),
    base_6m_canc AS (
      SELECT 
        COALESCE(mc.descricao, '(sem motivo)') AS motivo,
        CASE WHEN bc.data_cancelamento > (p_periodo_fim - INTERVAL '6 months') THEN 'rec' ELSE 'ant' END AS periodo
      FROM base_clientes bc
      LEFT JOIN public.motivos_cancelamento mc ON mc.id = bc.motivo_cancelamento_id
      WHERE bc.cancelado = true
        AND bc.data_cancelamento >= (p_periodo_fim - INTERVAL '12 months')
        AND bc.data_cancelamento <= p_periodo_fim
    ),
    tendencia_q AS (
      SELECT motivo,
             COUNT(*) FILTER (WHERE periodo = 'ant')::bigint AS qtd_anterior_6m,
             COUNT(*) FILTER (WHERE periodo = 'rec')::bigint AS qtd_recente_6m,
             (COUNT(*) FILTER (WHERE periodo = 'rec') - COUNT(*) FILTER (WHERE periodo = 'ant'))::int AS delta
      FROM base_6m_canc GROUP BY motivo
      HAVING COUNT(*) >= 3
    ),
    seg_q AS (
      SELECT 
        COALESCE(s.nome, '(sem segmento)') AS segmento,
        COUNT(*) FILTER (WHERE NOT bc.cancelado)::bigint AS ativos,
        COUNT(*) FILTER (WHERE bc.cancelado)::bigint AS cancelados,
        ROUND(100.0 * COUNT(*) FILTER (WHERE bc.cancelado) / NULLIF(COUNT(*), 0), 2) AS churn_rate,
        ROUND(AVG(bc.data_cancelamento - bc.data_cadastro) FILTER (WHERE bc.cancelado)::numeric, 0) AS tenure_canc,
        ROUND(AVG(CURRENT_DATE - bc.data_cadastro) FILTER (WHERE NOT bc.cancelado)::numeric, 0) AS tenure_ativos
      FROM base_clientes bc
      LEFT JOIN public.segmentos s ON s.id = bc.segmento_id
      GROUP BY s.nome
      HAVING COUNT(*) >= 5
      ORDER BY cancelados DESC NULLS LAST
      LIMIT 10
    ),
    top_5_motivos_lst AS (
      SELECT motivo FROM top_motivos_q ORDER BY mrr_perdido DESC NULLS LAST LIMIT 5
    ),
    top_6_segmentos_lst AS (
      SELECT segmento FROM seg_q ORDER BY cancelados DESC LIMIT 6
    ),
    heatmap_q AS (
      SELECT c.motivo, c.segmento, COUNT(*)::bigint AS qtd, COALESCE(SUM(c.mrr_perdido), 0) AS mrr
      FROM canc c
      WHERE c.motivo IN (SELECT motivo FROM top_5_motivos_lst)
        AND c.segmento IN (SELECT segmento FROM top_6_segmentos_lst)
      GROUP BY c.motivo, c.segmento
    ),
    top10_q AS (
      SELECT id, razao_social, nome_fantasia, segmento, motivo, categoria AS categoria_churn,
             mrr_perdido, tenure_dias, data_cancelamento
      FROM canc
      ORDER BY mrr_perdido DESC NULLS LAST
      LIMIT 10
    ),
    meses_serie AS (
      SELECT generate_series(
        date_trunc('month', p_periodo_fim - INTERVAL '11 months')::date,
        date_trunc('month', p_periodo_fim)::date,
        '1 month'::interval
      )::date AS mes_inicio
    ),
    evo_q AS (
      SELECT 
        to_char(ms.mes_inicio, 'YYYY-MM') AS mes,
        COUNT(bc.id) FILTER (WHERE bc.cancelado AND date_trunc('month', bc.data_cancelamento)::date = ms.mes_inicio)::bigint AS qtd,
        COALESCE(SUM(COALESCE(mrr.mrr, 0)) FILTER (WHERE bc.cancelado AND date_trunc('month', bc.data_cancelamento)::date = ms.mes_inicio), 0) AS mrr_total
      FROM meses_serie ms
      LEFT JOIN base_clientes bc ON bc.cancelado AND date_trunc('month', bc.data_cancelamento)::date = ms.mes_inicio
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      GROUP BY ms.mes_inicio
      ORDER BY ms.mes_inicio
    ),
    reat_serie_q AS (
      SELECT 
        to_char(ms.mes_inicio, 'YYYY-MM') AS mes,
        COUNT(bc.id) FILTER (WHERE bc.data_reativacao IS NOT NULL AND date_trunc('month', bc.data_reativacao)::date = ms.mes_inicio)::bigint AS qtd,
        COALESCE(SUM(COALESCE(mrr.mrr, 0)) FILTER (WHERE bc.data_reativacao IS NOT NULL AND date_trunc('month', bc.data_reativacao)::date = ms.mes_inicio), 0) AS mrr_total,
        ROUND(AVG(bc.data_reativacao - bc.data_cancelamento) FILTER (WHERE bc.data_reativacao IS NOT NULL AND bc.data_cancelamento IS NOT NULL AND date_trunc('month', bc.data_reativacao)::date = ms.mes_inicio)::numeric, 0) AS tempo_medio_fora
      FROM meses_serie ms
      LEFT JOIN base_clientes bc ON bc.data_reativacao IS NOT NULL AND date_trunc('month', bc.data_reativacao)::date = ms.mes_inicio
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      GROUP BY ms.mes_inicio
      ORDER BY ms.mes_inicio
    ),
    canc_origem AS (
      SELECT 
        COALESCE(ov.nome, '(sem origem)') AS origem,
        COUNT(*) FILTER (WHERE bc.cancelado AND bc.data_cancelamento BETWEEN p_periodo_inicio AND p_periodo_fim)::bigint AS canc_qtd,
        COALESCE(SUM(COALESCE(mrr.mrr, 0)) FILTER (WHERE bc.cancelado AND bc.data_cancelamento BETWEEN p_periodo_inicio AND p_periodo_fim), 0) AS canc_mrr,
        COUNT(*) FILTER (WHERE bc.data_cadastro <= p_periodo_inicio AND (NOT bc.cancelado OR bc.data_cancelamento >= p_periodo_inicio))::bigint AS ativos_inicio
      FROM base_clientes bc
      LEFT JOIN origem_primeiro op ON op.cliente_id = bc.id
      LEFT JOIN public.origens_venda ov ON ov.id = op.origem_venda_id AND ov.tenant_id = p_tenant_id
      LEFT JOIN mrr_cliente mrr ON mrr.cliente_id = bc.id
      GROUP BY ov.nome
      HAVING COUNT(*) FILTER (WHERE bc.cancelado AND bc.data_cancelamento BETWEEN p_periodo_inicio AND p_periodo_fim) > 0
    )
  SELECT
    m.qtd,
    m.mrr,
    bi.qtd,
    bi.mrr_total,
    CASE WHEN bi.qtd > 0 THEN ROUND(m.qtd::numeric / bi.qtd, 6) ELSE 0 END,
    CASE WHEN bi.mrr_total > 0 THEN ROUND(m.mrr / bi.mrr_total, 6) ELSE 0 END,
    (m.qtd - rm.qtd),
    (m.mrr - rm.mrr),
    m.tenure_medio,
    rm.qtd,
    rm.mrr,
    CASE WHEN (SELECT COUNT(*) FROM canc_12m) > 0 
         THEN ROUND((SELECT COUNT(*) FROM reat_12m)::numeric / (SELECT COUNT(*) FROM canc_12m), 6)
         ELSE 0 END,
    m.early_qtd,
    m.early_mrr,
    CASE WHEN m.qtd > 0 THEN ROUND(m.early_qtd::numeric / m.qtd, 6) ELSE 0 END,
    COALESCE((SELECT mrr FROM categorias WHERE categoria = 'voluntary'), 0),
    COALESCE((SELECT qtd FROM categorias WHERE categoria = 'voluntary'), 0),
    COALESCE((SELECT mrr FROM categorias WHERE categoria = 'involuntary'), 0),
    COALESCE((SELECT qtd FROM categorias WHERE categoria = 'involuntary'), 0),
    COALESCE((SELECT mrr FROM categorias WHERE categoria = 'mortality'), 0),
    COALESCE((SELECT qtd FROM categorias WHERE categoria = 'mortality'), 0),
    COALESCE((SELECT mrr FROM categorias WHERE categoria = 'sem_classif'), 0),
    COALESCE((SELECT qtd FROM categorias WHERE categoria = 'sem_classif'), 0),
    COALESCE((SELECT qtd FROM buckets WHERE bucket = 'ate_90d'), 0),
    COALESCE((SELECT mrr FROM buckets WHERE bucket = 'ate_90d'), 0),
    COALESCE((SELECT qtd FROM buckets WHERE bucket = 'd91_180'), 0),
    COALESCE((SELECT mrr FROM buckets WHERE bucket = 'd91_180'), 0),
    COALESCE((SELECT qtd FROM buckets WHERE bucket = 'd181_365'), 0),
    COALESCE((SELECT mrr FROM buckets WHERE bucket = 'd181_365'), 0),
    COALESCE((SELECT qtd FROM buckets WHERE bucket = 'mais_1y'), 0),
    COALESCE((SELECT mrr FROM buckets WHERE bucket = 'mais_1y'), 0),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'motivo', motivo, 'categoria', categoria, 'qtd', qtd,
      'mrr_perdido', mrr_perdido, 'tenure_medio_dias', tenure_medio, 'qtd_early', qtd_early
    ) ORDER BY mrr_perdido DESC NULLS LAST) FROM top_motivos_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'motivo', motivo, 'qtd_anterior_6m', qtd_anterior_6m,
      'qtd_recente_6m', qtd_recente_6m, 'delta', delta
    ) ORDER BY delta DESC) FROM tendencia_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'segmento', segmento, 'ativos', ativos, 'cancelados', cancelados,
      'churn_rate', churn_rate, 'tenure_canc', tenure_canc, 'tenure_ativos', tenure_ativos
    ) ORDER BY cancelados DESC NULLS LAST) FROM seg_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'motivo', motivo, 'segmento', segmento, 'qtd', qtd, 'mrr', mrr
    )) FROM heatmap_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'cliente_id', id, 'razao_social', razao_social, 'nome_fantasia', nome_fantasia,
      'segmento', segmento, 'motivo', motivo, 'categoria_churn', categoria_churn,
      'mrr_perdido', mrr_perdido, 'tenure_dias', tenure_dias, 'data_cancelamento', data_cancelamento
    ) ORDER BY mrr_perdido DESC NULLS LAST) FROM top10_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'mes', mes, 'qtd', qtd, 'mrr', mrr_total
    ) ORDER BY mes) FROM evo_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'mes', mes, 'qtd', qtd, 'mrr', mrr_total, 'tempo_medio_fora_dias', tempo_medio_fora
    ) ORDER BY mes) FROM reat_serie_q), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'origem', origem,
      'qtd_cancelamentos', canc_qtd,
      'mrr_cancelado', canc_mrr,
      'qtd_ativos_inicio', ativos_inicio,
      'churn_rate', CASE WHEN ativos_inicio > 0 THEN ROUND(100.0 * canc_qtd / ativos_inicio, 2) ELSE 0 END,
      'ticket_medio_cancelado', CASE WHEN canc_qtd > 0 THEN ROUND(canc_mrr / canc_qtd, 2) ELSE 0 END
    ) ORDER BY canc_mrr DESC NULLS LAST)
     FROM (SELECT * FROM canc_origem ORDER BY canc_mrr DESC NULLS LAST LIMIT 10) lim), '[]'::jsonb)
  FROM magnitude m
  CROSS JOIN base_inicio bi
  CROSS JOIN reat_mag rm;
END;
$function$;

-- get_tenure_medio_meses
CREATE OR REPLACE FUNCTION public.get_tenure_medio_meses(p_tenant_id uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenure numeric;
  v_is_super boolean;
  v_allowed bigint[];
  v_view bigint[];
  v_forn_ids bigint[];
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.tenant_id = p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'access denied: tenant scope';
  END IF;

  v_is_super := public.is_super_admin();
  v_allowed  := public.user_allowed_unidades();
  v_view     := public.user_view_unidades();
  v_forn_ids := COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END);

  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (now() - data_inicial)) / (86400 * 30.44))::numeric, 1)
  INTO v_tenure
  FROM (
    SELECT COALESCE(
        (SELECT MIN(ct.data_venda) FROM public.contratos ct WHERE ct.cliente_id = c.id AND ct.cancelado_em IS NULL),
        c.data_cadastro::date
      ) AS data_inicial
    FROM public.clientes c
    WHERE c.tenant_id = p_tenant_id
      AND COALESCE(c.cancelado, false) = false
      AND NOT c.evento_unico
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
      AND (v_is_super OR v_allowed IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_allowed))
      AND (v_view IS NULL OR c.unidade_base_id IS NULL OR c.unidade_base_id = ANY(v_view))
      AND (
        v_forn_ids IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.tenant_id = p_tenant_id AND cp.fornecedor_id = ANY(v_forn_ids))
      )
  ) sub
  WHERE data_inicial IS NOT NULL AND data_inicial >= '2000-01-01'::date;

  RETURN COALESCE(v_tenure, 0);
END;
$function$;
