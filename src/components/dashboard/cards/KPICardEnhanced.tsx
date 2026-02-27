import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { KpiHelpPopover } from '../KpiHelpPopover';

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
}

export function KPICardEnhanced({
  label, value, trend, trendValue, icon, variant = 'dark',
  size = 'md', className, formula, helpKey, subtitle,
}: KPICardEnhancedProps) {
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

  // Show help popover if helpKey or formula is provided
  const showHelp = helpKey || formula;

  return (
    <div className={cn('rounded-xl transition-all duration-200 hover:scale-[1.01]', variantStyles[variant], sizeStyles[size], className)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn('font-medium uppercase tracking-wider text-muted-foreground', labelSizes[size])}>{label}</span>
          {showHelp && (
            <KpiHelpPopover kpiKey={helpKey} formula={!helpKey ? formula : undefined} />
          )}
        </div>
        {icon && <div className={cn('p-2 rounded-lg', variant === 'dark' ? 'bg-primary/10' : 'bg-accent')}>{icon}</div>}
      </div>
      <div className="space-y-1">
        <p className={cn('font-bold', valueSizes[size], variant === 'dark' ? 'text-primary' : 'text-foreground')}>{value}</p>
        {subtitle && <p className={cn('text-muted-foreground', labelSizes[size])}>{subtitle}</p>}
        {trend && trendValue && (
          <div className={cn('flex items-center gap-1', trendColor, labelSizes[size])}>
            <TrendIcon className={size === 'tv' ? 'h-5 w-5' : 'h-4 w-4'} />
            <span>{trendValue}</span>
          </div>
        )}
      </div>
    </div>
  );
}
