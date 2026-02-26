import { TrendingDown, Users, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { PieChartCard } from '../charts/PieChartCard';
import type { KPIMetrics, TimeSeriesData, DistributionData } from '../types';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

interface Props { metrics: KPIMetrics; timeSeries: TimeSeriesData; distributions: DistributionData; tvMode: boolean; }

export function CancelamentosTab({ metrics, timeSeries, distributions, tvMode }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Cancelamentos (Qtde)" value={metrics.cancelamentosQtd.toString()} icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />} size={s} variant="destructive" formula="Total de clientes que cancelaram no período selecionado" />
        <KPICardEnhanced label="MRR Cancelado" value={fmt(metrics.mrrCancelado)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />} size={s} variant="destructive" formula="Soma das mensalidades dos clientes cancelados + reversões de movimentos" />
        <KPICardEnhanced label="Churn Rate (Carteira)" value={fmtPct(metrics.cancelamentosQtd / Math.max(metrics.clientesAtivos + metrics.cancelamentosQtd, 1))} icon={<TrendingDown className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />} size={s} variant="destructive" formula="Cancelamentos ÷ (Clientes Ativos + Cancelados). % de clientes perdidos" />
        <KPICardEnhanced label="Churn Rate (Receita)" value={fmtPct(metrics.mrrCancelado / Math.max(metrics.mrr + metrics.mrrCancelado, 1))} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />} size={s} variant="destructive" formula="MRR Cancelado ÷ (MRR Atual + MRR Cancelado). % de receita perdida" />
      </div>

      <div className="space-y-2">
        <h3 className={`font-semibold text-muted-foreground flex items-center gap-2 ${tvMode ? 'text-xl' : 'text-sm'}`}><AlertTriangle className={tvMode ? 'h-6 w-6' : 'h-4 w-4'} />Early Churn (≤90 dias após cadastro)</h3>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-3'}`}>
          <KPICardEnhanced label="Early Churn (Qtde)" value={metrics.cancelamentosEarly.toString()} icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-yellow-500`} />} size={s} variant="warning" formula="Clientes que cancelaram em até 90 dias após o cadastro" />
          <KPICardEnhanced label="Early Churn MRR" value={fmt(metrics.mrrCanceladoEarly)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-yellow-500`} />} size={s} variant="warning" formula="MRR perdido por cancelamentos precoces (≤90 dias)" />
          <KPICardEnhanced label="Early Churn Rate" value={fmtPct(metrics.earlyChurnRate)} icon={<TrendingDown className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-yellow-500`} />} size={s} variant="warning" subtitle="% dos novos que cancelam rápido" formula="Early Churn Qtde ÷ Novos Clientes no período" />
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <LineChartCard title="Evolução Qtde Churn (12 meses)" data={timeSeries.churnQtdEvolution} formatValue={v => v.toString()} tvMode={tvMode} color="hsl(var(--chart-3))" />
        <LineChartCard title="Evolução MRR Churn (12 meses)" data={timeSeries.churnMrrEvolution} formatValue={fmt} tvMode={tvMode} color="hsl(var(--chart-3))" />
      </div>

      <PieChartCard title="Cancelamentos por Motivo" data={distributions.porMotivoCancelamento} tvMode={tvMode} height={tvMode ? 450 : 350} />
    </div>
  );
}
