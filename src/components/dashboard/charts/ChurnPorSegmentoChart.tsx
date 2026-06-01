import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle } from 'lucide-react';
import type { ChurnSegmento } from '../hooks/useCancelamentosExtras';

interface ChurnPorSegmentoChartProps {
  churnPorSegmento: ChurnSegmento[];
  tvMode?: boolean;
  className?: string;
}

type Zona = 'ok' | 'warn' | 'crit';

function getZona(churnRate: number): Zona {
  if (churnRate >= 35) return 'crit';
  if (churnRate >= 25) return 'warn';
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

export function ChurnPorSegmentoChart({
  churnPorSegmento,
  tvMode = false,
  className,
}: ChurnPorSegmentoChartProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const rowSize = tvMode ? 'text-sm' : 'text-xs';
  const metaSize = tvMode ? 'text-xs' : 'text-[11px]';

  const segmentosOrdenados = useMemo(
    () => [...churnPorSegmento].sort((a, b) => b.churn_rate - a.churn_rate),
    [churnPorSegmento],
  );

  const counts = useMemo(() => {
    return segmentosOrdenados.reduce(
      (acc, s) => {
        const z = getZona(s.churn_rate);
        acc[z]++;
        return acc;
      },
      { crit: 0, warn: 0, ok: 0 } as Record<Zona, number>,
    );
  }, [segmentosOrdenados]);

  if (!segmentosOrdenados || segmentosOrdenados.length === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader className="pb-2">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Churn rate por segmento
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Ordenado por taxa de churn — incêndios no topo
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem dados de segmento para análise.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4 w-full">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Churn rate por segmento
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Ordenado por taxa de churn — incêndios no topo
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
            gridTemplateColumns: '1.8fr 0.7fr 1.4fr 0.9fr',
          }}
        >
          <span>Segmento</span>
          <span className="text-right">Logos</span>
          <span>Churn rate</span>
          <span className="text-right">%</span>
        </div>

        <div className="space-y-0.5">
          {segmentosOrdenados.map((s, idx) => {
            const zona = getZona(s.churn_rate);
            const cfg = zonaConfig[zona];
            const widthPct = Math.min((s.churn_rate / 60) * 100, 100);
            const widthSafe = Math.max(widthPct, 3);

            return (
              <div
                key={`${s.segmento}-${idx}`}
                className={cn(
                  'grid gap-2 items-center rounded-md px-2 py-1.5 transition-colors',
                  cfg.bgRowClass,
                )}
                style={{
                  gridTemplateColumns: '1.8fr 0.7fr 1.4fr 0.9fr',
                }}
              >
                {/* Nome do segmento */}
                <div className="min-w-0">
                  <div className={cn('font-semibold text-foreground truncate', rowSize)}>
                    {s.segmento}
                  </div>
                  <div className={cn('flex items-center gap-0.5 text-muted-foreground', metaSize)}>
                    <Clock className="h-3 w-3" />
                    tenure médio {s.tenure_canc}d
                  </div>
                </div>

                {/* Logos: cancelados / ativos */}
                <div className={cn('text-right tabular-nums text-foreground', rowSize)}>
                  <span className="font-semibold">{s.cancelados}</span>
                  <span className="text-muted-foreground"> / {s.ativos}</span>
                </div>

                {/* Barra de churn rate */}
                <div className="w-full bg-muted/40 rounded-md overflow-hidden h-2">
                  <div
                    className={cn('h-full rounded-md', cfg.barClass)}
                    style={{ width: `${widthSafe}%` }}
                  />
                </div>

                {/* Percentual + zona pill */}
                <div className="flex items-center justify-end gap-2 min-w-0">
                  <span className={cn('font-bold tabular-nums text-foreground shrink-0', rowSize)}>
                    {s.churn_rate.toFixed(1)}%
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
          <span className="font-medium text-foreground">Zonas:</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Saudável &lt; 25%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            Atenção 25-35%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Crítico &gt; 35%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
