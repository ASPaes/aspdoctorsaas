import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface KPICardEnhancedProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: ReactNode;
  variant?: 'default' | 'dark' | 'primary' | 'success' | 'warning' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'tv';
  className?: string;
  formula?: string;
  subtitle?: string;
}

export function KPICardEnhanced({
  label, value, trend, trendValue, icon, variant = 'dark',
  size = 'md', className, formula, subtitle,
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

  return (
    <div className={cn('rounded-xl transition-all duration-200 hover:scale-[1.01]', variantStyles[variant], sizeStyles[size], className)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn('font-medium uppercase tracking-wider text-muted-foreground', labelSizes[size])}>{label}</span>
          {formula && (
            <Tooltip>
              <TooltipTrigger><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs"><p className="text-xs font-mono">{formula}</p></TooltipContent>
            </Tooltip>
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
