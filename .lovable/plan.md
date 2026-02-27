

## Diagnosis

**Root Cause:** Lines 337-339 in `useDashboardData.ts`:

```typescript
const ltvMesesEvolution = months.map(m => ({ month: m.month, monthFull: m.monthFull, value: ltvMeses }));
const ltvCacEvolution = months.map(m => ({ month: m.month, monthFull: m.monthFull, value: ltvCac }));
```

Both charts use a **single scalar value** (`ltvMeses`, `ltvCac`) calculated once for the entire filtered period, then repeat that same value across all 12 months. This is why every month shows an identical flat line -- the comment even says `(simplified)`.

The correct approach is to **recalculate LTV and LTV/CAC for each month** based on the state of the portfolio at that point in time, just like MRR and churn evolution are already calculated per-month in the loop above (lines 300-334).

## Plan

**Edit `src/components/dashboard/hooks/useDashboardData.ts`:**

1. Move the LTV and LTV/CAC calculations **inside the `months.forEach` loop** (lines 300-335).
2. For each month, compute:
   - **LTV (meses):** Average tenure of clients active at end of that month (difference between `data_cadastro` and month end, in months).
   - **Churn rate for that month:** Number of cancellations in that month / active clients at start of month. Then `LTV = 1 / churnRate` if churn > 0.
   - **LTV/CAC:** Use the month's LTV in R$ (LTV meses * ticket medio of that month) divided by CAC. Since CAC depends on `cac_despesas` which is already loaded, we can approximate by using the overall CAC or recalculating per-month.
3. The simplest correct approach: for each month, calculate the **rolling churn rate** (trailing 3 or 6 months to smooth), derive LTV meses = 1/churnRate, and LTV/CAC = (ticketMedio * ltvMeses) / cac.
4. Remove the old flat-line assignments on lines 337-339.

### Technical Detail

For each month `m` in the 12-month window:
- `activosInicio` = clients active at start of month
- `canceladosNoMes` = already computed in the loop
- `churnRateMes` = canceladosNoMes.length / activosInicio.length
- `ltvMesesMes` = churnRateMes > 0 ? (1 / churnRateMes) : previous month value (or global fallback)
- `ticketMedioMes` = mrrMes / activosNoMes.length
- `ltvReaisMes` = ticketMedioMes * ltvMesesMes
- `ltvCacMes` = cac > 0 ? ltvReaisMes / cac : 0

Push these per-month values into the evolution arrays.

