

## Plan: Dashboard Completo — Ported from Reference + New Indicators

This is a large implementation. Given the scope, I recommend splitting into **3 phases** delivered incrementally. This plan covers **Phase 1** (core structure + 4 tabs) which is already a substantial deliverable. Phases 2-3 (Cohort, Forecast, Auto-Insights) will follow as separate iterations.

---

### Key Differences from Reference Project

The reference project uses string-based fields (`cidade`, `estado`, `unidade_base`, `fornecedor`, `segmento`, `area_atuacao`, `origem_venda`, `motivo_cancelamento`) directly on `clientes`. This project uses **FK IDs** (`estado_id`, `cidade_id`, `unidade_base_id`, `fornecedor_id`, `segmento_id`, `area_atuacao_id`, `origem_venda_id`, `motivo_cancelamento_id`) requiring JOINs. It also lacks `vw_churn_mes`, `vw_ltv_mes`, `vw_cert_a1_oportunidades_rolling`, and `consultores` table. All queries must use the existing `vw_clientes_financeiro` view and the `funcionarios` table instead.

The reference has a hardcoded `unidade` filter (ASP/VEX). This project uses dynamic `unidades_base` table, so the filter will be a Select populated from lookup data.

---

### Database Changes

**1. Create `vw_dashboard_churn_mes` materialized view** (migration):
- Aggregates monthly churn counts and MRR from `clientes` where `cancelado = true` and `data_cancelamento IS NOT NULL`
- Groups by `EXTRACT(YEAR FROM data_cancelamento)`, `EXTRACT(MONTH FROM data_cancelamento)`

**2. No other DB changes needed** — all data is derivable from existing tables.

---

### Files to Create

#### `src/components/dashboard/types.ts`
- `DashboardFilters`: `{ periodoInicio, periodoFim, unidadeBaseId?, fornecedorId?, showAllData }`
- `KPIMetrics`: adapted from reference (remove ASP/VEX hardcoded, remove `consultoresRanking` for now)
- `TimeSeriesData`, `DistributionData`, `ChartDataPoint`, `DistributionDataPoint`

#### `src/components/dashboard/hooks/useDashboardData.ts`
- Adapted from reference project's 800-line hook but using **FK JOINs** instead of string fields
- Uses `supabase.from('clientes').select('*, estado:estados(sigla,nome), cidade:cidades(nome), segmento:segmentos(nome), area_atuacao:areas_atuacao(nome), fornecedor:fornecedores(nome), motivo_cancelamento:motivos_cancelamento(descricao), origem_venda:origens_venda(nome), unidade_base:unidades_base(nome), funcionario:funcionarios(nome)')`
- Calculates: MRR, ARR, Ticket Médio, Clientes Ativos, New MRR, Churn, Early Churn, NRR, GRR, LTV, CAC (from `cac_despesas`), LTV/CAC, Net New MRR breakdown (upsell/cross-sell/downsell from `movimentos_mrr`), Concentração Top 10, Margem Contribuição (from `vw_clientes_financeiro`)
- Time series: 12-month evolution for MRR, Churn Qtd, Churn MRR
- Distributions: by estado, cidade, segmento, area_atuacao, fornecedor, motivo_cancelamento, origem_venda

#### `src/components/dashboard/hooks/useCertA1Data.ts`
- Simplified version (no `vw_cert_a1_oportunidades_rolling`): queries `certificado_a1_vendas` for period sales and `clientes` for rolling cert vencimento windows

#### `src/components/dashboard/DashboardFilters.tsx`
- Period presets (Mês Atual, 3/6/12 meses, Personalizado)
- Unidade Base select (from `unidades_base` lookup, + "Geral")
- Fornecedor select (from `fornecedores` lookup)
- TV Mode toggle, Auto-refresh, Refresh button

#### `src/components/dashboard/cards/KPICardEnhanced.tsx`
- Direct port from reference (already uses design system tokens)

#### `src/components/dashboard/cards/NetNewMrrBreakdown.tsx`
- Direct port from reference

#### `src/components/dashboard/charts/LineChartCard.tsx`
- Direct port, remove `showUnits` ASP/VEX logic, add `showUnidades` for dynamic unidade_base

#### `src/components/dashboard/charts/PieChartCard.tsx`
- Direct port

#### `src/components/dashboard/charts/BarChartCard.tsx`
- Direct port

#### `src/components/dashboard/charts/BrazilMapChart.tsx` + `BrazilSvgMap.tsx`
- Direct port

#### Tab Components (6 tabs, excluding Metas):

**`src/components/dashboard/tabs/VisaoGeralTab.tsx`**
- KPIs: MRR Total, Clientes Ativos, Ticket Médio, ARR
- MRR by Unidade Base (dynamic, not hardcoded ASP/VEX)
- NRR, GRR, Concentração Top 10
- Cert A1 section
- MRR + Faturamento evolution charts

**`src/components/dashboard/tabs/CrescimentoTab.tsx`**
- Crescimento R$, %, Net New MRR, Margem Contribuição
- LTV (meses), LTV (R$), CAC, LTV/CAC, CAC Payback
- Net New MRR Breakdown component
- MRR por Funcionário (replaces "consultores" — uses `funcionarios` table via `funcionario_id`)
- LTV evolution chart

**`src/components/dashboard/tabs/CancelamentosTab.tsx`**
- Cancelamentos Qtd, MRR Cancelado, Churn Rate Carteira, Churn Rate Receita
- Early Churn (≤90 dias) section
- Churn Qtd + MRR evolution charts
- Pie chart: por Motivo Cancelamento

**`src/components/dashboard/tabs/VendasTab.tsx`**
- Novos Clientes, New MRR, Receita Ativação, MRR Adicionado
- Ticket Médio Novos, Setup Médio
- Pie: por Origem Venda; Bar: por Fornecedor

**`src/components/dashboard/tabs/DistribuicaoTab.tsx`**
- Brazil SVG Map by Estado
- Bar: Top 10 Cidades
- Pie: por Segmento, por Área de Atuação
- Bar: por Fornecedor

**`src/components/dashboard/tabs/CSTab.tsx`**
- Reuses existing `useCSDashboardData` hook
- Adapts reference CSTab layout (Operação, Risco & Retenção, Indicações sections)
- Adds evolution chart (tickets concluídos/mês)

### New Indicators (not in reference)

1. **Quick Ratio** = (New MRR + Expansion MRR) / (Churn MRR + Contraction MRR) — leading health metric
2. **ARPU Trend** — Average Revenue Per User sparkline on KPI card
3. **Revenue per Funcionário** — MRR / count of funcionários ativos
4. **Churn Cohort Age** — which "age bucket" (0-3m, 3-6m, 6-12m, 12m+) loses more clients
5. **Burn Multiple** (if CAC data available) — Net Burn / Net New ARR
6. **Magic Number** — Net New ARR / CAC spend previous period

---

### Files to Edit

#### `src/pages/Index.tsx`
- Replace blank page with full Dashboard component

#### `src/App.tsx`
- Add `/dashboard` route, change default redirect from `/clientes` to `/dashboard`

#### `src/components/AppSidebar.tsx`
- Add "Dashboard" as first nav item with `LayoutDashboard` icon, url `/dashboard`

---

### Implementation Order (Phase 1)

1. Create types + data hook + filters component
2. Create chart/card components (port from reference)
3. Create 6 tab components
4. Create Dashboard page, wire routing + sidebar
5. Test end-to-end

**Estimated files**: ~15 new files + 3 edited files + 1 migration

