CREATE OR REPLACE VIEW vw_cohort_logos AS
WITH clientes_base AS (
    SELECT clientes.id,
        clientes.tenant_id,
        (date_trunc('month', COALESCE(clientes.data_venda, clientes.data_ativacao, clientes.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(clientes.data_venda, clientes.data_ativacao, clientes.data_cadastro) AS data_entrada,
        clientes.data_cancelamento
    FROM clientes
    WHERE COALESCE(clientes.data_venda, clientes.data_ativacao, clientes.data_cadastro) IS NOT NULL
), cohort_sizes AS (
    SELECT clientes_base.tenant_id,
        clientes_base.cohort_month,
        count(DISTINCT clientes_base.id) AS cohort_size
    FROM clientes_base
    GROUP BY clientes_base.tenant_id, clientes_base.cohort_month
), meses AS (
    SELECT (generate_series(
        (SELECT min(cohort_month) FROM clientes_base)::timestamp,
        date_trunc('month', CURRENT_DATE::timestamptz)::timestamp,
        '1 mon'::interval
    ))::date AS month_ref
), cohort_age AS (
    SELECT c.tenant_id,
        c.cohort_month,
        m.month_ref,
        ((EXTRACT(year FROM age(m.month_ref::timestamp, c.cohort_month::timestamp)) * 12)
         + EXTRACT(month FROM age(m.month_ref::timestamp, c.cohort_month::timestamp)))::integer AS age_months,
        CASE
            WHEN c.data_entrada <= (m.month_ref + '1 mon'::interval - '1 day'::interval)
                 AND (c.data_cancelamento IS NULL OR c.data_cancelamento > (m.month_ref + '1 mon'::interval - '1 day'::interval))
            THEN 1
            ELSE 0
        END AS is_retained
    FROM clientes_base c
    JOIN meses m ON m.month_ref >= c.cohort_month
), agg AS (
    SELECT cohort_age.tenant_id,
        cohort_age.cohort_month,
        cohort_age.age_months,
        sum(cohort_age.is_retained) AS retained
    FROM cohort_age
    GROUP BY cohort_age.tenant_id, cohort_age.cohort_month, cohort_age.age_months
)
SELECT a.tenant_id,
    a.cohort_month,
    a.age_months,
    cs.cohort_size,
    a.retained,
    round((a.retained::numeric / NULLIF(cs.cohort_size, 0)::numeric) * 100, 2) AS retention_percent
FROM agg a
JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.cohort_month = a.cohort_month
WHERE a.age_months >= 0 AND a.age_months <= 36;