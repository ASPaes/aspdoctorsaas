import { Users, DollarSign, TrendingUp, Target, BarChart3, Percent, ShieldCheck, AlertTriangle, Clock, RefreshCw, Zap } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { useCertA1Data } from '../hooks/useCertA1Data';
import type { KPIMetrics, TimeSeriesData } from '../types';

interface VisaoGeralTabProps {
  metrics: KPIMetrics;
  timeSeries: TimeSeriesData;
  tvMode: boolean;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtFull = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function VisaoGeralTab({ metrics, timeSeries, tvMode, periodoInicio, periodoFim }: VisaoGeralTabProps) {
  const s = tvMode ? 'tv' : 'lg';
  const { data: certA1, isLoading: certLoading, refetch: refetchCert } = useCertA1Data(periodoInicio || null, periodoFim || null);

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Faturamento Total (MRR)" value={fmt(metrics.faturamentoTotal)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" formula="Soma das mensalidades + movimentos de clientes ativos" />
        <KPICardEnhanced label="Clientes Ativos" value={metrics.clientesAtivos.toLocaleString('pt-BR')} icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" />
        <KPICardEnhanced label="Ticket Médio" value={fmtFull(metrics.ticketMedio)} icon={<Target className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" formula="MRR ÷ Clientes Ativos" />
        <KPICardEnhanced label="ARR" value={fmt(metrics.arr)} icon={<BarChart3 className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" formula="MRR × 12" />
      </div>

      {metrics.faturamentoPorUnidade.length > 0 && (
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-' + Math.min(metrics.faturamentoPorUnidade.length, 4)}`}>
          {metrics.faturamentoPorUnidade.map(u => (
            <KPICardEnhanced key={u.id} label={`MRR ${u.nome}`} value={fmt(u.mrr)} size={tvMode ? 'lg' : 'md'} variant="primary" subtitle={`${metrics.faturamentoTotal > 0 ? ((u.mrr / metrics.faturamentoTotal) * 100).toFixed(1) : 0}% do total`} />
          ))}
        </div>
      )}

      <div className={`grid gap-6 grid-cols-1 lg:grid-cols-2`}>
        <LineChartCard title="Evolução do MRR (12 meses)" data={timeSeries.mrrEvolution} formatValue={fmt} tvMode={tvMode} />
        <LineChartCard title="Evolução do Faturamento (12 meses)" data={timeSeries.faturamentoEvolution} formatValue={fmt} tvMode={tvMode} />
      </div>

      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="NRR" value={fmtPct(metrics.nrr)} size={tvMode ? 'lg' : 'md'} variant={metrics.nrr >= 1 ? 'success' : 'warning'} formula="(MRR início + expansão - contração - churn) ÷ MRR início" icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="GRR" value={fmtPct(metrics.grr)} size={tvMode ? 'lg' : 'md'} variant={metrics.grr >= 0.9 ? 'success' : 'warning'} formula="(MRR início - churn - downsell) ÷ MRR início" icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="Concentração Top 10" value={fmtPct(metrics.concentracaoTop10)} size={tvMode ? 'lg' : 'md'} variant={metrics.concentracaoTop10 > 0.5 ? 'warning' : 'default'} formula="MRR Top 10 ÷ MRR Total" icon={<BarChart3 className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="Quick Ratio" value={metrics.quickRatio === Infinity ? '∞' : metrics.quickRatio.toFixed(2)} size={tvMode ? 'lg' : 'md'} variant={metrics.quickRatio >= 4 ? 'success' : metrics.quickRatio >= 1 ? 'warning' : 'destructive'} formula="(New MRR + Expansion) ÷ (Churn + Contraction)" subtitle={metrics.quickRatio >= 4 ? 'Excelente (≥4)' : metrics.quickRatio >= 1 ? 'Atenção' : 'Crítico'} icon={<Zap className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Certificados A1</h3>
          <button onClick={() => refetchCert()} className="text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className={`${tvMode ? 'h-5 w-5' : 'h-4 w-4'} ${certLoading ? 'animate-spin' : ''}`} /></button>
        </div>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'}`}>
          <KPICardEnhanced label="Vendas no Período" value={certA1?.vendasQtd?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<ShieldCheck className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
          <KPICardEnhanced label="Faturamento A1" value={fmt(certA1?.faturamento || 0)} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<DollarSign className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
          <KPICardEnhanced label="Oportunidades (Janela)" value={certA1?.oportunidadesJanela?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="default" icon={<Target className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" />
          <KPICardEnhanced label="Vencendo em 30 dias" value={certA1?.oportunidadesVencendo?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="warning" icon={<Clock className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" />
          <KPICardEnhanced label="Vencidos até 20 dias" value={certA1?.oportunidadesVencidas?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant={certA1?.oportunidadesVencidas && certA1.oportunidadesVencidas > 0 ? 'destructive' : 'default'} icon={<AlertTriangle className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" />
        </div>
      </div>
    </div>
  );
}
