import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { HelpCircle } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { format, subMonths, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CohortRow {
  cohort_month: string;
  age_months: number;
  cohort_size: number;
  retained: number;
  retention_percent: number;
  tenant_id: string;
}

interface CohortTabProps {
  tvMode?: boolean;
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
];

export function CohortTab({ tvMode = false }: CohortTabProps) {
  const [cohortRange, setCohortRange] = useState<string>('12');
  const [ageWindow, setAgeWindow] = useState<string>('12');

  const maxCohorts = Math.min(Number(cohortRange), 18);
  const maxAge = Math.min(Number(ageWindow), 12);

  const { data: rawData, isLoading } = useQuery<CohortRow[]>({
    queryKey: ['cohort-logos', maxCohorts, maxAge],
    queryFn: async () => {
      const cutoff = format(subMonths(new Date(), maxCohorts), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('vw_cohort_logos')
        .select('*')
        .gte('cohort_month', cutoff)
        .lte('age_months', maxAge)
        .order('cohort_month', { ascending: true })
        .order('age_months', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CohortRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Build heatmap matrix
  const { cohorts, ageColumns, matrix } = useMemo(() => {
    if (!rawData || rawData.length === 0) return { cohorts: [], ageColumns: [], matrix: new Map() };

    const cohortsSet = new Map<string, number>();
    const maxAgeFound = new Set<number>();
    const matrix = new Map<string, Map<number, number>>();

    for (const row of rawData) {
      const key = row.cohort_month;
      if (!cohortsSet.has(key)) cohortsSet.set(key, row.cohort_size);
      maxAgeFound.add(row.age_months);
      if (!matrix.has(key)) matrix.set(key, new Map());
      matrix.get(key)!.set(row.age_months, row.retention_percent);
    }

    const cohorts = Array.from(cohortsSet.entries()).map(([month, size]) => ({ month, size }));
    const ageColumns = Array.from(maxAgeFound).sort((a, b) => a - b);

    return { cohorts, ageColumns, matrix };
  }, [rawData]);

  // Retention curves for last 3 cohorts
  const curveData = useMemo(() => {
    if (cohorts.length === 0) return [];
    const last3 = cohorts.slice(-3);
    const allAges = ageColumns;
    return allAges.map(age => {
      const point: Record<string, number | string> = { age: `M${age}` };
      last3.forEach((c, i) => {
        const val = matrix.get(c.month)?.get(age);
        point[`cohort_${i}`] = val ?? 0;
      });
      return point;
    });
  }, [cohorts, ageColumns, matrix]);

  const last3Labels = cohorts.slice(-3).map(c => {
    try {
      return format(parseISO(c.month), 'MMM/yy', { locale: ptBR });
    } catch { return c.month; }
  });

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

  if (!rawData || rawData.length === 0) {
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

  return (
    <div className="space-y-4 mt-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Intervalo de coortes</label>
          <Select value={cohortRange} onValueChange={setCohortRange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
              <SelectItem value="18">Últimos 18 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Janela de meses</label>
          <Select value={ageWindow} onValueChange={setAgeWindow}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">M0 – M6</SelectItem>
              <SelectItem value="12">M0 – M12</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Heatmap Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>
            Retenção por Coorte (Logo Retention)
            <InfoTooltip text="Percentual de clientes que permanecem ativos em cada mês após a ativação, agrupados pelo mês de entrada (coorte)." />
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground border-b border-border/40 sticky left-0 bg-card z-10">Coorte</th>
                <th className="text-center p-2 font-medium text-muted-foreground border-b border-border/40">Clientes</th>
                {ageColumns.map(age => (
                  <th key={age} className="text-center p-2 font-medium text-muted-foreground border-b border-border/40 min-w-[52px]">
                    M{age}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(cohort => {
                const label = (() => {
                  try { return format(parseISO(cohort.month), 'MMM/yy', { locale: ptBR }); }
                  catch { return cohort.month; }
                })();
                return (
                  <tr key={cohort.month} className="border-b border-border/20">
                    <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-card z-10">{label}</td>
                    <td className="p-2 text-center font-semibold text-muted-foreground">{cohort.size}</td>
                    {ageColumns.map(age => {
                      const val = matrix.get(cohort.month)?.get(age);
                      return (
                        <td
                          key={age}
                          className={cn(
                            'p-2 text-center font-medium transition-colors',
                            val != null ? getRetentionColor(val) : 'text-muted-foreground/30'
                          )}
                        >
                          {val != null ? `${Number(val).toFixed(0)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Retention Curve Chart */}
      {cohorts.length >= 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>
              Curva de Retenção — Últimas 3 Coortes
              <InfoTooltip text="Comparação da curva de retenção (% de clientes ativos) das 3 coortes mais recentes ao longo dos meses." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: tvMode ? 420 : 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curveData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="age" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={v => `${v}%`}
                    tick={{ fontSize: tvMode ? 14 : 11 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 'var(--radius)',
                      fontSize: tvMode ? 16 : 12,
                    }}
                    formatter={(value: number, name: string) => {
                      const idx = Number(name.replace('cohort_', ''));
                      return [`${Number(value).toFixed(1)}%`, last3Labels[idx] || name];
                    }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const idx = Number(value.replace('cohort_', ''));
                      return last3Labels[idx] || value;
                    }}
                  />
                  {last3Labels.map((_, i) => (
                    <Line
                      key={i}
                      type="monotone"
                      dataKey={`cohort_${i}`}
                      stroke={CURVE_COLORS[i]}
                      strokeWidth={tvMode ? 3 : 2}
                      dot={{ fill: CURVE_COLORS[i], strokeWidth: 0, r: tvMode ? 5 : 3 }}
                      activeDot={{ r: tvMode ? 8 : 6 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
