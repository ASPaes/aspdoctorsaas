import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { TendenciaMotivo } from '../hooks/useCancelamentosExtras';

interface MotivosTendenciaChartProps {
  tendenciaMotivos: TendenciaMotivo[];
  tvMode?: boolean;
  className?: string;
}

export function MotivosTendenciaChart({
  tendenciaMotivos,
  tvMode = false,
  className,
}: MotivosTendenciaChartProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const rowSize = tvMode ? 'text-sm' : 'text-xs';
  const numSize = tvMode ? 'text-sm' : 'text-[11px]';

  // Estado vazio
  if (!tendenciaMotivos || tendenciaMotivos.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <h3 className={cn('font-semibold text-foreground', headerSize)}>
            Tendência dos motivos
          </h3>
          <p className={cn('text-muted-foreground', subtitleSize)}>
            Últimos 6 meses vs 6 meses anteriores
          </p>
        </CardHeader>
        <CardContent>
          <p className={cn('text-muted-foreground text-center py-8', subtitleSize)}>
            Sem histórico suficiente para análise de tendência.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Escala: maior delta absoluto define a metade da barra
  const maxAbsDelta = Math.max(...tendenciaMotivos.map((m) => Math.abs(m.delta)), 1);

  // Contagem de motivos críticos
  const motivosSubindo = tendenciaMotivos.filter((m) => m.delta > 0).length;
  const motivosCaindo = tendenciaMotivos.filter((m) => m.delta < 0).length;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Tendência dos motivos
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Últimos 6m vs 6m anteriores
            </p>
          </div>
          <div className={cn('flex items-center gap-3', subtitleSize)}>
            <span className="inline-flex items-center gap-1 text-red-500">
              <TrendingUp className="w-3.5 h-3.5" />
              {motivosSubindo} subindo
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <TrendingDown className="w-3.5 h-3.5" />
              {motivosCaindo} caindo
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Cabeçalho da tabela */}
        <div
          className={cn(
            'grid gap-3 items-center pb-2 mb-2 border-b border-border/40 text-muted-foreground font-medium',
            numSize,
          )}
          style={{ gridTemplateColumns: '1.6fr 0.5fr 0.5fr 2fr 0.7fr' }}
        >
          <span>Motivo</span>
          <span className="text-right">Ant 6m</span>
          <span className="text-right">Rec 6m</span>
          <span className="text-center">Variação</span>
          <span className="text-right">Δ</span>
        </div>

        {/* Linhas */}
        <div className="space-y-2">
          {tendenciaMotivos.map((m, idx) => {
            const absDelta = Math.abs(m.delta);
            const widthPct = (absDelta / maxAbsDelta) * 50; // 50% = metade da barra
            const isSubindo = m.delta > 0;
            const isCaindo = m.delta < 0;
            const isNeutro = m.delta === 0;

            // Highlight crítico para deltas grandes
            const isCriticoUp = m.delta >= 5;
            const isCriticoDown = m.delta <= -3;

            return (
              <div
                key={`${m.motivo}-${idx}`}
                className="grid gap-3 items-center py-1"
                style={{ gridTemplateColumns: '1.6fr 0.5fr 0.5fr 2fr 0.7fr' }}
              >
                {/* Nome */}
                <span className={cn('text-foreground truncate', rowSize)} title={m.motivo}>
                  {m.motivo}
                </span>

                {/* Ant 6m */}
                <span className={cn('text-right text-muted-foreground tabular-nums', numSize)}>
                  {m.qtd_anterior_6m}
                </span>

                {/* Rec 6m */}
                <span className={cn('text-right text-foreground tabular-nums', numSize)}>
                  {m.qtd_recente_6m}
                </span>

                {/* Barra divergente */}
                <div className="relative h-3 bg-muted/30 rounded-sm overflow-hidden">
                  {/* Linha zero no centro */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border z-10" />

                  {/* Fill positivo (vermelho à direita) */}
                  {isSubindo && (
                    <div
                      className={cn(
                        'absolute top-0 bottom-0 left-1/2 rounded-r-sm',
                        isCriticoUp
                          ? 'bg-gradient-to-r from-red-600 to-red-500'
                          : 'bg-red-500/60',
                      )}
                      style={{ width: `${widthPct}%` }}
                    />
                  )}
                  {/* Fill negativo (verde à esquerda) */}
                  {isCaindo && (
                    <div
                      className={cn(
                        'absolute top-0 bottom-0 rounded-l-sm',
                        isCriticoDown
                          ? 'bg-gradient-to-l from-emerald-600 to-emerald-500'
                          : 'bg-emerald-500/60',
                      )}
                      style={{ width: `${widthPct}%`, right: '50%' }}
                    />
                  )}
                </div>

                {/* Delta numérico */}
                <span
                  className={cn(
                    'inline-flex items-center justify-end gap-1 tabular-nums font-medium',
                    numSize,
                    isSubindo && 'text-red-500',
                    isCaindo && 'text-emerald-500',
                    isNeutro && 'text-muted-foreground',
                  )}
                >
                  {isSubindo && <TrendingUp className="w-3 h-3" />}
                  {isCaindo && <TrendingDown className="w-3 h-3" />}
                  {isNeutro && <Minus className="w-3 h-3" />}
                  {m.delta > 0 ? '+' : ''}
                  {m.delta}
                  {isCriticoUp && <span aria-hidden>⚠</span>}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
