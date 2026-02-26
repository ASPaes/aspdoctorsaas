import { TrendingUp, Clock, DollarSign, Divide, Calculator, Users } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { NetNewMrrBreakdown } from '../cards/NetNewMrrBreakdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KPIMetrics, TimeSeriesData } from '../types';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

interface Props { metrics: KPIMetrics; timeSeries: TimeSeriesData; tvMode: boolean; }

export function CrescimentoTab({ metrics, timeSeries, tvMode }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const ranking = metrics.funcionariosRanking || [];

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Crescimento R$" value={fmt(metrics.crescimentoReais)} icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant={metrics.crescimentoReais >= 0 ? 'success' : 'destructive'} trend={metrics.crescimentoReais >= 0 ? 'up' : 'down'} trendValue="no período" formula="MRR fim - MRR início" />
        <KPICardEnhanced label="Crescimento %" value={fmtPct(metrics.crescimentoPercent)} size={s} variant={metrics.crescimentoPercent >= 0 ? 'success' : 'destructive'} formula="Crescimento R$ ÷ MRR início" />
        <KPICardEnhanced label="Net New MRR" value={fmt(metrics.netNewMrr)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant={metrics.netNewMrr >= 0 ? 'success' : 'destructive'} formula="New + Upsell + Cross-sell − Downsell − Churn" />
        <KPICardEnhanced label="Margem Contribuição Média" value={fmtPct(metrics.margemContribuicao)} icon={<Calculator className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" />
      </div>

      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="LTV (meses)" value={metrics.ltvMeses > 0 ? metrics.ltvMeses.toFixed(1) : 'N/A'} icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" />
        <KPICardEnhanced label="LTV (R$)" value={metrics.ltvReais > 0 ? fmt(metrics.ltvReais) : 'N/A'} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" formula="Ticket Médio × LTV meses" />
        <KPICardEnhanced label="CAC" value={metrics.cac > 0 ? fmt(metrics.cac) : 'N/A'} size={s} variant="dark" formula="Total despesas CAC ÷ Novos clientes" />
        <KPICardEnhanced label="LTV/CAC" value={metrics.ltvCac > 0 ? metrics.ltvCac.toFixed(2) + 'x' : 'N/A'} icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant={metrics.ltvCac >= 3 ? 'success' : metrics.ltvCac >= 1 ? 'warning' : 'destructive'} subtitle={metrics.ltvCac >= 3 ? 'Saudável (≥3x)' : metrics.ltvCac >= 1 ? 'Atenção (1-3x)' : 'Crítico (<1x)'} />
      </div>

      <NetNewMrrBreakdown newMrr={metrics.newMrr} upsellMrr={metrics.upsellMrr} crossSellMrr={metrics.crossSellMrr} downsellMrr={metrics.downsellMrr} mrrCancelado={metrics.mrrCancelado} netNewMrr={metrics.netNewMrr} tvMode={tvMode} />

      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
        <KPICardEnhanced label="CAC Payback (meses)" value={metrics.cacPayback > 0 && metrics.cacPayback < 100 ? metrics.cacPayback.toFixed(1) : 'N/A'} icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant={metrics.cacPayback > 0 && metrics.cacPayback <= 12 ? 'success' : 'warning'} formula="CAC ÷ Lucro Bruto mensal médio" />
        <Card>
          <CardHeader className="pb-2"><CardTitle className={`flex items-center gap-2 ${tvMode ? 'text-xl' : 'text-base'}`}><Users className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-primary`} />MRR por Funcionário</CardTitle></CardHeader>
          <CardContent>
            {ranking.length > 0 ? (
              <div className="space-y-2">
                {ranking.slice(0, 5).map((f, i) => (
                  <div key={f.nome} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-muted-foreground w-5">{i + 1}.</span>
                      <span className="text-sm">{f.nome}</span>
                      <span className="text-xs text-muted-foreground">({f.clientes} clientes)</span>
                    </div>
                    <span className="font-bold text-primary text-sm">{fmt(f.mrr)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-4 text-muted-foreground text-sm">Sem dados de funcionário</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <LineChartCard title="Evolução LTV (meses)" data={timeSeries.ltvMesesEvolution} formatValue={v => v.toFixed(1)} tvMode={tvMode} color="hsl(var(--chart-3))" />
        <LineChartCard title="Evolução LTV/CAC" data={timeSeries.ltvCacEvolution} formatValue={v => v.toFixed(2) + 'x'} tvMode={tvMode} color="hsl(var(--chart-5))" />
      </div>
    </div>
  );
}
