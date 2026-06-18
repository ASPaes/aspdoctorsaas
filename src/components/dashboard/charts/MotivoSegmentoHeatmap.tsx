import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { HeatmapCell } from '../hooks/useCancelamentosExtras';

interface MotivoSegmentoHeatmapProps {
  heatmapMotivoSegmento: HeatmapCell[];
  tvMode?: boolean;
  className?: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${v.toFixed(0)}`;
};

function getHeatClass(mrr: number, maxMrr: number): { bg: string; text: string } {
  if (mrr === 0 || maxMrr === 0) {
    return { bg: 'bg-muted/30', text: 'text-muted-foreground/40' };
  }
  const ratio = mrr / maxMrr;
  if (ratio >= 0.75) return { bg: 'bg-red-600/80', text: 'text-white' };
  if (ratio >= 0.5) return { bg: 'bg-red-500/55', text: 'text-white' };
  if (ratio >= 0.25) return { bg: 'bg-red-400/35', text: 'text-foreground' };
  if (ratio >= 0.1) return { bg: 'bg-red-300/20', text: 'text-foreground' };
  return { bg: 'bg-red-200/10', text: 'text-muted-foreground' };
}

export function MotivoSegmentoHeatmap({
  heatmapMotivoSegmento,
  tvMode = false,
  className,
}: MotivoSegmentoHeatmapProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const cellSize = tvMode ? 'text-xs' : 'text-[11px]';
  const labelSize = tvMode ? 'text-[11px]' : 'text-[10px]';

  const { motivos, segmentos, matrix, maxMrr, totalMrr } = useMemo(() => {
    const motivosArr: string[] = [];
    const segmentosArr: string[] = [];
    const motSeen = new Set<string>();
    const segSeen = new Set<string>();
    const cells = new Map<string, { qtd: number; mrr: number }>();
    let max = 0;
    let total = 0;

    for (const cell of heatmapMotivoSegmento) {
      if (!motSeen.has(cell.motivo)) {
        motSeen.add(cell.motivo);
        motivosArr.push(cell.motivo);
      }
      if (!segSeen.has(cell.segmento)) {
        segSeen.add(cell.segmento);
        segmentosArr.push(cell.segmento);
      }
      cells.set(`${cell.motivo}|${cell.segmento}`, { qtd: cell.qtd, mrr: cell.mrr });
      if (cell.mrr > max) max = cell.mrr;
      total += cell.mrr;
    }

    return {
      motivos: motivosArr,
      segmentos: segmentosArr,
      matrix: cells,
      maxMrr: max,
      totalMrr: total,
    };
  }, [heatmapMotivoSegmento]);

  if (!heatmapMotivoSegmento || heatmapMotivoSegmento.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <h3 className={cn('font-semibold', headerSize)}>Heatmap motivo × segmento</h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Onde cada motivo concentra MRR perdido
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center text-sm text-muted-foreground">
            Sem dados suficientes para análise cruzada.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <h3 className={cn('font-semibold', headerSize)}>Heatmap motivo × segmento</h3>
          <p className={cn('text-muted-foreground', subtitleSize)}>
            Top {motivos.length} motivos × top {segmentos.length} segmentos · MRR perdido em R$
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card" />
                {segmentos.map((seg) => (
                  <th
                    key={seg}
                    className={cn(
                      'px-2 py-1 text-center font-medium text-muted-foreground',
                      labelSize,
                    )}
                    style={{ maxWidth: 80 }}
                  >
                    <div className="truncate" title={seg}>
                      {seg}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {motivos.map((mot) => (
                <tr key={mot}>
                  <td
                    className={cn(
                      'sticky left-0 z-10 bg-card pr-2 font-medium text-foreground',
                      labelSize,
                    )}
                    style={{ maxWidth: 180 }}
                  >
                    <div className="truncate" title={mot}>
                      {mot}
                    </div>
                  </td>
                  {segmentos.map((seg) => {
                    const data = matrix.get(`${mot}|${seg}`);
                    const mrr = data?.mrr ?? 0;
                    const qtd = data?.qtd ?? 0;
                    const heat = getHeatClass(mrr, maxMrr);
                    const isCrit = maxMrr > 0 && mrr / maxMrr >= 0.75;

                    return (
                      <td
                        key={seg}
                        className={cn(
                          'rounded-md px-2 py-2 text-center align-middle transition-colors',
                          heat.bg,
                          heat.text,
                          cellSize,
                          isCrit && 'ring-1 ring-red-600/60',
                        )}
                        title={
                          mrr > 0
                            ? `${mot} × ${seg}: ${fmtBRL(mrr)} · ${qtd} ${qtd === 1 ? 'logo' : 'logos'}`
                            : 'Sem dados'
                        }
                      >
                        {mrr > 0 ? (
                          <div className="flex flex-col items-center leading-tight">
                            <span className="font-semibold">{fmtShort(mrr)}</span>
                            <span className={cn('opacity-80', labelSize)}>
                              {qtd} {qtd === 1 ? 'logo' : 'logos'}
                            </span>
                          </div>
                        ) : (
                          <span className="opacity-50">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={cn('mt-4 flex flex-wrap items-center gap-3 text-muted-foreground', labelSize)}>
          <span className="font-medium">Intensidade:</span>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-200/10" />
            <span>&lt; 10%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-300/20" />
            <span>10-25%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-400/35" />
            <span>25-50%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-500/55" />
            <span>50-75%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-600/80" />
            <span>≥ 75%</span>
          </div>
          {totalMrr > 0 && (
            <span className="ml-auto font-medium text-foreground">
              Soma do recorte ({motivos.length}×{segmentos.length}): {fmtBRL(totalMrr)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
