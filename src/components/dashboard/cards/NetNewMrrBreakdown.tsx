import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, UserMinus, UserPlus, ArrowRight, ShoppingCart } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface NetNewMrrBreakdownProps {
  newMrr: number;
  upsellMrr: number;
  crossSellMrr: number;
  downsellMrr: number;
  mrrCancelado: number;
  netNewMrr: number;
  tvMode?: boolean;
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

export function NetNewMrrBreakdown({ newMrr, upsellMrr, crossSellMrr, downsellMrr, mrrCancelado, netNewMrr, tvMode = false }: NetNewMrrBreakdownProps) {
  const items = [
    { label: 'New MRR', value: newMrr, icon: UserPlus, color: 'text-green-600', bgColor: 'bg-green-500/10', sign: '+', tooltip: 'MRR de novos clientes' },
    { label: 'Upsell', value: upsellMrr, icon: TrendingUp, color: 'text-blue-600', bgColor: 'bg-blue-500/10', sign: '+', tooltip: 'Aumento de MRR em clientes existentes' },
    { label: 'Cross-sell', value: crossSellMrr, icon: ShoppingCart, color: 'text-indigo-600', bgColor: 'bg-indigo-500/10', sign: '+', tooltip: 'MRR adicional por novo produto/serviço' },
    { label: 'Downsell', value: downsellMrr, icon: TrendingDown, color: 'text-orange-600', bgColor: 'bg-orange-500/10', sign: '-', tooltip: 'Redução de MRR' },
    { label: 'Churn', value: mrrCancelado, icon: UserMinus, color: 'text-red-600', bgColor: 'bg-red-500/10', sign: '-', tooltip: 'MRR perdido por cancelamentos' },
  ];

  return (
    <Card>
      <CardHeader className={tvMode ? 'pb-2' : ''}><CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Breakdown Net New MRR</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          <TooltipProvider>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {items.map(item => (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    <div className={cn('rounded-lg p-3 cursor-help transition-all hover:scale-[1.02]', item.bgColor)}>
                      <div className="flex items-center gap-2 mb-1">
                        <item.icon className={cn('h-4 w-4', item.color)} />
                        <span className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>{item.label}</span>
                      </div>
                      <p className={cn('font-bold', item.color, tvMode ? 'text-xl' : 'text-lg')}>{item.sign}{fmt(item.value)}</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent><p>{item.tooltip}</p></TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          <div className="flex items-center justify-center gap-2 py-3 border-t border-border flex-wrap">
            <span className={cn('text-muted-foreground', tvMode ? 'text-base' : 'text-sm')}>
              {fmt(newMrr)} + {fmt(upsellMrr)} + {fmt(crossSellMrr)} − {fmt(downsellMrr)} − {fmt(mrrCancelado)}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className={cn('font-bold', netNewMrr >= 0 ? 'text-green-600' : 'text-red-600', tvMode ? 'text-xl' : 'text-lg')}>
              {netNewMrr >= 0 ? '+' : ''}{fmt(netNewMrr)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
