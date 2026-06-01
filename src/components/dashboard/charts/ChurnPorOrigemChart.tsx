import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DollarSign, AlertTriangle } from 'lucide-react';
import type { CancelamentoOrigem } from '../hooks/useCancelamentosExtras';

interface ChurnPorOrigemChartProps {
  cancelamentosPorOrigem: CancelamentoOrigem[];
  tvMode?: boolean;
  className?: string;
}

type Zona = 'ok' | 'warn' | 'crit';

function getZona(churnRate: number): Zona {
  if (churnRate >= 5) return 'crit';
  if (churnRate >= 3) return 'warn';
  return 'ok';
}

interface ZonaConfigEntry {
  barClass: string;
  labelClass: string;
  bgRowClass: string;
  pillLabel: string;
}

const zonaConfig: Record<Zona, ZonaConfigEntry> = {
  crit: {
    barClass: 'bg-gradient-to-r from-red-600 to-red-500',
    labelClass: 'text-red-600 dark:text-red-400',
    bgRowClass: 'bg-red-500/[0.04] hover:bg-red-500/[0.08]',
    pillLabel: 'Crítico',
  },
  warn: {
    barClass: 'bg-gradient-to-r from-yellow-600 to-yellow-500',
    labelClass: 'text-yellow-600 dark:text-yellow-400',
    bgRowClass: 'hover:bg-yellow-500/[0.06]',
    pillLabel: 'Atenção',
  },
  ok: {
    barClass: 'bg-gradient-to-r from-emerald-600 to-emerald-500',
    labelClass: 'text-emerald-600 dark:text-emerald-400',
    bgRowClass: 'hover:bg-emerald-500/[0.06]',
    pillLabel: 'Saudável',
  },
};

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${v.toFixed(0)}`;
};

export function ChurnPorOrigemChart({
  cancelamentosPorOrigem,
  tvMode = false,
  className,
}: ChurnPorOrigemChartProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const rowSize = tvMode ? 'text-sm' : 'text-xs';
  const metaSize = tvMode ? 'text-xs' : 'text-[11px]';

  // Ordenar por MRR cancelado DESC (já vem assim da RPC, mas garantir)
  const origensOrdenadas = useMemo(
    () => [...cancelamentosPorOrigem].sort((a, b) => b.mrr_cancelado - a.mrr_cancelado),
    [cancelamentosPorOrigem],
  );

  // Contadores por zona
  const counts = useMemo(() => {
    return origensOrdenadas.reduce(
      (acc, o) => {
        const z = getZona(o.churn_rate);
        acc[z]++;
        return acc;
      },
      { crit: 0, warn: 0, ok: 0 } as Record<Zona, number>,
    );
  }, [origensOrdenadas]);

  // Total MRR perdido para mostrar % por origem
  const totalMrr = useMemo(
    () => origensOrdenadas.reduce((sum, o) => sum + o.mrr_cancelado, 0),
    [origensOrdenadas],
  );

  if (!origensOrdenadas || origensOrdenadas.length === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader className="pb-2">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Churn por origem de aquisição
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Cancelamentos atribuídos à origem do primeiro produto vendido
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem dados de origem para análise no período.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Escala da barra: max churn rate da lista (até 100%)
  const maxChurnRate = Math.max(...origensOrdenadas.map((o) => o.churn_rate), 1);

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4 w-full">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Churn por origem de aquisição
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Quem canalmente traz cliente que cancela mais — ordenado por MRR perdido
            </p>
          </div>
          <div className="text-right shrink-0">
            {counts.crit > 0 && (
              <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className={cn('font-semibold', metaSize)}>
                  {counts.crit} crítico{counts.crit > 1 ? 's' : ''}
                </span>
              </div>
            )}
            <div className={cn('text-muted-foreground', metaSize)}>
              {counts.ok} ok · {counts.warn} atenção · {counts.crit} crítico
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-1">
        {/* Cabeçalho da tabela */}
        <div
          className={cn(
            'grid gap-2 items-center text-muted-foreground uppercase tracking-wide px-2 py-1',
            metaSize,
          )}
          style={{
            gridTemplateColumns: '1.8fr 0.8fr 1.4fr 0.9fr',
          }}
        >
          <span>Origem</span>
          <span className="text-right">MRR / %</span>
          <span>Churn rate</span>
          <span className="text-right">%</span>
        </div>

        <div className="space-y-0.5">
          {origensOrdenadas.map((o, idx) => {
            const zona = getZona(o.churn_rate);
            const cfg = zonaConfig[zona];
            // Escala visual: usar maxChurnRate da lista como 100%
            const widthPct = maxChurnRate > 0 ? Math.min((o.churn_rate / maxChurnRate) * 100, 100) : 0;
            const widthSafe = Math.max(widthPct, 3);
            const pctMrrTotal = totalMrr > 0 ? (o.mrr_cancelado / totalMrr) * 100 : 0;

            return (
              <div
                key={`${o.origem}-${idx}`}
                className={cn(
                  'grid gap-2 items-center rounded-md px-2 py-1.5 transition-colors',
                  cfg.bgRowClass,
                )}
                style={{
                  gridTemplateColumns: '1.8fr 0.8fr 1.4fr 0.9fr',
                }}
              >
                {/* Nome da origem + qtd ativos/cancelados */}
                <div className="min-w-0">
                  <div className={cn('font-semibold text-foreground truncate', rowSize)}>
                    {o.origem}
                  </div>
                  <div className={cn('flex items-center gap-0.5 text-muted-foreground', metaSize)}>
                    <DollarSign className="h-3 w-3" />
                    {o.qtd_cancelamentos} canc · {o.qtd_ativos_inicio} ativos
                  </div>
                </div>

                {/* MRR cancelado + % do total */}
                <div className="text-right min-w-0">
                  <div className={cn('font-semibold tabular-nums text-foreground', rowSize)}>
                    {fmtShort(o.mrr_cancelado)}
                  </div>
                  <div className={cn('text-muted-foreground', metaSize)}>
                    {pctMrrTotal.toFixed(0)}% do total
                  </div>
                </div>

                {/* Barra de churn rate */}
                <div className="w-full">
                  <div className="bg-muted/40 rounded-md overflow-hidden h-2">
                    <div
                      className={cn('h-full rounded-md', cfg.barClass)}
                      style={{ width: `${widthSafe}%` }}
                    />
                  </div>
                  <div className={cn('text-muted-foreground mt-0.5', metaSize)}>
                    ticket {fmtShort(o.ticket_medio_cancelado)}
                  </div>
                </div>

                {/* Percentual + zona pill */}
                <div className="flex items-center justify-end gap-2 min-w-0">
                  <span className={cn('font-bold tabular-nums text-foreground shrink-0', rowSize)}>
                    {o.churn_rate.toFixed(2)}%
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0',
                      cfg.labelClass,
                      'bg-opacity-10',
                    )}
                  >
                    {cfg.pillLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legenda das zonas */}
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-muted-foreground border-t border-border/40', metaSize)}>
          <span className="font-medium text-foreground">Zonas (churn mensal):</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Saudável &lt; 3%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            Atenção 3-5%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Crítico &gt; 5%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
