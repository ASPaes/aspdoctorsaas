import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Clock, AlertCircle } from 'lucide-react';
import type { TopMotivo } from '../hooks/useCancelamentosExtras';

interface MotivosBreakdownChartProps {
  topMotivos: TopMotivo[];
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

// Mapeamento categoria → cores
const categoriaConfig: Record<
  TopMotivo['categoria'],
  { barClass: string; dotClass: string; label: string; labelClass: string }
> = {
  voluntary: {
    barClass: 'bg-gradient-to-r from-red-600 to-red-500',
    dotClass: 'bg-red-500',
    label: 'Voluntário',
    labelClass: 'text-red-600 dark:text-red-400',
  },
  involuntary: {
    barClass: 'bg-gradient-to-r from-orange-600 to-orange-500',
    dotClass: 'bg-orange-500',
    label: 'Involuntário',
    labelClass: 'text-orange-600 dark:text-orange-400',
  },
  mortality: {
    barClass: 'bg-gradient-to-r from-zinc-600 to-zinc-500',
    dotClass: 'bg-zinc-500',
    label: 'Mortalidade',
    labelClass: 'text-zinc-600 dark:text-zinc-400',
  },
  sem_classif: {
    barClass: 'bg-muted-foreground/40',
    dotClass: 'bg-muted-foreground/40',
    label: 'Sem classif.',
    labelClass: 'text-muted-foreground',
  },
};

export function MotivosBreakdownChart({
  topMotivos,
  tvMode = false,
  className,
}: MotivosBreakdownChartProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const labelSize = tvMode ? 'text-sm' : 'text-xs';
  const metaSize = tvMode ? 'text-xs' : 'text-[11px]';

  // Estado vazio
  if (!topMotivos || topMotivos.length === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader className="pb-2">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Top motivos por MRR perdido
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Ordenado por valor, não por quantidade
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem motivos de cancelamento no período.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxMrr = Math.max(...topMotivos.map((m) => m.mrr_perdido));
  const totalMrr = topMotivos.reduce((s, m) => s + m.mrr_perdido, 0);

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4 w-full">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Top motivos por MRR perdido
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Ordenado por valor — não por quantidade
            </p>
          </div>
          <div className="text-right">
            <div className={cn('text-muted-foreground uppercase tracking-wide', tvMode ? 'text-xs' : 'text-[10px]')}>
              Top {topMotivos.length} acumulam
            </div>
            <div className={cn('font-bold tabular-nums text-foreground', tvMode ? 'text-2xl' : 'text-lg')}>
              {fmt(totalMrr)}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {topMotivos.map((m, idx) => {
          const cfg = categoriaConfig[m.categoria];
          const widthPct = maxMrr > 0 ? Math.max((m.mrr_perdido / maxMrr) * 100, 2) : 0;
          const pctTotal = totalMrr > 0 ? (m.mrr_perdido / totalMrr) * 100 : 0;
          const hasEarlyChurn = m.qtd_early > 0;

          return (
            <div key={`${m.motivo}-${idx}`} className="space-y-1.5">
              {/* Linha 1: nome + categoria pill + total à direita */}
              <div className="flex items-center justify-between gap-3">
                <div className={cn('flex items-center gap-2 min-w-0', labelSize)}>
                  <span className="font-semibold text-foreground truncate">
                    {m.motivo}
                  </span>
                  <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0', cfg.labelClass, 'bg-opacity-10')}>
                    <span className={cn('inline-block h-1.5 w-1.5 rounded-full mr-1', cfg.dotClass)} />
                    {cfg.label}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className={cn('font-bold tabular-nums text-foreground', labelSize)}>
                    {fmtShort(m.mrr_perdido)}
                  </span>
                  <span className={cn('tabular-nums text-muted-foreground ml-1', metaSize)}>
                    ({pctTotal.toFixed(0)}%)
                  </span>
                </div>
              </div>

              {/* Barra horizontal */}
              <div className="w-full bg-muted/40 rounded-md overflow-hidden h-2.5">
                <div
                  className={cn('h-full rounded-md', cfg.barClass)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              {/* Linha 3: meta info (qtd, tenure, early) */}
              <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground', metaSize)}>
                <span className="tabular-nums">
                  {m.qtd} {m.qtd === 1 ? 'logo' : 'logos'}
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  tenure médio {m.tenure_medio_dias}d
                </span>
                {hasEarlyChurn && (
                  <span className="flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                    <AlertCircle className="h-3 w-3" />
                    {m.qtd_early} early churn (≤90d)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
