import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface NetNewMrrWaterfallChartProps {
  newMrr: number;
  upsellMrr: number;
  crossSellMrr: number;
  reativacaoMrr: number;
  reajusteMrr: number;
  downsellMrr: number;
  mrrCancelado: number;
  netNewMrr: number;
  tvMode?: boolean;
  className?: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${v.toFixed(0)}`;
};

const COLORS = {
  positive: 'hsl(142 71% 45%)',
  negative: 'hsl(0 84% 60%)',
  result:   'hsl(199 89% 48%)',
  zero:     'hsl(var(--muted))',
};

type WaterfallType = 'positive' | 'negative' | 'result' | 'zero';

interface WaterfallPoint {
  name: string;
  delta: number;
  range: [number, number];
  type: WaterfallType;
}

function buildWaterfallData(
  newMrr: number,
  upsellMrr: number,
  crossSellMrr: number,
  reativacaoMrr: number,
  reajusteMrr: number,
  downsellMrr: number,
  mrrCancelado: number,
  netNewMrr: number,
): WaterfallPoint[] {
  let cum = 0;
  const points: WaterfallPoint[] = [];

  const additions: Array<[string, number]> = [
    ['New', newMrr],
    ['Upsell', upsellMrr],
    ['Cross', crossSellMrr],
    ['Reativ.', reativacaoMrr],
    ['Reajuste', reajusteMrr],
  ];

  for (const [name, value] of additions) {
    points.push({
      name,
      delta: value,
      range: [cum, cum + value],
      type: value === 0 ? 'zero' : 'positive',
    });
    cum += value;
  }

  points.push({
    name: 'Downsell',
    delta: -downsellMrr,
    range: [cum - downsellMrr, cum],
    type: downsellMrr === 0 ? 'zero' : 'negative',
  });
  cum -= downsellMrr;

  points.push({
    name: 'Churn',
    delta: -mrrCancelado,
    range: [cum - mrrCancelado, cum],
    type: mrrCancelado === 0 ? 'zero' : 'negative',
  });
  cum -= mrrCancelado;

  points.push({
    name: 'Net New',
    delta: netNewMrr,
    range: netNewMrr >= 0 ? [0, netNewMrr] : [netNewMrr, 0],
    type: 'result',
  });

  return points;
}

export function NetNewMrrWaterfallChart({
  newMrr, upsellMrr, crossSellMrr, reativacaoMrr, reajusteMrr,
  downsellMrr, mrrCancelado, netNewMrr,
  tvMode = false, className,
}: NetNewMrrWaterfallChartProps) {
  const data = buildWaterfallData(
    newMrr, upsellMrr, crossSellMrr, reativacaoMrr, reajusteMrr,
    downsellMrr, mrrCancelado, netNewMrr,
  );

  const chartHeight = tvMode ? 380 : 280;
  const fontSize = tvMode ? 14 : 11;

  const getColor = (type: WaterfallType) => {
    if (type === 'positive') return COLORS.positive;
    if (type === 'negative') return COLORS.negative;
    if (type === 'result') return COLORS.result;
    return COLORS.zero;
  };

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className={cn('font-semibold text-foreground', tvMode ? 'text-xl' : 'text-base')}>
              Net New MRR — Decomposição (waterfall)
            </h3>
            <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>
              Onde nasceram e onde morreram os R$ no período
            </p>
          </div>
          <div className="text-right">
            <div className={cn('text-muted-foreground uppercase tracking-wide', tvMode ? 'text-xs' : 'text-[10px]')}>
              Net New
            </div>
            <div className={cn(
              'font-bold tabular-nums',
              tvMode ? 'text-2xl' : 'text-lg',
              netNewMrr >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}>
              {netNewMrr >= 0 ? '+' : ''}{fmt(netNewMrr)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
            <YAxis tick={{ fontSize, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} tickFormatter={fmtShort} width={tvMode ? 80 : 60} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize,
              }}
              formatter={(_value: unknown, _name: unknown, item: any) => {
                const p = item?.payload as WaterfallPoint | undefined;
                if (!p) return ['—', 'Valor'];
                const sign = p.delta > 0 ? '+' : '';
                return [`${sign}${fmt(p.delta)}`, p.name];
              }}
            />
            <Bar dataKey="range" isAnimationActive={false} radius={[4, 4, 4, 4]}>
              {data.map((entry, idx) => (
                <Cell key={idx} fill={getColor(entry.type)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className={cn('mt-4 grid gap-2', tvMode ? 'grid-cols-8 text-sm' : 'grid-cols-4 md:grid-cols-8 text-xs')}>
          {data.map((p) => {
            const colorClass =
              p.type === 'positive' ? 'text-green-600 dark:text-green-400' :
              p.type === 'negative' ? 'text-red-600 dark:text-red-400' :
              p.type === 'result' ? (p.delta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') :
              'text-muted-foreground';
            const sign = p.delta > 0 ? '+' : '';
            return (
              <div key={p.name} className="rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{p.name}</div>
                <div className={cn('font-semibold tabular-nums', colorClass)}>
                  {sign}{fmtShort(p.delta)}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
