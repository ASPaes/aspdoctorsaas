import { useMemo } from 'react';
import { Users, DollarSign, TrendingUp, Target, BarChart3, Percent, ShieldCheck, AlertTriangle, Clock, RefreshCw, Zap, UserX } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { MultiLineChartCard } from '../charts/MultiLineChartCard';
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

function computeDelta(current: number, previous: number | null): { trend: 'up' | 'down' | 'neutral'; trendValue: string } | null {
  if (previous === null || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (pct === 0) return { trend: 'neutral', trendValue: '0% vs mês anterior' };
  const sign = pct > 0 ? '+' : '';
  return {
    trend: pct > 0 ? 'up' : 'down',
    trendValue: `${sign}${pct.toFixed(1)}% vs mês anterior`,
  };
}

export function VisaoGeralTab({ metrics, timeSeries, tvMode, periodoInicio, periodoFim }: VisaoGeralTabProps) {
  const s = tvMode ? 'tv' : 'lg';
  const { data: certA1, isLoading: certLoading, refetch: refetchCert } = useCertA1Data(periodoInicio || null, periodoFim || null);

  // Compute deltas from timeSeries (last vs second-to-last month)
  const deltas = useMemo(() => {
    const evo = timeSeries.mrrEvolution;
    if (evo.length < 2) return { mrr: null, clientes: null, ticket: null, arr: null };
    const prev = evo[evo.length - 2] as any;
    const prevMrr = prev.value as number;
    const prevClientes = prev.clientesAtivos as number | undefined;
    const prevTicket = prev.ticketMedio as number | undefined;
    return {
      mrr: computeDelta(metrics.mrr, prevMrr),
      clientes: prevClientes ? computeDelta(metrics.clientesAtivos, prevClientes) : null,
      ticket: prevTicket ? computeDelta(metrics.ticketMedio, prevTicket) : null,
      arr: computeDelta(metrics.arr, prevMrr * 12),
    };
  }, [timeSeries.mrrEvolution, metrics.mrr, metrics.clientesAtivos, metrics.ticketMedio, metrics.arr]);

  // Build MRR chart lines from per-unit data
  const { mrrLines, mrrChartData } = useMemo(() => {
    const units = metrics.faturamentoPorUnidade;
    const lines = [
      { dataKey: 'value', label: 'MRR Total', color: 'hsl(var(--primary))' },
    ];
    units.forEach((u, i) => {
      const colors = ['hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
      lines.push({
        dataKey: `mrr_${u.id}`,
        label: `MRR ${u.nome}`,
        color: colors[i % colors.length],
        strokeDasharray: '5 3',
      } as any);
    });
    return { mrrLines: lines, mrrChartData: timeSeries.mrrEvolution };
  }, [timeSeries.mrrEvolution, metrics.faturamentoPorUnidade]);

  return (
    <div className="space-y-6">
      {/* Top 4 KPIs with delta */}
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="MRR Atual (Snapshot)" value={fmt(metrics.mrr)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" subtitle="Foto atual da receita recorrente" helpKey="mrr_snapshot" trend={deltas.mrr?.trend} trendValue={deltas.mrr?.trendValue} />
        <KPICardEnhanced label="Clientes Ativos" value={metrics.clientesAtivos.toLocaleString('pt-BR')} icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" helpKey="clientes_ativos" trend={deltas.clientes?.trend} trendValue={deltas.clientes?.trendValue} />
        <KPICardEnhanced label="Ticket Médio" value={fmtFull(metrics.ticketMedio)} icon={<Target className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" helpKey="ticket_medio" trend={deltas.ticket?.trend} trendValue={deltas.ticket?.trendValue} />
        <KPICardEnhanced label="ARR" value={fmt(metrics.arr)} icon={<BarChart3 className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" helpKey="arr" trend={deltas.arr?.trend} trendValue={deltas.arr?.trendValue} />
      </div>

      {/* Charts: MRR (multi-line with units) + Faturamento side by side */}
      <div className={`grid gap-6 grid-cols-1 lg:grid-cols-2`}>
        <MultiLineChartCard
          title="Evolução do MRR (12 meses)"
          data={mrrChartData}
          lines={mrrLines}
          formatValue={fmt}
          tvMode={tvMode}
          height={340}
        />
        <LineChartCard title="Evolução do Faturamento (12 meses)" data={timeSeries.faturamentoEvolution} formatValue={fmt} tvMode={tvMode} height={340} />
      </div>

      {/* Retention metrics */}
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="NRR" value={fmtPct(metrics.nrr)} size={tvMode ? 'lg' : 'md'} variant={metrics.nrr >= 1 ? 'success' : 'warning'} helpKey="nrr" icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="GRR" value={fmtPct(metrics.grr)} size={tvMode ? 'lg' : 'md'} variant={metrics.grr >= 0.9 ? 'success' : 'warning'} helpKey="grr" icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="Concentração Top 10" value={fmtPct(metrics.concentracaoTop10)} size={tvMode ? 'lg' : 'md'} variant={metrics.concentracaoTop10 > 0.5 ? 'warning' : 'default'} helpKey="concentracao_top10" icon={<BarChart3 className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
        <KPICardEnhanced label="Quick Ratio" value={metrics.quickRatio === Infinity ? '∞' : metrics.quickRatio.toFixed(2)} size={tvMode ? 'lg' : 'md'} variant={metrics.quickRatio >= 4 ? 'success' : metrics.quickRatio >= 1 ? 'warning' : 'destructive'} helpKey="quick_ratio" subtitle={metrics.quickRatio >= 4 ? 'Excelente (≥4)' : metrics.quickRatio >= 1 ? 'Atenção' : 'Crítico'} icon={<Zap className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} />
      </div>

      {/* Certificados A1 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Certificados A1</h3>
          <button onClick={() => refetchCert()} className="text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className={`${tvMode ? 'h-5 w-5' : 'h-4 w-4'} ${certLoading ? 'animate-spin' : ''}`} /></button>
        </div>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'}`}>
          <KPICardEnhanced label="Vendas no Período" value={certA1?.vendasQtd?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<ShieldCheck className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Qtde de vendas de certificado A1 com status 'ganho' no período" />
          <KPICardEnhanced label="Perdido p/ Terceiro" value={certA1?.perdidoTerceiroQtd?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant={certA1?.perdidoTerceiroQtd && certA1.perdidoTerceiroQtd > 0 ? 'destructive' : 'default'} icon={<UserX className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Qtde de certificados renovados com terceiro (perdidos) no período" />
          <KPICardEnhanced label="Faturamento A1" value={fmt(certA1?.faturamento || 0)} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<DollarSign className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Soma dos valores de venda dos certificados A1 com status 'ganho' no período" />
          <KPICardEnhanced label="Oportunidades (Janela)" value={certA1?.oportunidadesJanela?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="default" icon={<Target className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" formula="Clientes com cert vencendo entre -20 e +30 dias de hoje" />
          <KPICardEnhanced
            label="Vencendo em 30 dias"
            value={certA1?.oportunidadesVencendo?.toLocaleString('pt-BR') || '0'}
            size={tvMode ? 'lg' : 'md'}
            variant="warning"
            icon={<Clock className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            subtitle="Baseado em hoje"
            formula="Clientes ativos com certificado vencendo nos próximos 30 dias"
            className="ring-2 ring-warning/40"
          />
          <KPICardEnhanced
            label="Vencidos até 20 dias"
            value={certA1?.oportunidadesVencidas?.toLocaleString('pt-BR') || '0'}
            size={tvMode ? 'lg' : 'md'}
            variant={certA1?.oportunidadesVencidas && certA1.oportunidadesVencidas > 0 ? 'destructive' : 'default'}
            icon={<AlertTriangle className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            subtitle="Baseado em hoje"
            formula="Clientes ativos com certificado vencido há até 20 dias"
            className={certA1?.oportunidadesVencidas && certA1.oportunidadesVencidas > 0 ? 'ring-2 ring-red-500/40' : ''}
          />
        </div>
      </div>
    </div>
  );
}
