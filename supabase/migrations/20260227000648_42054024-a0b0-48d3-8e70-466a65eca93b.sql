CREATE OR REPLACE VIEW public.vw_cohort_logos AS
WITH clientes_base AS (
  SELECT id, tenant_id,
    date_trunc('month', COALESCE(data_venda, data_ativacao, data_cadastro)::timestamp)::date AS cohort_month,
    COALESCE(data_venda, data_ativacao, data_cadastro) AS data_entrada,
    data_cancelamento
  FROM clientes
  WHERE COALESCE(data_venda, data_ativacao, data_cadastro) IS NOT NULL
),
cohort_sizes AS (
  SELECT tenant_id, cohort_month, COUNT(DISTINCT id) AS cohort_size
  FROM clientes_base
  GROUP BY tenant_id, cohort_month
),
meses AS (
  SELECT generate_series(
    (SELECT min(cohort_month) FROM clientes_base)::timestamp,
    date_trunc('month', CURRENT_DATE)::timestamp,
    '1 month'
  )::date AS month_ref
),
cohort_age AS (
  SELECT c.tenant_id, c.cohort_month, m.month_ref,
    (EXTRACT(year FROM age(m.month_ref::timestamp, c.cohort_month::timestamp)) * 12
     + EXTRACT(month FROM age(m.month_ref::timestamp, c.cohort_month::timestamp)))::integer AS age_months,
    CASE WHEN c.data_entrada <= (m.month_ref + interval '1 month' - interval '1 day')
          AND (c.data_cancelamento IS NULL OR c.data_cancelamento > (m.month_ref + interval '1 month' - interval '1 day'))
         THEN 1 ELSE 0 END AS is_retained
  FROM clientes_base c
  JOIN meses m ON m.month_ref >= c.cohort_month
),
agg AS (
  SELECT tenant_id, cohort_month, age_months, SUM(is_retained) AS retained
  FROM cohort_age
  GROUP BY tenant_id, cohort_month, age_months
)
SELECT a.tenant_id, a.cohort_month, a.age_months,
  cs.cohort_size,
  a.retained,
  ROUND(a.retained::numeric / NULLIF(cs.cohort_size, 0) * 100, 2) AS retention_percent
FROM agg a
JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.cohort_month = a.cohort_month
WHERE a.age_months BETWEEN 0 AND 12;