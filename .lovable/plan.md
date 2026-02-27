

## Diagnosis

**Root cause: SQL view `vw_cohort_logos`** has a broken `cohort_size` calculation.

The view uses:
```sql
count(*) FILTER (WHERE age_months = 0) OVER (PARTITION BY tenant_id, cohort_month) AS cohort_size
```
This runs AFTER `GROUP BY tenant_id, cohort_month, age_months`, meaning it counts grouped rows (always 1 row for age_months=0), not individual clients. Result: `cohort_size = 1` always, making `retention_percent = retained / 1 * 100` = absurd values like 1500%, 3400%.

**Frontend is correct** -- it displays `retention_percent` and `cohort_size` directly without any multiplication.

---

## Fix: Replace the view via migration

Rewrite `vw_cohort_logos` with a corrected `cohort_size` calculated as `COUNT(DISTINCT id)` per cohort in a separate CTE, before the age-based aggregation.

Also apply the requested fallback: `COALESCE(data_venda, data_ativacao, data_cadastro)` for the cohort base date, so clients without `data_venda` are still included.

### Corrected SQL (key change)

```sql
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
```

### Changes summary
- **`cohort_sizes` CTE**: Separate `COUNT(DISTINCT id)` per tenant+cohort, computed before age expansion
- **`COALESCE` fallback**: Uses `data_venda → data_ativacao → data_cadastro` so no clients are excluded
- **No frontend changes needed** -- the UI already displays `cohort_size` and `retention_percent` correctly

### Files
- **Migration**: 1 new migration file with `CREATE OR REPLACE VIEW`
- No component changes required

