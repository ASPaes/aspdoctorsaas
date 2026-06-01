import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { RotateCcw, Calendar, AlertCircle, Lightbulb } from 'lucide-react';
import type { ReativacaoMes } from '../hooks/useCancelamentosExtras';

interface ReativacoesCardProps {
  reativacoesQtd: number;
  mrrReativado: number;
  winbackRate12m: number; // 0-1
  reativacoes12m: ReativacaoMes[];
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

// Formata "MM/AA" pra "Jan" (label curto)
const monthLabel = (mes: string): string => {
  // mes vem como "2025-06-01" ou "2025-06" — pegar mês
  const m = mes.slice(5, 7);
  const map: Record<string, string> = {
    '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
    '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
    '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
  };
  return map[m] ?? m;
};

export function ReativacoesCard({
  reativacoesQtd,
  mrrReativado,
  winbackRate12m,
  reativacoes12m,
  tvMode = false,
  className,
}: ReativacoesCardProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const kpiValueSize = tvMode ? 'text-2xl' : 'text-xl';
  const kpiLabelSize = tvMode ? 'text-[11px]' : 'text-[10px]';

  // Estatísticas dos 12m
  const total12m = reativacoes12m.reduce((s, r) => s + r.qtd, 0);
  const maxQtd = Math.max(1, ...reativacoes12m.map((r) => r.qtd));

  // Tempo médio fora (ponderado por qtd)
  const totalDias = reativacoes12m.reduce((s, r) => {
    if (r.qtd === 0 || r.tempo_medio_fora_dias == null) return s;
    return s + r.tempo_medio_fora_dias * r.qtd;
  }, 0);
  const tempoMedioFora = total12m > 0 ? Math.round(totalDias / total12m) : null;

  // ESTADO VAZIO — zero reativações em 12m (sinal forte de processo ausente)
  if (total12m === 0) {
    return (
      <Card className={cn('border-dashed border-yellow-600/30 bg-yellow-50/40 dark:bg-yellow-950/10', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-yellow-600" />
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Win-back & Reativação
            </h3>
          </div>
          <p className={cn('text-muted-foreground', subtitleSize)}>
            Recuperação de clientes cancelados
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-yellow-600/20 bg-yellow-50/60 p-3 dark:bg-yellow-950/20">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Sem reativações nos últimos 12 meses
              </p>
              <p className="text-xs text-muted-foreground">
                Não existe processo ativo de recuperação de clientes cancelados.
                Cada cliente que sai é dinheiro deixado na mesa.
              </p>
              <div className="flex items-start gap-2 pt-1">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />
                <p className="text-[11px] text-muted-foreground">
                  Onde começar: campanha de win-back para clientes
                  voluntary cancelados nos últimos 90-180 dias. Ticket médio recuperável é
                  o melhor preditor de ROI.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VERSÃO COMPLETA
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-emerald-600" />
          <h3 className={cn('font-semibold text-foreground', headerSize)}>
            Win-back & Reativação
          </h3>
        </div>
        <p className={cn('text-muted-foreground', subtitleSize)}>
          Recuperação de clientes cancelados
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* 3 KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className={cn('text-muted-foreground', kpiLabelSize)}>Reativações</p>
            <p className={cn('font-bold text-emerald-600', kpiValueSize)}>
              {reativacoesQtd}
            </p>
            <p className="text-[10px] text-muted-foreground">no período</p>
          </div>

          <div className="text-center">
            <p className={cn('text-muted-foreground', kpiLabelSize)}>MRR reativado</p>
            <p className={cn('font-bold text-emerald-600', kpiValueSize)}>
              {fmtShort(mrrReativado)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {mrrReativado > 0 ? fmt(mrrReativado) : '—'}
            </p>
          </div>

          <div className="text-center">
            <p className={cn('text-muted-foreground', kpiLabelSize)}>Win-back rate 12m</p>
            <p className={cn('font-bold text-emerald-600', kpiValueSize)}>
              {(winbackRate12m * 100).toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">dos cancelados retornaram</p>
          </div>
        </div>

        {/* Sparkline 12m */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1 text-xs font-medium text-foreground">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              Últimos 12 meses
            </p>
            <p className="text-[10px] text-muted-foreground">
              {total12m} {total12m === 1 ? 'reativação' : 'reativações'}
              {tempoMedioFora != null && (
                <> · tempo médio fora {tempoMedioFora}d</>
              )}
            </p>
          </div>

          {/* Bars */}
          <div className="flex h-20 items-end gap-[3px]">
            {reativacoes12m.map((r, idx) => {
              const heightPct = (r.qtd / maxQtd) * 100;
              const heightSafe = r.qtd > 0 ? Math.max(heightPct, 8) : 0;
              return (
                <div
                  key={idx}
                  className="flex flex-1 flex-col items-center justify-end gap-1"
                  title={`${monthLabel(r.mes)}: ${r.qtd} ${r.qtd === 1 ? 'reativação' : 'reativações'} · ${fmtShort(r.mrr)}${r.tempo_medio_fora_dias != null ? ` · fora há ~${Math.round(r.tempo_medio_fora_dias)}d` : ''}`}
                >
                  {r.qtd > 0 ? (
                    <div
                      className="w-full rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-400"
                      style={{ height: `${heightSafe}%` }}
                    />
                  ) : (
                    <div className="w-full border-t border-border" style={{ height: '1px' }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Eixo X: primeiro e último mês */}
          {reativacoes12m.length > 0 && (
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{monthLabel(reativacoes12m[0].mes)}</span>
              <span>{monthLabel(reativacoes12m[reativacoes12m.length - 1].mes)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
