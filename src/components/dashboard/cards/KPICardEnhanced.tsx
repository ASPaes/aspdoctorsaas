import { ReactNode, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { KpiHelpPopover } from '../KpiHelpPopover';
import { useTilt3D } from '@/hooks/useTilt3D';
import kpiHelp from '@/lib/kpiHelp';
import type { BenchmarkZone, KpiUnit } from '@/lib/kpiHelp';
import './kpi-card.css';

interface KPICardEnhancedProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: ReactNode;
  variant?: 'default' | 'dark' | 'primary' | 'success' | 'warning' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'tv';
  className?: string;
  /** @deprecated Use helpKey instead. Kept for backwards compat — shown in popover as formula. */
  formula?: string;
  /** Key from kpiHelp dictionary for rich contextual help */
  helpKey?: string;
  subtitle?: string;
  /** Spatial UI: tilt 3D no hover (default true) */
  enableTilt?: boolean;
  /** Renderiza barra de benchmark quando helpKey + currentValue presentes (default true) */
  showBenchmark?: boolean;
  /** Valor numérico raw (não formatado) — usado para posicionar marker na range bar */
  currentValue?: number;
  /** Conteúdo opcional no rodapé do card (ex: botão "Ver chats"). */
  footer?: ReactNode;
  /** Torna o card inteiro clicável (drill-down). Cliques no help/em botões internos não disparam. */
  onClick?: () => void;
  /** Texto do aria-label quando clicável. Default: "Ver detalhes de {label}". */
  onClickLabel?: string;
}

export function KPICardEnhanced({
  label, value, trend, trendValue, icon, variant = 'dark',
  size = 'md', className, formula, helpKey, subtitle,
  enableTilt = true, showBenchmark = true, currentValue, footer,
  onClick, onClickLabel,
}: KPICardEnhancedProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useTilt3D(cardRef, { enabled: enableTilt !== false });

  /** O label é um botão (popover de ajuda) e o footer pode ter links — o clique
   *  deles não pode virar drill-down. */
  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if ((e.target as HTMLElement).closest('button, a, [role="button"], input, select')) return;
    onClick();
  };

  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onClick();
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-green-600 dark:text-green-400' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground';

  const variantStyles = {
    default: 'bg-card border border-border',
    dark: 'bg-card border border-border shadow-sm',
    primary: 'bg-primary/10 border border-primary/20',
    success: 'bg-green-500/10 border border-green-500/20 dark:bg-green-900/20',
    warning: 'bg-warning/10 border border-warning/20',
    destructive: 'bg-red-500/10 border border-red-500/20 dark:bg-red-900/20',
  };

  const sizeStyles = { sm: 'p-3', md: 'p-4', lg: 'p-6', tv: 'p-8' };
  const valueSizes = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl', tv: 'text-5xl' };
  const labelSizes = { sm: 'text-xs', md: 'text-xs', lg: 'text-sm', tv: 'text-lg' };

  const showHelp = helpKey || formula;

  const helpEntry = helpKey ? kpiHelp[helpKey] : undefined;
  const benchmark = helpEntry?.benchmark;
  const shouldShowBenchmark =
    showBenchmark !== false && !!benchmark && currentValue !== undefined && Number.isFinite(currentValue);

  const markerPos = shouldShowBenchmark && benchmark && currentValue !== undefined
    ? computeMarkerPosition(currentValue, benchmark)
    : 50;

  return (
    <div
      ref={cardRef}
      onClick={onClick ? handleCardClick : undefined}
      onKeyDown={onClick ? handleCardKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? (onClickLabel ?? `Ver detalhes de ${label}`) : undefined}
      className={cn(
        'rounded-xl transition-all duration-200',
        'kpi-spatial',
        `kpi-spatial-${variant}`,
        variantStyles[variant],
        sizeStyles[size],
        onClick &&
          'cursor-pointer hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {showHelp ? (
            <KpiHelpPopover
              kpiKey={helpKey}
              formula={!helpKey ? formula : undefined}
              wrapLabel={label}
              labelSize={size}
            />
          ) : (
            <span className={cn('font-medium uppercase tracking-wider text-muted-foreground', labelSizes[size])}>{label}</span>
          )}
        </div>
        {icon && <div className={cn('p-2 rounded-lg', variant === 'dark' ? 'bg-primary/10' : 'bg-accent')}>{icon}</div>}
      </div>
      <div className="space-y-1">
        <p className={cn('font-bold', valueSizes[size], variant === 'dark' ? 'text-primary' : 'text-foreground')}>{value}</p>

        {shouldShowBenchmark && benchmark && (
          <div className="kpi-range">
            <div className="kpi-range-bar">
              {benchmark.map((zone, i) => {
                const total = benchmark.length;
                const fillWidth = `${100 / total}%`;
                const fillLeft = `${(100 / total) * i}%`;
                return (
                  <div
                    key={i}
                    className={cn('kpi-range-fill', `kpi-range-fill-${zone.status}`)}
                    style={{ left: fillLeft, width: fillWidth }}
                  />
                );
              })}
              <div className="kpi-range-marker" style={{ left: `${markerPos}%` }} />
            </div>
            <div className="kpi-range-labels">
              {benchmark.map((zone, i) => (
                <span key={i}>{zone.display}</span>
              ))}
            </div>
            {(() => {
              const zone = findCurrentZone(currentValue!, benchmark);
              if (!zone) return null;
              return (
                <div className={cn('kpi-zone-pill', `kpi-zone-pill-${zone.status}`)}>
                  <span className="kpi-pulse-dot" />
                  {zoneLabelText(zone.status)}
                  {(() => {
                    const meta = formatMeta(benchmark, helpEntry?.unit);
                    return meta ? ` · ${meta}` : null;
                  })()}
                </div>
              );
            })()}
          </div>
        )}

        {subtitle && <p className={cn('text-muted-foreground', labelSizes[size])}>{subtitle}</p>}
        {trend && trendValue && (
          <div className={cn('flex items-center gap-1', trendColor, labelSizes[size])}>
            <TrendIcon className={size === 'tv' ? 'h-5 w-5' : 'h-4 w-4'} />
            <span>{trendValue}</span>
          </div>
        )}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

/**
 * Calcula a posição em % do marker na range bar.
 * Considera o benchmark como zonas equidistantes na barra visual.
 */
function computeMarkerPosition(value: number, benchmark: BenchmarkZone[]): number {
  const segmentWidth = 100 / benchmark.length;
  for (let i = 0; i < benchmark.length; i++) {
    const zone = benchmark[i];
    const min = zone.range_min;
    const max = zone.range_max;
    if (min !== undefined && max !== undefined) {
      if (value >= min && value < max) {
        const localPct = (value - min) / (max - min);
        return Math.max(0, Math.min(100, i * segmentWidth + localPct * segmentWidth));
      }
    } else if (max !== undefined && value < max) {
      const localPct = max > 0 ? value / max : 0;
      return Math.max(0, Math.min(100, i * segmentWidth + localPct * segmentWidth));
    } else if (min !== undefined && value >= min) {
      return Math.max(0, Math.min(100, (i + 0.9) * segmentWidth));
    }
  }
  return 50;
}

/**
 * Retorna a zona do benchmark em que o valor cai.
 */
function findCurrentZone(value: number, benchmark: BenchmarkZone[]): BenchmarkZone | null {
  for (const zone of benchmark) {
    const aboveMin = zone.range_min === undefined || value >= zone.range_min;
    const belowMax = zone.range_max === undefined || value < zone.range_max;
    if (aboveMin && belowMax) return zone;
  }
  return null;
}

/**
 * Formata um número + unit conforme convenção do kpiHelp.
 */
function formatUnitValue(value: number, unit?: KpiUnit): string {
  if (unit === 'meses') return `${value}m`;
  if (unit === 'x') return `${value}x`;
  if (unit === '%') return `${(value * 100).toFixed(0)}%`;
  if (unit === 'R$') return `R$ ${value.toLocaleString('pt-BR')}`;
  if (unit === 'pp') return `${value}pp`;
  if (unit === 'pts') return `${value}`;
  return `${value}`;
}

/**
 * Retorna a string da meta a partir da zona OK do benchmark.
 * Ex: "meta ≥ 40" (range_min) ou "meta ≤ 12m" (range_max) ou "meta 12–18m" (ambos).
 */
function formatMeta(benchmark: BenchmarkZone[], unit?: KpiUnit): string {
  const okZone = benchmark.find((z) => z.status === 'ok');
  if (!okZone) return '';
  if (okZone.range_min !== undefined && okZone.range_max === undefined) {
    return `meta ≥ ${formatUnitValue(okZone.range_min, unit)}`;
  }
  if (okZone.range_max !== undefined && okZone.range_min === undefined) {
    return `meta ≤ ${formatUnitValue(okZone.range_max, unit)}`;
  }
  if (okZone.range_min !== undefined && okZone.range_max !== undefined) {
    return `meta ${formatUnitValue(okZone.range_min, unit)}–${formatUnitValue(okZone.range_max, unit)}`;
  }
  return '';
}

function zoneLabelText(status: 'ok' | 'warn' | 'crit'): string {
  if (status === 'ok') return 'OK';
  if (status === 'warn') return 'Atenção';
  return 'Crítico';
}
