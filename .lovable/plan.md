

## Problem
Chart tooltips across all dashboards are unreadable in dark mode. The `contentStyle` sets `backgroundColor` to `hsl(var(--card))` (dark) but does not set text `color`, so the browser defaults to black text on a dark background.

## Fix
Add `color: 'hsl(var(--foreground))'` to every Recharts `<Tooltip contentStyle={{...}}>` across all chart components.

## Files to edit (6 files, ~10 occurrences)

1. **`src/components/dashboard/charts/LineChartCard.tsx`** — add `color` to tooltip contentStyle
2. **`src/components/dashboard/charts/BarChartCard.tsx`** — add `color` to tooltip contentStyle
3. **`src/components/dashboard/charts/PieChartCard.tsx`** — add `color` to tooltip contentStyle
4. **`src/components/dashboard/tabs/CSTab.tsx`** — add `color` to all 5 tooltip contentStyles
5. **`src/components/certificados/CertA1Dashboard.tsx`** — add `color` to tooltip contentStyle (and remove redundant `labelStyle`)
6. **`src/components/dashboard/tabs/CohortTab.tsx`** — check and fix if applicable

