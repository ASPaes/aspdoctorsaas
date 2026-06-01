import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

interface NetNewMrrStackedChartProps {
  newMrr: number;
  upsellMrr: number;
  crossSellMrr: number;
  reativacaoMrr: number;
  reajusteMrr: number;
  downsellMrr: number;
  mrrCancelado: number;
  netNewMrr: number;
  historico?: {
    atual: number;
    media3m: number | null;
    media6m: number | null;
    media12m: number | null;
  };
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

type DeltaClass = 'above' | 'below' | 'neutral' | 'na';

function classifyDelta(atual: number, media: number | null): DeltaClass {
  if (media === null) return 'na';
  const delta = atual - media;
  if (delta === 0) return 'neutral';
  if (media === 0) return delta > 0 ? 'above' : 'below';
  const rel = Math.abs(delta / media);
  if (rel < 0.05) return 'neutral';
  return delta > 0 ? 'above' : 'below';
}

function buildStoryline(
  atual: number,
  m3: number | null, m6: number | null, m12: number | null,
): string {
  const medias = [m3, m6, m12].filter((v): v is number => v !== null);
  if (medias.length < 2) return '';

  const piorTodas = medias.every((m) => atual < m);
  const melhorTodas = medias.every((m) => atual > m);

  if (piorTodas) {
    if (m12 !== null && m12 > 0 && atual < 0) {
      return '12 meses atrás o Net New médio era positivo — hoje é negativo. Deterioração consistente.';
    }
    return 'Atual abaixo de todas as médias históricas — trajetória descendente.';
  }
  if (melhorTodas) {
    if (m12 !== null && m12 < 0 && atual > 0) {
      return '12 meses atrás o Net New médio era negativo — hoje é positivo. Recuperação consistente.';
    }
    return 'Atual supera todas as médias históricas — trajetória ascendente.';
  }
  return '';
}

interface HistoricoPillProps {
  label: string;
  media: number | null;
  atual: number;
  windowMonths: number;
  tvMode: boolean;
}

function HistoricoPill({ label, media, atual, windowMonths, tvMode }: HistoricoPillProps) {
  const klass = classifyDelta(atual, media);

  const borderClass =
    klass === 'above' ? 'border-green-500/30 bg-green-500/[0.06]' :
    klass === 'below' ? 'border-red-500/30 bg-red-500/[0.06]' :
    klass === 'neutral' ? 'border-border bg-muted/30' :
    'border-border bg-muted/10';

  const valueClass =
    klass === 'na' ? 'text-muted-foreground' :
    media !== null && media >= 0 ? 'text-green-600 dark:text-green-400' :
    'text-orange-600 dark:text-orange-400';

  const deltaLabel = (() => {
    if (media === null) return `aguardando ${windowMonths}m`;
    const delta = atual - media;
    if (klass === 'neutral') return 'em linha com média';
    const abs = Math.abs(delta);
    if (klass === 'above') return `${fmtShort(abs)} acima`;
    return `${fmtShort(abs)} abaixo`;
  })();

  const Icon = klass === 'above' ? TrendingUp : klass === 'below' ? TrendingDown : Minus;
  const iconClass =
    klass === 'above' ? 'text-green-600 dark:text-green-400' :
    klass === 'below' ? 'text-red-600 dark:text-red-400' :
    'text-muted-foreground';

  return (
    <div className={cn('rounded-lg border px-3 py-2.5', borderClass)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-muted-foreground uppercase tracking-wide', tvMode ? 'text-xs' : 'text-[10px]')}>
          {label}
        </span>
        <div className={cn('flex items-center gap-1', tvMode ? 'text-xs' : 'text-[10px]')}>
          <Icon className={cn('h-3 w-3', iconClass)} />
          <span className="text-muted-foreground">{deltaLabel}</span>
        </div>
      </div>
      <div className={cn('mt-1 font-bold tabular-nums', valueClass, tvMode ? 'text-xl' : 'text-base')}>
        {media !== null ? (media >= 0 ? '+' : '') + fmt(media) : '—'}
      </div>
    </div>
  );
}

interface Segment { name: string; value: number; color: string; textColor: string; }

function StackedRow({
  segments,
  total,
  escalaMax,
  sign,
  barHeightClass,
  tvMode,
}: {
  segments: Segment[];
  total: number;
  escalaMax: number;
  sign: '+' | '−';
  barHeightClass: string;
  tvMode: boolean;
}) {
  const totalWidthPct = escalaMax > 0 ? (total / escalaMax) * 100 : 0;
  return (
    <>
      <div className={cn('relative w-full overflow-hidden rounded-md bg-muted/40', barHeightClass)}>
        <div className="absolute inset-y-0 left-0 flex" style={{ width: `${totalWidthPct}%` }}>
          {segments.map((seg) => {
            if (seg.value <= 0) return null;
            const segWidth = total > 0 ? (seg.value / total) * 100 : 0;
            const absWidth = (seg.value / escalaMax) * 100;
            const showLabel = absWidth >= 12;
            return (
              <div
                key={seg.name}
                className={cn('flex items-center justify-center px-2 font-medium tabular-nums', seg.color, seg.textColor)}
                style={{ width: `${segWidth}%` }}
              >
                {showLabel && (
                  <span className={cn('whitespace-nowrap', tvMode ? 'text-sm' : 'text-xs')}>
                    {seg.name} {sign}{fmtShort(seg.value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={cn('mt-2 flex flex-wrap gap-x-3 gap-y-1', tvMode ? 'text-xs' : 'text-[11px]')}>
        {segments.map((seg) => {
          const absWidth = escalaMax > 0 ? (seg.value / escalaMax) * 100 : 0;
          if (seg.value > 0 && absWidth >= 12) return null;
          return (
            <span key={seg.name} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('inline-block h-2 w-2 rounded-sm', seg.value > 0 ? seg.color : 'bg-muted-foreground/30')} />
              {seg.name} {seg.value > 0 ? `${sign}${fmtShort(seg.value)}` : 'R$ 0'}
            </span>
          );
        })}
      </div>
    </>
  );
}

export function NetNewMrrStackedChart({
  newMrr, upsellMrr, crossSellMrr, reativacaoMrr, reajusteMrr,
  downsellMrr, mrrCancelado, netNewMrr,
  historico,
  tvMode = false, className,
}: NetNewMrrStackedChartProps) {

  const entradas: Segment[] = [
    { name: 'New', value: newMrr, color: 'bg-green-500', textColor: 'text-green-950' },
    { name: 'Upsell', value: upsellMrr, color: 'bg-green-600', textColor: 'text-green-950' },
    { name: 'Cross', value: crossSellMrr, color: 'bg-green-700', textColor: 'text-white' },
    { name: 'Reativ.', value: reativacaoMrr, color: 'bg-emerald-600', textColor: 'text-white' },
    { name: 'Reajuste', value: reajusteMrr, color: 'bg-blue-500', textColor: 'text-blue-950' },
  ];
  const saidas: Segment[] = [
    { name: 'Downsell', value: downsellMrr, color: 'bg-orange-500', textColor: 'text-orange-950' },
    { name: 'Churn', value: mrrCancelado, color: 'bg-red-500', textColor: 'text-red-950' },
  ];

  const totalEntradas = entradas.reduce((s, x) => s + x.value, 0);
  const totalSaidas = saidas.reduce((s, x) => s + x.value, 0);
  const escalaMax = Math.max(totalEntradas, totalSaidas, 1);

  const ratio = totalEntradas > 0 ? totalSaidas / totalEntradas : 0;
  const ratioMsg = totalEntradas === 0
    ? 'Sem entradas no período'
    : ratio >= 1
      ? `Saiu R$ ${ratio.toFixed(2)} para cada R$ 1 que entrou`
      : `Entrou R$ ${(1 / ratio).toFixed(2)} para cada R$ 1 que saiu`;

  const isNegative = netNewMrr < 0;
  const netNewBg = isNegative ? 'bg-red-500/15 border-red-500/30' : 'bg-green-500/15 border-green-500/30';
  const netNewText = isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

  const storyline = historico ? buildStoryline(
    historico.atual, historico.media3m, historico.media6m, historico.media12m,
  ) : '';

  const barHeight = tvMode ? 'h-10' : 'h-7';
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const valueSize = tvMode ? 'text-2xl' : 'text-lg';

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4 w-full">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Breakdown Net New MRR
            </h3>
            <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>
              Quanto entrou vs quanto saiu no período
            </p>
          </div>
          <div className="text-right">
            <div className={cn('text-muted-foreground uppercase tracking-wide', tvMode ? 'text-xs' : 'text-[10px]')}>
              Net New
            </div>
            <div className={cn('font-bold tabular-nums', valueSize, netNewText)}>
              {netNewMrr >= 0 ? '+' : ''}{fmt(netNewMrr)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ENTRADAS */}
        <div>
          <div className={cn('mb-1.5 flex items-center justify-between', tvMode ? 'text-sm' : 'text-xs')}>
            <span className="font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Entradas</span>
            <span className="font-bold text-green-600 dark:text-green-400 tabular-nums">+{fmt(totalEntradas)}</span>
          </div>
          <StackedRow segments={entradas} total={totalEntradas} escalaMax={escalaMax} sign="+" barHeightClass={barHeight} tvMode={tvMode} />
        </div>

        {/* SAÍDAS */}
        <div>
          <div className={cn('mb-1.5 flex items-center justify-between', tvMode ? 'text-sm' : 'text-xs')}>
            <span className="font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Saídas</span>
            <span className="font-bold text-red-600 dark:text-red-400 tabular-nums">−{fmt(totalSaidas)}</span>
          </div>
          <StackedRow segments={saidas} total={totalSaidas} escalaMax={escalaMax} sign="−" barHeightClass={barHeight} tvMode={tvMode} />
        </div>

        {/* BALANÇO */}
        <div className={cn('rounded-lg border px-4 py-3', netNewBg)}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('font-semibold text-foreground', tvMode ? 'text-base' : 'text-sm')}>Balanço do período</p>
              <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>{ratioMsg}</p>
            </div>
            <div className={cn('font-bold tabular-nums shrink-0', netNewText, tvMode ? 'text-2xl' : 'text-xl')}>
              {netNewMrr >= 0 ? '+' : ''}{fmt(netNewMrr)}
            </div>
          </div>
        </div>

        {/* MÉDIAS HISTÓRICAS */}
        {historico && (
          <div className="pt-2 border-t border-border/60">
            <div className={cn('mb-2 flex items-center justify-between', tvMode ? 'text-sm' : 'text-xs')}>
              <span className="font-semibold text-foreground uppercase tracking-wide">Net New histórico — média móvel</span>
              <span className="text-muted-foreground">
                vs atual {historico.atual >= 0 ? '+' : ''}{fmtShort(historico.atual)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <HistoricoPill label="Média 3m" media={historico.media3m} atual={historico.atual} windowMonths={3} tvMode={tvMode} />
              <HistoricoPill label="Média 6m" media={historico.media6m} atual={historico.atual} windowMonths={6} tvMode={tvMode} />
              <HistoricoPill label="Média 12m" media={historico.media12m} atual={historico.atual} windowMonths={12} tvMode={tvMode} />
            </div>
            {storyline && (
              <p className={cn('mt-2 flex items-start gap-1.5 text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>
                <Minus className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{storyline}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
