import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { HelpCircle, Plus, X } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { format, subMonths, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useCohortLogos } from '../hooks/useCohortLogos';

interface CohortTabProps {
  tvMode?: boolean;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help inline ml-1" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{text}</p>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
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

export function CohortTab({ tvMode = false }: CohortTabProps) {
  const [ageWindow, setAgeWindow] = useState<string>('12');
  const [cohortRange, setCohortRange] = useState<string>('12');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const fromMonth = format(subMonths(new Date(), Number(cohortRange)), 'yyyy-MM');
  const toMonth = format(new Date(), 'yyyy-MM');

  const { isLoading, cohorts, ageColumns, matrix, retainedMatrix, curveData: _cd, curveLabels: defaultLabels, curveIsFallback } = useCohortLogos({
    fromCohortMonth: fromMonth,
    toCohortMonth: toMonth,
    maxAgeMonths: Number(ageWindow),
  });

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
        const v = matrix.get(c.month)?.get(m);
        if (v != null) vals.push(v);
      });
      if (vals.length > 0) {
        avgRetention.push({ age: m, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
      }
    }

    // Best cohort: highest retention at its most advanced age
    let best: { month: string; pct: number; age: number } | null = null;
    cohorts.forEach(c => {
      const ages = matrix.get(c.month);
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
      const ages = matrix.get(c.month);
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
  }, [cohorts, matrix]);

  // ========== HEATMAP AVERAGES ==========
  const rowAverages = useMemo(() => {
    const avgs = new Map<string, number>();
    cohorts.forEach(c => {
      const ages = matrix.get(c.month);
      if (!ages) return;
      const vals: number[] = [];
      ages.forEach(v => vals.push(v));
      if (vals.length > 0) avgs.set(c.month, vals.reduce((a, b) => a + b, 0) / vals.length);
    });
    return avgs;
  }, [cohorts, matrix]);

  // ========== CURVE DATA (dynamic cohorts) ==========
  const { dynamicCurveData, dynamicLabels } = useMemo(() => {
    if (activeCohorts.length === 0) return { dynamicCurveData: [], dynamicLabels: [] };

    const labels = activeCohorts.map(formatCohortLabel);

    let maxAgeWithData = 0;
    activeCohorts.forEach(cm => {
      const ages = matrix.get(cm);
      if (ages) ages.forEach((_, age) => { if (age > maxAgeWithData) maxAgeWithData = age; });
    });

    const curveAges = ageColumns.filter(a => a <= maxAgeWithData);
    const data = curveAges.map(age => {
      const point: Record<string, any> = { age: `M${age}`, ageNum: age };
      activeCohorts.forEach((cm, i) => {
        const val = matrix.get(cm)?.get(age);
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
  }, [activeCohorts, matrix, retainedMatrix, ageColumns, cohorts]);

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
              <p>Retenção: <strong>{Number(entry.value).toFixed(1)}%</strong></p>
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
      </div>

      {/* ==================== SUMMARY CARDS ==================== */}
      {summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1 — Retenção Média */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                Retenção Média
                <InfoTooltip text="Média de retenção de todas as coortes do período nos marcos M1, M3, M6 e M12." />
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
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                Melhor Coorte
                <InfoTooltip text="Coorte com maior retenção no seu marco mais avançado disponível." />
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
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                Pior Coorte
                <InfoTooltip text="Coorte com menor retenção entre as que possuem pelo menos M3 de dados, para evitar distorções com coortes recentes." />
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

      {/* ==================== HEATMAP TABLE ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>
            Retenção por Coorte (Logo Retention)
            <InfoTooltip text="Percentual de clientes que permanecem ativos em cada mês após a ativação, agrupados pelo mês de entrada (coorte)." />
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-xs border-collapse" style={{ minWidth: `${120 + 60 + ageColumns.length * 56 + 56}px` }}>
            <thead>
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground border-b border-border/40 sticky left-0 bg-card z-20 min-w-[72px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">Coorte</th>
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
                    <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-card z-20 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">{formatCohortLabel(cohort.month)}</td>
                    <td className="p-2 text-center font-semibold text-muted-foreground">{cohort.size}</td>
                    {ageColumns.map(age => {
                      const val = matrix.get(cohort.month)?.get(age);
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
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>
            Curva de Retenção
            <InfoTooltip text="Comparação da curva de retenção (% de clientes ativos) das coortes selecionadas ao longo dos meses. Linha pontilhada = benchmark SaaS B2B ~70%." />
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
    </div>
  );
}
