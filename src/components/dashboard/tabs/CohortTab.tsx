import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KpiHelpPopover } from '../KpiHelpPopover';
import { format, subMonths, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useCohortRevenue } from '../hooks/useCohortRevenue';
import { useCohortRevenueDim } from '../hooks/useCohortRevenueDim';
import { useCohortForecast } from '../hooks/useCohortForecast';
import { ConselhoDSSection } from '../diagnostico/ConselhoDSSection';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

interface CohortTabProps {
  tvMode?: boolean;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
  fornecedorId?: number | null;
  unidadeBaseId?: number | null;
}


function getRetentionColor(percent: number | null): string {
  if (percent == null) return '';
  if (percent >= 90) return 'bg-emerald-600/90 text-white';
  if (percent >= 80) return 'bg-emerald-500/70 text-white';
  if (percent >= 70) return 'bg-emerald-400/50 text-foreground';
  if (percent >= 60) return 'bg-yellow-400/50 text-foreground';
  if (percent >= 50) return 'bg-orange-400/50 text-foreground';
  if (percent >= 30) return 'bg-orange-500/60 text-white';
  return 'bg-destructive/60 text-white';
}

const CURVE_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2, 160 60% 45%))',
  'hsl(var(--chart-3, 30 80% 55%))',
  'hsl(var(--chart-4, 280 65% 60%))',
  'hsl(var(--chart-5, 340 75% 55%))',
  'hsl(var(--accent))',
];

const BENCHMARK = 70;

function formatCohortLabel(month: string): string {
  try { return format(parseISO(`${month}-01`), 'MMM/yy', { locale: ptBR }); }
  catch { return month; }
}

export function CohortTab({ tvMode = false, fornecedorId, unidadeBaseId }: CohortTabProps) {
  const [ageWindow, setAgeWindow] = useState<string>('12');
  const [cohortRange, setCohortRange] = useState<string>('12');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [metricMode, setMetricMode] = useState<'logo' | 'revenue'>('logo');
  const [dim, setDim] = useState<'uf' | 'segmento' | 'canal' | 'faixa_ticket'>('uf');

  const fromMonth = format(subMonths(new Date(), Number(cohortRange)), 'yyyy-MM');
  const toMonth = format(new Date(), 'yyyy-MM');

  const maxAge = Number(ageWindow);

  const { isLoading, cohorts, ageColumns, matrix, revenueMatrix, retainedMatrix, curveData: _cd, curveLabels: defaultLabels, curveIsFallback } = useCohortRevenue({
    fromCohortMonth: fromMonth,
    toCohortMonth: toMonth,
    maxAgeMonths: maxAge,
    fornecedorId,
    unidadeBaseId,
  });

  const { rows: dimRows } = useCohortRevenueDim(dim, {
    fromCohortMonth: fromMonth,
    toCohortMonth: toMonth,
    maxAgeMonths: maxAge,
    fornecedorId,
    unidadeBaseId,
  });

  const { rows: forecastRows } = useCohortForecast({ fornecedorId, unidadeBaseId });

  const activeMatrix = metricMode === 'revenue' ? revenueMatrix : matrix;

  // Reset selected cohorts when filters change
  const [selectedCohorts, setSelectedCohorts] = useState<string[] | null>(null);
  useEffect(() => {
    setSelectedCohorts(null);
  }, [ageWindow, cohortRange]);
  const activeCohorts = selectedCohorts ?? defaultLabels;

  // ========== SUMMARY CARDS DATA ==========
  const summaryData = useMemo(() => {
    if (cohorts.length === 0) return null;

    // Average retention at milestones
    const milestones = [1, 3, 6, 12];
    const avgRetention: { age: number; avg: number }[] = [];
    for (const m of milestones) {
      const vals: number[] = [];
      cohorts.forEach(c => {
        const v = activeMatrix.get(c.month)?.get(m);
        if (v != null) vals.push(v);
      });
      if (vals.length > 0) {
        avgRetention.push({ age: m, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
      }
    }

    // Best cohort: highest retention at its most advanced age
    let best: { month: string; pct: number; age: number } | null = null;
    cohorts.forEach(c => {
      const ages = activeMatrix.get(c.month);
      if (!ages) return;
      let maxAge = 0;
      ages.forEach((_, a) => { if (a > maxAge) maxAge = a; });
      if (maxAge >= 1) {
        const pct = ages.get(maxAge) ?? 0;
        if (!best || pct > best.pct || (pct === best.pct && maxAge > best.age)) {
          best = { month: c.month, pct, age: maxAge };
        }
      }
    });

    // Worst cohort: lowest retention among cohorts with at least M3
    let worst: { month: string; pct: number; age: number; dropAge: number } | null = null;
    cohorts.forEach(c => {
      const ages = activeMatrix.get(c.month);
      if (!ages) return;
      let maxAge = 0;
      ages.forEach((_, a) => { if (a > maxAge) maxAge = a; });
      if (maxAge < 3) return;
      const pct = ages.get(maxAge) ?? 100;
      if (!worst || pct < worst.pct) {
        // Find biggest drop
        let biggestDrop = 0, dropAge = 1;
        for (let a = 1; a <= maxAge; a++) {
          const prev = ages.get(a - 1);
          const cur = ages.get(a);
          if (prev != null && cur != null) {
            const drop = prev - cur;
            if (drop > biggestDrop) { biggestDrop = drop; dropAge = a; }
          }
        }
        worst = { month: c.month, pct, age: maxAge, dropAge };
      }
    });

    return { avgRetention, best, worst };
  }, [cohorts, activeMatrix]);

  // ========== HEATMAP AVERAGES ==========
  const rowAverages = useMemo(() => {
    const avgs = new Map<string, number>();
    cohorts.forEach(c => {
      const ages = activeMatrix.get(c.month);
      if (!ages) return;
      const vals: number[] = [];
      ages.forEach(v => vals.push(v));
      if (vals.length > 0) avgs.set(c.month, vals.reduce((a, b) => a + b, 0) / vals.length);
    });
    return avgs;
  }, [cohorts, activeMatrix]);

  // ========== CURVE SIGNALS (derivados) ==========
  const curveSignals = useMemo(() => {
    const valid = cohorts.filter(c => c.size >= 10);
    if (valid.length === 0) return null;
    const avgByAge = new Map<number, number>();
    ageColumns.forEach(age => {
      const vals: number[] = [];
      valid.forEach(c => { const v = activeMatrix.get(c.month)?.get(age); if (v != null) vals.push(v); });
      if (vals.length > 0) avgByAge.set(age, vals.reduce((a, b) => a + b, 0) / vals.length);
    });
    const ages = [...avgByAge.keys()].sort((a, b) => a - b);
    if (ages.length === 0) return null;
    let halfLife: number | null = null;
    for (const age of ages) { if ((avgByAge.get(age) ?? 100) < 50) { halfLife = age; break; } }
    let stabAge: number | null = null;
    for (let i = 1; i < ages.length - 1; i++) {
      const d1 = avgByAge.get(ages[i - 1])! - avgByAge.get(ages[i])!;
      const d2 = avgByAge.get(ages[i])! - avgByAge.get(ages[i + 1])!;
      if (d1 < 1 && d2 < 1) { stabAge = ages[i]; break; }
    }
    let anchor: number | null = null;
    for (const m of [12, 6, 3]) {
      if (valid.filter(c => activeMatrix.get(c.month)?.get(m) != null).length >= 3) { anchor = m; break; }
    }
    let trend: { anchor: number; delta: number; dir: 'up' | 'down' | 'flat' } | null = null;
    if (anchor != null) {
      const withData = valid
        .filter(c => activeMatrix.get(c.month)?.get(anchor!) != null)
        .sort((a, b) => a.month.localeCompare(b.month));
      const half = Math.floor(withData.length / 2);
      const olds = withData.slice(0, half);
      const news = withData.slice(withData.length - half);
      const avg = (arr: typeof withData) => arr.reduce((s, c) => s + activeMatrix.get(c.month)!.get(anchor!)!, 0) / arr.length;
      const delta = avg(news) - avg(olds);
      trend = { anchor, delta, dir: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat' };
    }
    return { halfLife, stabAge, trend, maxAgeObserved: ages[ages.length - 1] };
  }, [cohorts, activeMatrix, ageColumns]);

  // ── Conselho DS ──
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin === true;

  const conselhoDiagInput = useMemo(() => {
    const avgAt = (mx: Map<string, Map<number, number>>, m: number) => {
      const vals: number[] = [];
      cohorts.forEach(c => { const v = mx.get(c.month)?.get(m); if (v != null) vals.push(v); });
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    };
    return {
      janela_meses: maxAge,
      periodo_safras_meses: Number(cohortRange),
      total_safras: cohorts.length,
      total_clientes_safras: cohorts.reduce((s, c) => s + c.size, 0),
      retencao_clientes: { M3: avgAt(matrix, 3), M6: avgAt(matrix, 6), M12: avgAt(matrix, 12) },
      retencao_receita: { M3: avgAt(revenueMatrix, 3), M6: avgAt(revenueMatrix, 6), M12: avgAt(revenueMatrix, 12) },
      sinais_curva: curveSignals,
      recorte: { dimensao: dim, grupos: dimRows.slice(0, 12) },
      projecao_saldo: forecastRows,
    };
  }, [cohorts, matrix, revenueMatrix, curveSignals, dim, dimRows, forecastRows, maxAge, cohortRange]);

  const conselhoAlertas = useMemo(() => {
    const out: { tipo: string; texto: string }[] = [];
    const rc6 = conselhoDiagInput.retencao_clientes.M6;
    const rr6 = conselhoDiagInput.retencao_receita.M6;
    if (rc6 != null && rr6 != null) {
      const gap = Math.round((rr6 - rc6) * 10) / 10;
      if (gap <= -2) out.push({ tipo: 'risco', texto: `No M6, receita retida (${rr6}%) está ${Math.abs(gap)}pp abaixo da retenção de clientes (${rc6}%) — saindo os clientes maiores.` });
      else if (gap >= 2) out.push({ tipo: 'ok', texto: `No M6, receita retida (${rr6}%) supera a de clientes (${rc6}%) em ${gap}pp — saem os menores, receita protegida.` });
    }
    if (curveSignals?.trend) {
      const t = curveSignals.trend;
      out.push({ tipo: t.dir === 'down' ? 'risco' : t.dir === 'up' ? 'ok' : 'info', texto: `Tendência safra-a-safra no M${t.anchor}: ${t.dir === 'up' ? 'melhorando' : t.dir === 'down' ? 'piorando' : 'estável'}${t.dir !== 'flat' ? ` (${t.delta > 0 ? '+' : ''}${t.delta.toFixed(1)}pp)` : ''}.` });
    }
    const f12 = forecastRows.find(r => r.horizonte_meses === 12);
    if (f12) { const net = f12.saldo_clientes - f12.base_clientes; out.push({ tipo: net >= 0 ? 'ok' : 'risco', texto: `Projeção 12m (ritmo do último ano): +${f12.ganho_clientes} entradas, -${f12.perda_clientes} saídas → saldo ${net >= 0 ? '+' : ''}${net} clientes e R$ ${Math.round(f12.saldo_mrr).toLocaleString('pt-BR')} de MRR.` }); }
    return out;
  }, [conselhoDiagInput, curveSignals, forecastRows]);

  // ========== CURVE DATA (dynamic cohorts) ==========
  const { dynamicCurveData, dynamicLabels } = useMemo(() => {
    if (activeCohorts.length === 0) return { dynamicCurveData: [], dynamicLabels: [] };

    const labels = activeCohorts.map(formatCohortLabel);

    let maxAgeWithData = 0;
    activeCohorts.forEach(cm => {
      const ages = activeMatrix.get(cm);
      if (ages) ages.forEach((_, age) => { if (age > maxAgeWithData) maxAgeWithData = age; });
    });
    // Respect the age window selection
    const effectiveMaxAge = Math.min(maxAgeWithData, maxAge);

    const curveAges = ageColumns.filter(a => a <= effectiveMaxAge);
    const data = curveAges.map(age => {
      const point: Record<string, any> = { age: `M${age}`, ageNum: age };
      activeCohorts.forEach((cm, i) => {
        const val = activeMatrix.get(cm)?.get(age);
        point[`cohort_${i}`] = val !== undefined ? val : null;
        // Also store retained and size for tooltip
        const ret = retainedMatrix.get(cm)?.get(age);
        const cohort = cohorts.find(c => c.month === cm);
        point[`retained_${i}`] = ret ?? null;
        point[`size_${i}`] = cohort?.size ?? null;
      });
      return point;
    });

    return { dynamicCurveData: data, dynamicLabels: labels };
  }, [activeCohorts, activeMatrix, retainedMatrix, ageColumns, cohorts, maxAge]);

  // Toggle cohort selection
  const toggleCohort = (month: string) => {
    const current = activeCohorts;
    if (current.includes(month)) {
      const next = current.filter(m => m !== month);
      setSelectedCohorts(next.length > 0 ? next : null);
    } else if (current.length < 6) {
      setSelectedCohorts([...current, month]);
    }
  };

  const removeCohort = (month: string) => {
    const next = activeCohorts.filter(m => m !== month);
    setSelectedCohorts(next.length > 0 ? next : null);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-48" />
        </div>
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (cohorts.length === 0) {
    return (
      <div className="mt-4">
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Ainda não há dados suficientes para análise de coorte.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cohortsAsc = [...cohorts].reverse();

  // Custom tooltip for the curve chart
  const CurveTooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload) return null;
    return (
      <div className="rounded-md border bg-card p-3 shadow-md text-xs space-y-1.5" style={{ color: 'hsl(var(--foreground))' }}>
        <p className="font-semibold text-sm">{label}</p>
        {payload.map((entry: any, i: number) => {
          if (entry.value == null) return null;
          const idx = Number(entry.dataKey.replace('cohort_', ''));
          const retained = entry.payload[`retained_${idx}`];
          const size = entry.payload[`size_${idx}`];
          const diff = Number(entry.value) - BENCHMARK;
          return (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: entry.stroke }} />
                <span className="font-medium">{dynamicLabels[idx]} — {label}</span>
              </div>
              <p>{metricMode === 'revenue' ? 'Retenção de receita' : 'Retenção'}: <strong>{Number(entry.value).toFixed(1)}%</strong></p>
              {retained != null && size != null && (
                <p>Clientes retidos: {retained}/{size}</p>
              )}
              <p className={cn('font-medium', diff >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                vs Benchmark: {diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Janela de meses</label>
          <Select value={ageWindow} onValueChange={setAgeWindow}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">M0 – M6</SelectItem>
              <SelectItem value="12">M0 – M12</SelectItem>
              <SelectItem value="24">M0 – M24</SelectItem>
              <SelectItem value="36">M0 – M36</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Período de coortes</label>
          <Select value={cohortRange} onValueChange={setCohortRange}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
              <SelectItem value="24">Últimos 24 meses</SelectItem>
              <SelectItem value="36">Últimos 36 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Métrica</label>
          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              type="button"
              onClick={() => setMetricMode('logo')}
              className={cn(
                'px-3 py-2 text-xs font-medium transition-colors',
                metricMode === 'logo' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
              )}
            >
              Clientes
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('revenue')}
              className={cn(
                'px-3 py-2 text-xs font-medium transition-colors border-l',
                metricMode === 'revenue' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
              )}
            >
              Receita
            </button>
          </div>
        </div>
      </div>

      {/* ==================== SUMMARY CARDS ==================== */}
      {summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1 — Retenção Média */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                Retenção Média
                <KpiHelpPopover kpiKey="cohort_retencao_media" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {summaryData.avgRetention.length > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {summaryData.avgRetention.map(r => (
                    <span key={r.age} className="text-sm font-semibold">
                      M{r.age}: <span className={cn(r.avg >= 70 ? 'text-emerald-600' : r.avg >= 50 ? 'text-yellow-600' : 'text-destructive')}>{r.avg.toFixed(1)}%</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sem dados suficientes</p>
              )}
            </CardContent>
          </Card>

          {/* Card 2 — Melhor Coorte */}
          <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                Melhor Coorte
                <KpiHelpPopover kpiKey="cohort_melhor" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {summaryData.best ? (
                <div className="space-y-1">
                  <p className="text-lg font-bold">{formatCohortLabel(summaryData.best.month)}</p>
                  <p className="text-sm text-muted-foreground">{summaryData.best.pct.toFixed(1)}% até M{summaryData.best.age}</p>
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-100 text-xs">✅ Melhor retenção do período</Badge>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sem dados</p>
              )}
            </CardContent>
          </Card>

          {/* Card 3 — Pior Coorte */}
          <Card className="bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200/50 dark:border-yellow-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                Pior Coorte
                <KpiHelpPopover kpiKey="cohort_pior" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {summaryData.worst ? (
                <div className="space-y-1">
                  <p className="text-lg font-bold">{formatCohortLabel(summaryData.worst.month)}</p>
                  <p className="text-sm text-muted-foreground">{summaryData.worst.pct.toFixed(1)}% em M{summaryData.worst.age} · Maior queda em M{summaryData.worst.dropAge}</p>
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 hover:bg-yellow-100 text-xs">⚠️ Investigar</Badge>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhuma coorte com ≥3 meses</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {curveSignals && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={cn('flex items-center gap-1.5', tvMode ? 'text-2xl' : 'text-lg')}>
              Sinais da curva · {metricMode === 'revenue' ? 'Receita' : 'Clientes'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Meia-vida</p>
                <p className="text-lg font-semibold">{curveSignals.halfLife != null ? `M${curveSignals.halfLife}` : `> ${curveSignals.maxAgeObserved}m`}</p>
                <p className="text-xs text-muted-foreground">{curveSignals.halfLife != null ? 'metade da base já saiu' : 'metade da base ainda ativa — retenção forte'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estabiliza em</p>
                <p className="text-lg font-semibold">{curveSignals.stabAge != null ? `M${curveSignals.stabAge}` : 'ainda caindo'}</p>
                <p className="text-xs text-muted-foreground">{curveSignals.stabAge != null ? 'queda < 1pp/mês a partir daqui' : 'não estabilizou na janela'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tendência {curveSignals.trend ? `(M${curveSignals.trend.anchor})` : ''}</p>
                {curveSignals.trend ? (
                  <>
                    <p className={cn('text-lg font-semibold', curveSignals.trend.dir === 'up' ? 'text-emerald-600' : curveSignals.trend.dir === 'down' ? 'text-destructive' : '')}>
                      {curveSignals.trend.dir === 'up' ? 'Melhorando' : curveSignals.trend.dir === 'down' ? 'Piorando' : 'Estável'}
                      {curveSignals.trend.dir !== 'flat' ? ` (${curveSignals.trend.delta > 0 ? '+' : ''}${curveSignals.trend.delta.toFixed(1)}pp)` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">safras recentes vs antigas</p>
                  </>
                ) : <p className="text-lg font-semibold">—</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ==================== HEATMAP TABLE ==================== */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className={cn('flex items-center gap-1.5', tvMode ? 'text-2xl' : 'text-lg')}>
            Retenção por Coorte · {metricMode === 'revenue' ? 'Receita' : 'Clientes'}
            <KpiHelpPopover kpiKey="retencao_cohort" />
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-xs border-collapse" style={{ minWidth: `${120 + 60 + ageColumns.length * 56 + 56}px` }}>
            <thead>
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground border-b border-border/40 sticky left-0 bg-card z-[2] min-w-[72px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">Coorte</th>
                <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Clientes</th>
                {ageColumns.map(age => (
                  <th key={age} className="text-center p-2 font-medium text-muted-foreground border-b border-border/40 min-w-[52px]">M{age}</th>
                ))}
                <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40 min-w-[52px]">Média</th>
              </tr>
            </thead>
            <tbody>
              {cohortsAsc.map(cohort => {
                const avg = rowAverages.get(cohort.month);
                return (
                  <tr
                    key={cohort.month}
                    className={cn(
                      'border-b border-border/20 transition-all',
                      hoveredRow === cohort.month && 'ring-1 ring-primary/40 bg-primary/5'
                    )}
                    onMouseEnter={() => setHoveredRow(cohort.month)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-card z-[2] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">{formatCohortLabel(cohort.month)}</td>
                    <td className="p-2 text-center font-semibold text-muted-foreground">{cohort.size}</td>
                    {ageColumns.map(age => {
                      const val = activeMatrix.get(cohort.month)?.get(age);
                      return (
                        <td key={age} className={cn('p-2 text-center font-medium transition-colors', val != null ? getRetentionColor(val) : 'text-muted-foreground/30')}>
                          {val != null ? `${Number(val).toFixed(0)}%` : '—'}
                        </td>
                      );
                    })}
                    <td className={cn('p-2 text-center font-semibold transition-colors', avg != null ? getRetentionColor(avg) : 'text-muted-foreground/30')}>
                      {avg != null ? `${avg.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ==================== RETENTION CURVE ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={cn('flex items-center gap-1.5', tvMode ? 'text-2xl' : 'text-lg')}>
            Curva de Retenção
            <KpiHelpPopover kpiKey="cohort_curva_retencao" />
          </CardTitle>
          {curveIsFallback && activeCohorts === defaultLabels && (
            <p className="text-xs text-muted-foreground mt-1">⚠ Não há 3 coortes com ≥3 meses e ≥10 clientes. Exibindo coortes recentes com ≥1 mês.</p>
          )}
        </CardHeader>
        <CardContent>
          {/* Cohort multiselect chips */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs font-medium text-muted-foreground">Coortes exibidas:</span>
            {activeCohorts.map(cm => (
              <Badge key={cm} variant="secondary" className="gap-1 pr-1">
                {formatCohortLabel(cm)}
                <button onClick={() => removeCohort(cm)} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {activeCohorts.length < 6 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-6 text-xs gap-1 px-2">
                    <Plus className="h-3 w-3" /> Adicionar
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2 max-h-60 overflow-y-auto" align="start">
                  <div className="space-y-1">
                    {cohorts.map(c => {
                      const checked = activeCohorts.includes(c.month);
                      const disabled = !checked && activeCohorts.length >= 6;
                      return (
                        <label key={c.month} className={cn('flex items-center gap-2 text-xs py-1 px-1 rounded cursor-pointer hover:bg-muted/50', disabled && 'opacity-40 cursor-not-allowed')}>
                          <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => !disabled && toggleCohort(c.month)} />
                          {formatCohortLabel(c.month)} <span className="text-muted-foreground ml-auto">({c.size})</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {dynamicCurveData.length > 0 ? (
            <div style={{ height: tvMode ? 420 : 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dynamicCurveData} margin={{ top: 5, right: 30, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="age" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <ReTooltip content={<CurveTooltipContent />} />
                  <Legend formatter={(value: string) => { const idx = Number(value.replace('cohort_', '')); return dynamicLabels[idx] || value; }} />
                  {/* Benchmark line */}
                  <ReferenceLine
                    y={BENCHMARK}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="6 4"
                    strokeWidth={1}
                    label={{ value: 'Benchmark SaaS B2B ~70%', position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  {activeCohorts.map((_, i) => (
                    <Line
                      key={i}
                      type="monotone"
                      dataKey={`cohort_${i}`}
                      stroke={CURVE_COLORS[i % CURVE_COLORS.length]}
                      strokeWidth={tvMode ? 3 : 2}
                      dot={{ fill: CURVE_COLORS[i % CURVE_COLORS.length], strokeWidth: 0, r: tvMode ? 5 : 3 }}
                      activeDot={{ r: tvMode ? 8 : 6 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Selecione ao menos uma coorte para exibir a curva.</p>
          )}
        </CardContent>
      </Card>

      {/* ==================== RETENÇÃO POR RECORTE ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={cn('flex items-center gap-1.5', tvMode ? 'text-2xl' : 'text-lg')}>
            Retenção por recorte
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Compara retenção de clientes vs retenção de receita por recorte. Receita abaixo de clientes = saindo os grandes.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Recorte</label>
            <Select value={dim} onValueChange={(v) => setDim(v as typeof dim)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="uf">Estado (UF)</SelectItem>
                <SelectItem value="segmento">Segmento</SelectItem>
                <SelectItem value="canal">Canal de aquisição</SelectItem>
                <SelectItem value="faixa_ticket">Faixa de ticket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {dimRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados suficientes para este recorte.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>
                    <th className="text-left p-2 font-medium text-muted-foreground border-b border-border/40">Grupo</th>
                    <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Clientes</th>
                    <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Logo M6</th>
                    <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Receita M6</th>
                    <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Logo M12</th>
                    <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Receita M12</th>
                  </tr>
                </thead>
                <tbody>
                  {dimRows.map(r => (
                    <tr key={r.grupo} className="border-b border-border/20">
                      <td className="p-2 font-medium">{r.grupo}</td>
                      <td className="p-2 text-center font-semibold text-muted-foreground">{r.base}</td>
                      <td className={cn('p-2 text-center font-medium', r.logoM6 != null ? getRetentionColor(r.logoM6) : 'text-muted-foreground/30')}>
                        {r.logoM6 != null ? `${r.logoM6.toFixed(0)}%` : '—'}
                      </td>
                      <td className={cn('p-2 text-center font-medium', r.revM6 != null ? getRetentionColor(r.revM6) : 'text-muted-foreground/30')}>
                        {r.revM6 != null ? `${r.revM6.toFixed(0)}%` : '—'}
                      </td>
                      <td className={cn('p-2 text-center font-medium', r.logoM12 != null ? getRetentionColor(r.logoM12) : 'text-muted-foreground/30')}>
                        {r.logoM12 != null ? `${r.logoM12.toFixed(0)}%` : '—'}
                      </td>
                      <td className={cn('p-2 text-center font-medium', r.revM12 != null ? getRetentionColor(r.revM12) : 'text-muted-foreground/30')}>
                        {r.revM12 != null ? `${r.revM12.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==================== PROJEÇÃO DE PERDA ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={cn('flex items-center gap-1.5', tvMode ? 'text-2xl' : 'text-lg')}>
            Projeção de perda
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Curva de sobrevivência das safras do período aplicada à base ativa de hoje. Acompanha os filtros de período e janela acima.
          </p>
        </CardHeader>
        <CardContent>
          {forecastRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados suficientes para projetar.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {forecastRows.map(row => {
                const pctClientes = 100 - row.retencao_clientes_esp_pct;
                const pctMrr = 100 - row.retencao_mrr_esp_pct;
                return (
                  <div key={row.horizonte_meses} className="rounded-lg border p-4 space-y-2">
                    <p className="font-semibold">Próximos {row.horizonte_meses} meses</p>
                    <div className="text-sm">
                      <span className="font-medium text-amber-600">~{Math.round(row.perda_clientes_esp)} clientes</span>
                      <span className="text-muted-foreground"> ({pctClientes.toFixed(0)}% da base)</span>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium text-amber-600">{'R$ ' + Math.round(row.perda_mrr_esp).toLocaleString('pt-BR')}</span>
                      <span className="text-muted-foreground"> ({pctMrr.toFixed(0)}% do MRR)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">em risco</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════ CONSELHO DOCTOR SAAS ═══════ */}
      {effectiveTenantId && (
        <ConselhoDSSection
          tenantId={effectiveTenantId}
          tabKey="cohort"
          diagInput={conselhoDiagInput}
          alertasFactuais={conselhoAlertas}
          filtrosAplicados={{ fornecedorId, unidadeBaseId, janelaMeses: maxAge, periodoSafrasMeses: Number(cohortRange) }}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
