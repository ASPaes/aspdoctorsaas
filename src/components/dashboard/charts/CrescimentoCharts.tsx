import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(v);

const fmtBRLShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
};

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
  color: 'hsl(var(--foreground))',
} as const;

// ═══════════════════════════════════════════════════════════
// MRR Forecast Chart
// ═══════════════════════════════════════════════════════════

interface MrrForecastChartProps {
  /** Série histórica de MRR — espera pelo menos 12 pontos com monthLabel + mrr */
  series: Array<{ dataCorte: string; mrr: number; monthLabel: string }>;
  /** Forecast vindo de useCrescimentoExtras */
  forecast: {
    points: Array<{ x: number; y: number; label: string }>;
    r2: number;
    confidence: 'alta' | 'média' | 'baixa';
  } | null;
  tvMode?: boolean;
  className?: string;
  height?: number;
}

/**
 * Combina série histórica de MRR (linha sólida) com projeção linear de 90 dias
 * (linha tracejada esmaecida). Mostra badge de confidence baseado em R².
 *
 * @example
 * <MrrForecastChart series={mrrSeries24m} forecast={mrrForecast} />
 */
export function MrrForecastChart({
  series,
  forecast,
  tvMode = false,
  className,
  height = 300,
}: MrrForecastChartProps) {
  const chartHeight = tvMode ? height * 1.5 : height;

  if (!series || series.length === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader>
          <CardTitle className={tvMode ? 'text-2xl' : 'text-base'}>
            Evolução MRR + Forecast 90d
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center text-muted-foreground"
            style={{ height: chartHeight }}
          >
            <p className="text-sm">Sem dados disponíveis</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Últimos 12 pontos da série para manter visual limpo
  const lastTwelve = series.slice(-12);

  type Row = {
    label: string;
    mrrHistorico?: number;
    mrrForecast?: number;
  };

  const chartData: Row[] = lastTwelve.map((p) => ({
    label: p.monthLabel,
    mrrHistorico: p.mrr,
  }));

  // Ponto-ponte: último real também é início do forecast (linha contínua visual)
  if (forecast && forecast.points.length > 0 && lastTwelve.length > 0) {
    const lastReal = lastTwelve[lastTwelve.length - 1];
    chartData[chartData.length - 1].mrrForecast = lastReal.mrr;
    forecast.points.forEach((p) => {
      chartData.push({ label: p.label, mrrForecast: p.y });
    });
  }

  const confidenceColor =
    forecast?.confidence === 'alta'
      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
      : forecast?.confidence === 'média'
        ? 'bg-warning/10 text-warning border-warning/30'
        : 'bg-muted text-muted-foreground border-border';

  const strokeWidth = tvMode ? 3 : 2;
  const fontSize = tvMode ? 14 : 12;

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className={tvMode ? 'text-2xl' : 'text-base'}>
              Evolução MRR + Forecast 90d
            </CardTitle>
            <p
              className={cn(
                'text-muted-foreground mt-1',
                tvMode ? 'text-sm' : 'text-xs',
              )}
            >
              Regressão linear sobre últimos 12 meses · projeção de 3 meses
            </p>
          </div>
          {forecast && (
            <div
              className={cn(
                'shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                confidenceColor,
              )}
            >
              <span>R² {forecast.r2.toFixed(2)}</span>
              <span className="opacity-60">·</span>
              <span>confidence {forecast.confidence}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(199 89% 48%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(199 89% 48%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.4}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize }}
              className="fill-muted-foreground"
            />
            <YAxis
              tick={{ fontSize }}
              tickFormatter={fmtBRLShort}
              className="fill-muted-foreground"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => {
                if (name === 'mrrHistorico') return [fmtBRL(value), 'Realizado'];
                if (name === 'mrrForecast') return [fmtBRL(value), 'Projeção'];
                return [fmtBRL(value), name];
              }}
              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
            />

            {/* Forecast — área tracejada esmaecida */}
            <Area
              type="monotone"
              dataKey="mrrForecast"
              stroke="hsl(199 89% 48%)"
              strokeWidth={strokeWidth}
              strokeDasharray="6 4"
              fill="url(#forecastFill)"
              isAnimationActive={false}
              connectNulls
            />

            {/* Histórico — linha sólida primary */}
            <Line
              type="monotone"
              dataKey="mrrHistorico"
              stroke="hsl(var(--primary))"
              strokeWidth={strokeWidth}
              dot={{ r: tvMode ? 4 : 3, fill: 'hsl(var(--primary))' }}
              activeDot={{ r: tvMode ? 6 : 5 }}
              isAnimationActive={false}
            />

            {/* Divisor vertical entre realizado e projeção */}
            {forecast && lastTwelve.length > 0 && (
              <ReferenceLine
                x={lastTwelve[lastTwelve.length - 1].monthLabel}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="2 4"
                opacity={0.5}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Growth Rate Bar Chart (MoM)
// ═══════════════════════════════════════════════════════════

interface GrowthRateBarChartProps {
  /** Série de MRR — calcula growth rate MoM internamente */
  series: Array<{ dataCorte: string; mrr: number; monthLabel: string }>;
  /** Meta visual (decimal, ex: 0.05 = 5%). Default 0.05 */
  goal?: number;
  tvMode?: boolean;
  className?: string;
  height?: number;
}

/**
 * Barras verticais de Growth Rate MoM ao longo dos últimos 12 meses.
 * Cor da barra reflete a zona do benchmark (verde ≥5%, amarelo 2-5%, vermelho <2%).
 * Inclui linha de meta tracejada.
 *
 * @example
 * <GrowthRateBarChart series={mrrSeries24m} goal={0.05} />
 */
export function GrowthRateBarChart({
  series,
  goal = 0.05,
  tvMode = false,
  className,
  height = 300,
}: GrowthRateBarChartProps) {
  const chartHeight = tvMode ? height * 1.5 : height;

  if (!series || series.length < 2) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader>
          <CardTitle className={tvMode ? 'text-2xl' : 'text-base'}>
            Growth Rate MoM (%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center text-muted-foreground"
            style={{ height: chartHeight }}
          >
            <p className="text-sm">Dados insuficientes</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calcula growth MoM dos últimos 12 meses (precisa do mês-1 do primeiro ponto)
  const lastThirteen = series.slice(-13);
  const chartData = lastThirteen.slice(1).map((p, i) => {
    const prev = lastThirteen[i].mrr;
    const cur = p.mrr;
    const growthRate = prev > 0 ? (cur - prev) / prev : 0;
    return {
      label: p.monthLabel,
      growthRate,
      growthPct: growthRate * 100,
    };
  });

  const barColor = (value: number): string => {
    if (value >= 0.05) return 'hsl(142 71% 45%)'; // green
    if (value >= 0.02) return 'hsl(38 92% 50%)'; // amber
    return 'hsl(0 84% 60%)'; // red
  };

  const fontSize = tvMode ? 14 : 12;
  const goalPct = goal * 100;

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader>
        <CardTitle className={tvMode ? 'text-2xl' : 'text-base'}>
          Growth Rate MoM (%)
        </CardTitle>
        <p
          className={cn(
            'text-muted-foreground mt-1',
            tvMode ? 'text-sm' : 'text-xs',
          )}
        >
          Consistência do crescimento mensal · últimos 12 meses · meta {(goal * 100).toFixed(0)}%
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.4}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize }}
              className="fill-muted-foreground"
            />
            <YAxis
              tick={{ fontSize }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              className="fill-muted-foreground"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
              formatter={(value: number) => [`${value.toFixed(2)}%`, 'Growth MoM']}
              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
            />
            <ReferenceLine
              y={goalPct}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{
                value: `meta ${goalPct.toFixed(0)}%`,
                position: 'right',
                fill: 'hsl(var(--muted-foreground))',
                fontSize,
              }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Bar
              dataKey="growthPct"
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            >
              {chartData.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={barColor(entry.growthRate)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
