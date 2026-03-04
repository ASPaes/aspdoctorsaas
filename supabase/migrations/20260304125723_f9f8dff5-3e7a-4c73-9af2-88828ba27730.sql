
-- 1. Add tenant_id to vw_clientes_financeiro view
CREATE OR REPLACE VIEW vw_clientes_financeiro AS
SELECT c.id,
    c.codigo_sequencial,
    c.razao_social,
    c.nome_fantasia,
    c.cnpj,
    c.email,
    c.telefone_contato,
    c.telefone_whatsapp,
    c.observacao_cliente,
    c.observacao_negociacao,
    c.origem_venda_id,
    c.data_cadastro,
    c.estado_id,
    c.cidade_id,
    c.area_atuacao_id,
    c.segmento_id,
    c.modelo_contrato_id,
    c.unidade_base_id,
    c.data_venda,
    c.data_ativacao,
    c.funcionario_id,
    c.recorrencia,
    c.produto_id,
    c.valor_ativacao,
    c.forma_pagamento_ativacao_id,
    c.mensalidade,
    c.forma_pagamento_mensalidade_id,
    c.custo_operacao,
    c.imposto_percentual,
    c.custo_fixo_percentual,
    c.cancelado,
    c.data_cancelamento,
    c.motivo_cancelamento_id,
    c.observacao_cancelamento,
    c.created_at,
    c.updated_at,
    c.cert_a1_vencimento,
    c.cert_a1_ultima_venda_em,
    c.cert_a1_ultimo_vendedor_id,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round(c.mensalidade * COALESCE(c.imposto_percentual, 0), 2)
        ELSE 0
    END AS impostos_rs,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0), 2)
        ELSE 0
    END AS fixos_rs,
    COALESCE(c.custo_operacao, 0) AS valor_repasse,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round(c.mensalidade - COALESCE(c.custo_operacao, 0), 2)
        ELSE 0
    END AS lucro_bruto,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round(c.mensalidade - COALESCE(c.custo_operacao, 0) - round(c.mensalidade * COALESCE(c.imposto_percentual, 0), 2) - round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0), 2), 2)
        ELSE 0
    END AS lucro_real,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round((c.mensalidade - COALESCE(c.custo_operacao, 0)) / c.mensalidade * 100, 2)
        ELSE 0
    END AS margem_bruta_percent,
    CASE
        WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0 THEN round((c.mensalidade - COALESCE(c.custo_operacao, 0) - round(c.mensalidade * COALESCE(c.imposto_percentual, 0), 2) - round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0), 2)) / c.mensalidade * 100, 2)
        ELSE 0
    END AS margem_contribuicao,
    CASE
        WHEN COALESCE(c.custo_operacao, 0) > 0 THEN round(c.mensalidade / c.custo_operacao, 2)
        ELSE NULL
    END AS fator_preco_cogs_x,
    CASE
        WHEN COALESCE(c.custo_operacao, 0) > 0 THEN round((c.mensalidade - c.custo_operacao) / c.custo_operacao * 100, 2)
        ELSE NULL
    END AS markup_cogs_percent,
    c.fornecedor_id,
    c.tenant_id
FROM clientes c;

-- 2. Modify fn_cohort_logos to accept optional p_tenant_id
CREATE OR REPLACE FUNCTION public.fn_cohort_logos(
  p_from_month date DEFAULT NULL,
  p_to_month date DEFAULT NULL,
  p_max_age integer DEFAULT 36,
  p_fornecedor_id bigint DEFAULT NULL,
  p_unidade_base_id bigint DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE(tenant_id uuid, cohort_month date, age_months integer, cohort_size bigint, retained bigint, retention_percent numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH effective_tenant AS (
  SELECT COALESCE(p_tenant_id, current_tenant_id()) AS tid
),
clientes_base AS (
    SELECT c.id,
        c.tenant_id,
        (date_trunc('month', COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) AS data_entrada,
        c.data_cancelamento
    FROM clientes c, effective_tenant et
    WHERE COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) IS NOT NULL
      AND c.tenant_id = et.tid
      AND (p_fornecedor_id IS NULL OR c.fornecedor_id = p_fornecedor_id)
      AND (p_unidade_base_id IS NULL OR c.unidade_base_id = p_unidade_base_id)
), cohort_sizes AS (
    SELECT cb.tenant_id,
        cb.cohort_month,
        count(DISTINCT cb.id) AS cohort_size
    FROM clientes_base cb
    GROUP BY cb.tenant_id, cb.cohort_month
), meses AS (
    SELECT (generate_series(
        (SELECT min(cohort_month) FROM clientes_base)::timestamp,
        date_trunc('month', CURRENT_DATE::timestamptz)::timestamp,
        '1 mon'::interval
    ))::date AS month_ref
), cohort_age AS (
    SELECT cb.tenant_id,
        cb.cohort_month,
        m.month_ref,
        ((EXTRACT(year FROM age(m.month_ref::timestamp, cb.cohort_month::timestamp)) * 12)
         + EXTRACT(month FROM age(m.month_ref::timestamp, cb.cohort_month::timestamp)))::integer AS age_months,
        CASE
            WHEN cb.data_entrada <= (m.month_ref + '1 mon'::interval - '1 day'::interval)
                 AND (cb.data_cancelamento IS NULL OR cb.data_cancelamento > (m.month_ref + '1 mon'::interval - '1 day'::interval))
            THEN 1
            ELSE 0
        END AS is_retained
    FROM clientes_base cb
    JOIN meses m ON m.month_ref >= cb.cohort_month
), agg AS (
    SELECT ca.tenant_id,
        ca.cohort_month,
        ca.age_months,
        sum(ca.is_retained) AS retained
    FROM cohort_age ca
    GROUP BY ca.tenant_id, ca.cohort_month, ca.age_months
)
SELECT a.tenant_id,
    a.cohort_month,
    a.age_months,
    cs.cohort_size,
    a.retained,
    round((a.retained::numeric / NULLIF(cs.cohort_size, 0)::numeric) * 100, 2) AS retention_percent
FROM agg a
JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.cohort_month = a.cohort_month
WHERE a.age_months >= 0
  AND a.age_months <= LEAST(p_max_age, 36)
  AND (p_from_month IS NULL OR a.cohort_month >= p_from_month)
  AND (p_to_month IS NULL OR a.cohort_month <= p_to_month);
$$;
