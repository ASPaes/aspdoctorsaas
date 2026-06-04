import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { RefreshCw, DollarSign } from 'lucide-react';
import { KpiHelpPopover } from '../KpiHelpPopover';
import { useTilt3D } from '@/hooks/useTilt3D';
import './kpi-card.css';

type CardSize = 'sm' | 'md' | 'lg' | 'tv';

const sizeStyles: Record<CardSize, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  tv: 'p-8',
};

const labelSizes: Record<CardSize, string> = {
  sm: 'text-xs',
  md: 'text-xs',
  lg: 'text-sm',
  tv: 'text-lg',
};

const valueSizes: Record<CardSize, string> = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-3xl',
  tv: 'text-5xl',
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

// ═══════════════════════════════════════════════════════════
// ARPA Combo Card
// ═══════════════════════════════════════════════════════════

interface ARPAComboCardProps {
  arpaNovo: number | null;
  arpaBase: number | null;
  ratio: number | null;
  size?: CardSize;
  enableTilt?: boolean;
  className?: string;
}

/**
 * Card combo que mostra ARPA Novo vs ARPA Base lado a lado + ratio em destaque.
 *
 * - ratio > 1: price realization positiva (verde)
 * - ratio = 1: neutro (cinza)
 * - ratio < 1: comoditização (laranja)
 */
export function ARPAComboCard({
  arpaNovo, arpaBase, ratio, size = 'md', enableTilt = true, className,
}: ARPAComboCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useTilt3D(cardRef, { enabled: enableTilt });

  const isPositive = ratio !== null && ratio > 1.05;
  const isNegative = ratio !== null && ratio < 0.95;
  const ratioColor = isPositive
    ? 'text-green-600 dark:text-green-400'
    : isNegative
      ? 'text-warning'
      : 'text-muted-foreground';
  const ratioLabel = isPositive
    ? 'price realization positiva'
    : isNegative
      ? 'comoditização — investigar'
      : 'neutro vs base';

  const spatialVariant = isPositive ? 'success' : 'dark';

  const variantStyles = {
    dark: 'bg-card border border-border shadow-sm',
    success: 'bg-green-500/10 border border-green-500/20 dark:bg-green-900/20',
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-xl transition-all duration-200',
        'kpi-spatial',
        `kpi-spatial-${spatialVariant}`,
        variantStyles[spatialVariant],
        sizeStyles[size],
        className,
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <KpiHelpPopover
            kpiKey="arpa_novo_vs_base"
            wrapLabel="ARPA: novo vs base"
            labelSize={size}
          />
        </div>
        <div className={cn('p-2 rounded-lg', spatialVariant === 'dark' ? 'bg-primary/10' : 'bg-green-500/20')}>
          <DollarSign className={cn('h-4 w-4', spatialVariant === 'dark' ? 'text-primary' : 'text-green-600 dark:text-green-400')} />
        </div>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <p className={cn('text-muted-foreground', labelSizes[size])}>Novos</p>
          <p className={cn('font-bold', valueSizes[size], 'text-foreground')}>
            {arpaNovo !== null ? fmtBRL(arpaNovo) : '—'}
          </p>
        </div>
        <div className="w-px h-10 bg-border" />
        <div className="flex-1">
          <p className={cn('text-muted-foreground', labelSizes[size])}>Base</p>
          <p className={cn('font-bold', valueSizes[size], 'text-foreground')}>
            {arpaBase !== null ? fmtBRL(arpaBase) : '—'}
          </p>
        </div>
      </div>

      <div className="space-y-0.5">
        <p className={cn('font-bold', valueSizes[size], ratioColor)}>
          {ratio !== null ? `${ratio.toFixed(2)}x` : '—'}
        </p>
        <p className={cn('text-muted-foreground', labelSizes[size])}>{ratioLabel}</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Reativações Card
// ═══════════════════════════════════════════════════════════

interface ReativacoesCardProps {
  qtdLogos: number;
  mrrRecuperado: number;
  size?: CardSize;
  enableTilt?: boolean;
  className?: string;
}

/**
 * Card de destaque para reativações no período.
 * Layout vertical (single-value) consistente com KPICardEnhanced:
 *  - Header: label + ícone
 *  - Valor principal: quantidade de logos
 *  - Subtitle: MRR recuperado
 *  - Pill condicional: "Alavanca ativa" quando qtd > 0
 *
 * Quando qtd = 0, card fica visualmente discreto (dark + cinza) — mostra
 * que não houve reativação sem ocupar destaque visual.
 */
export function ReativacoesCard({
  qtdLogos, mrrRecuperado, size = 'md', enableTilt = true, className,
}: ReativacoesCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useTilt3D(cardRef, { enabled: enableTilt });

  const hasReativacoes = qtdLogos > 0;
  const spatialVariant = hasReativacoes ? 'success' : 'dark';

  const variantStyles = {
    dark: 'bg-card border border-border shadow-sm',
    success: 'bg-green-500/10 border border-green-500/20 dark:bg-green-900/20',
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-xl transition-all duration-200',
        'kpi-spatial',
        `kpi-spatial-${spatialVariant}`,
        variantStyles[spatialVariant],
        sizeStyles[size],
        className,
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn('font-medium uppercase tracking-wider text-muted-foreground', labelSizes[size])}>
            Reativações
          </span>
          <KpiHelpPopover kpiKey="reativacoes_periodo" />
        </div>
        <div className={cn('p-2 rounded-lg', spatialVariant === 'dark' ? 'bg-primary/10' : 'bg-green-500/20')}>
          <RefreshCw className={cn('h-4 w-4', spatialVariant === 'dark' ? 'text-primary' : 'text-green-600 dark:text-green-400')} />
        </div>
      </div>

      <div className="space-y-1">
        <p className={cn(
          'font-bold',
          valueSizes[size],
          hasReativacoes ? 'text-green-600 dark:text-green-400' : 'text-foreground',
        )}>
          {qtdLogos}
        </p>
        <p className={cn('text-muted-foreground', labelSizes[size])}>
          {qtdLogos === 1 ? 'logo reativado' : 'logos reativados'}
        </p>
        <p className={cn(
          'font-mono',
          labelSizes[size],
          hasReativacoes ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground',
        )}>
          {mrrRecuperado > 0 ? `+${fmtBRL(mrrRecuperado)}` : fmtBRL(0)} recuperados
        </p>
        {hasReativacoes && (
          <div className={cn('kpi-zone-pill', 'kpi-zone-pill-ok', 'mt-1.5')}>
            <span className="kpi-pulse-dot" />
            Alavanca ativa
          </div>
        )}
      </div>
    </div>
  );
}
