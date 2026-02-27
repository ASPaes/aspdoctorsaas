CREATE OR REPLACE FUNCTION public.fn_cohort_logos(
  p_from_month date DEFAULT NULL,
  p_to_month date DEFAULT NULL,
  p_max_age integer DEFAULT 36,
  p_fornecedor_id bigint DEFAULT NULL,
  p_unidade_base_id bigint DEFAULT NULL
)
RETURNS TABLE(
  tenant_id uuid,
  cohort_month date,
  age_months integer,
  cohort_size bigint,
  retained bigint,
  retention_percent numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH clientes_base AS (
    SELECT c.id,
        c.tenant_id,
        (date_trunc('month', COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) AS data_entrada,
        c.data_cancelamento
    FROM clientes c
    WHERE COALESCE(c.data_venda, c.data_ativacao, c.data_cadastro) IS NOT NULL
      AND c.tenant_id = current_tenant_id()
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
        COALESCE(p_from_month, (SELECT min(cohort_month) FROM clientes_base))::timestamp,
        COALESCE(p_to_month, date_trunc('month', CURRENT_DATE::timestamptz))::timestamp,
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
WHERE a.age_months >= 0 AND a.age_months <= LEAST(p_max_age, 36);
$$;