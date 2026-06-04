import { useRef } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  TrendingDown, TrendingUp, Minus,
  UserPlus, ShoppingCart, RefreshCw, Percent, UserMinus,
  type LucideIcon,
} from 'lucide-react';
import { useTilt3D } from '@/hooks/useTilt3D';
import '../cards/kpi-card.css';

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

// ═══════════════════════════════════════════════════════════
// BreakdownCard (Spatial)
// ═══════════════════════════════════════════════════════════

type Tone = 'green' | 'blue' | 'orange' | 'red';

interface BreakdownCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  sign: '+' | '−';
  tone: Tone;
  tvMode: boolean;
}

function BreakdownCard({ label, value, icon: Icon, sign, tone, tvMode }: BreakdownCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useTilt3D(ref, { enabled: true });

  const isZero = value === 0;

  const spatialVariant = isZero
    ? 'dark'
    : tone === 'green' ? 'success'
    : tone === 'blue' ? 'dark'
    : tone === 'orange' ? 'warning'
    : 'destructive';

  const containerClass = isZero
    ? 'bg-card border border-border'
    : tone === 'green' ? 'bg-green-500/10 border border-green-500/20 dark:bg-green-900/20'
    : tone === 'blue' ? 'bg-blue-500/10 border border-blue-500/20 dark:bg-blue-900/20'
    : tone === 'orange' ? 'bg-orange-500/10 border border-orange-500/20 dark:bg-orange-900/20'
    : 'bg-red-500/10 border border-red-500/20 dark:bg-red-900/20';

  const valueClass = isZero
    ? 'text-muted-foreground'
    : tone === 'green' ? 'text-green-600 dark:text-green-400'
    : tone === 'blue' ? 'text-blue-600 dark:text-blue-400'
    : tone === 'orange' ? 'text-orange-600 dark:text-orange-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl transition-all duration-200 kpi-spatial',
        `kpi-spatial-${spatialVariant}`,
        containerClass,
        tvMode ? 'p-4' : 'p-3',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('uppercase tracking-wider text-muted-foreground font-medium', tvMode ? 'text-xs' : 'text-[10px]')}>
          {label}
        </span>
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Icon className={cn('h-3.5 w-3.5', valueClass)} />
        </div>
      </div>
      <div className={cn('mt-2 font-bold tabular-nums', valueClass, tvMode ? 'text-xl' : 'text-lg')}>
        {isZero ? 'R$ 0' : `${sign}${fmt(value)}`}
      </div>
    </div>
  );
}

export function NetNewMrrStackedChart({
  newMrr, upsellMrr, crossSellMrr, reativacaoMrr, reajusteMrr,
  downsellMrr, mrrCancelado, netNewMrr,
  historico,
  tvMode = false, className,
}: NetNewMrrStackedChartProps) {

  const totalEntradas = newMrr + upsellMrr + crossSellMrr + reativacaoMrr + reajusteMrr;
  const totalSaidas = downsellMrr + mrrCancelado;

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

  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const valueSize = tvMode ? 'text-2xl' : 'text-lg';
  const sectionLabel = tvMode ? 'text-sm' : 'text-xs';

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
          <div className={cn('mb-2 flex items-center justify-between', sectionLabel)}>
            <span className="font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Entradas</span>
            <span className="font-bold text-green-600 dark:text-green-400 tabular-nums">+{fmt(totalEntradas)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <BreakdownCard label="New" value={newMrr} icon={UserPlus} sign="+" tone="green" tvMode={tvMode} />
            <BreakdownCard label="Upsell" value={upsellMrr} icon={TrendingUp} sign="+" tone="green" tvMode={tvMode} />
            <BreakdownCard label="Cross" value={crossSellMrr} icon={ShoppingCart} sign="+" tone="green" tvMode={tvMode} />
            <BreakdownCard label="Reativ." value={reativacaoMrr} icon={RefreshCw} sign="+" tone="green" tvMode={tvMode} />
            <BreakdownCard label="Reajuste" value={reajusteMrr} icon={Percent} sign="+" tone="blue" tvMode={tvMode} />
          </div>
        </div>

        {/* SAÍDAS */}
        <div>
          <div className={cn('mb-2 flex items-center justify-between', sectionLabel)}>
            <span className="font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Saídas</span>
            <span className="font-bold text-red-600 dark:text-red-400 tabular-nums">−{fmt(totalSaidas)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <BreakdownCard label="Downsell" value={downsellMrr} icon={TrendingDown} sign="−" tone="orange" tvMode={tvMode} />
            <BreakdownCard label="Churn" value={mrrCancelado} icon={UserMinus} sign="−" tone="red" tvMode={tvMode} />
          </div>
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
