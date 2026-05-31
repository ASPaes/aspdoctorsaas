import { useMemo, useState } from 'react';
import {
  Users, DollarSign, Target, BarChart3, Percent,
  ShieldCheck, AlertTriangle, Clock, RefreshCw, Zap, UserX,
  TrendingUp, Wallet, Scale, CalendarClock,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { MultiLineChartCard } from '../charts/MultiLineChartCard';
import { ComparativosTemporaisBlock } from '../ComparativosTemporaisBlock';
import { DiagnosticoButton, DiagnosticoInlineCard, DiagnosticoModal } from '../diagnostico';
import { useCertA1Data } from '../hooks/useCertA1Data';
import { useVisaoGeralExtras } from '../hooks/useVisaoGeralExtras';
import { computeDiagnostico, type DiagnosticoInput } from '@/lib/diagnostico';
import kpiHelp from '@/lib/kpiHelp';
import type { KPIMetrics, TimeSeriesData } from '../types';
import type { MargemContribuicaoData } from '../hooks/useMargemContribuicaoDashboard';

interface VisaoGeralTabProps {
  metrics: KPIMetrics;
  timeSeries: TimeSeriesData;
  tvMode: boolean;
  mcData?: MargemContribuicaoData;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtFull = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPts = (v: number) => v.toFixed(1);
const fmtX = (v: number) => v === Infinity ? '∞' : `${v.toFixed(2)}x`;
const fmtMeses = (v: number) => `${v.toFixed(1)}m`;

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

/**
 * Resolve variant a partir do benchmark do kpiHelp.
 */
function variantFromBenchmark(value: number, kpiKey: string): 'success' | 'warning' | 'destructive' | 'dark' {
  const benchmark = kpiHelp[kpiKey]?.benchmark;
  if (!benchmark) return 'dark';
  for (const zone of benchmark) {
    const { range_min, range_max, status } = zone;
    const aboveMin = range_min === undefined || value >= range_min;
    const belowMax = range_max === undefined || value < range_max;
    if (aboveMin && belowMax) {
      if (status === 'ok') return 'success';
      if (status === 'warn') return 'warning';
      if (status === 'crit') return 'destructive';
    }
  }
  return 'dark';
}

export function VisaoGeralTab({ metrics, timeSeries, tvMode, mcData, periodoInicio, periodoFim }: VisaoGeralTabProps) {
  const s = tvMode ? 'tv' : 'lg';
  const sMd = tvMode ? 'lg' : 'md';
  const { data: certA1, isLoading: certLoading, refetch: refetchCert } = useCertA1Data(periodoInicio || null, periodoFim || null);
  const { data: extras } = useVisaoGeralExtras();

  const [diagOpen, setDiagOpen] = useState(false);

  // ── Eficiência & Saúde ──
  const mcPercent = mcData?.mc_percent_ponderada ?? 0;
  const ruleOf40 = (metrics.crescimentoPercent + mcPercent) * 100;
  const cacPayback = Number.isFinite(metrics.cacPayback) ? metrics.cacPayback : 0;
  const ltvCac = Number.isFinite(metrics.ltvCac) ? metrics.ltvCac : 0;
  const tenureMedio = extras?.tenureMedio ?? 0;

  // ── Diagnóstico ──
  const diagInput: DiagnosticoInput = useMemo(() => ({
    mrr: metrics.mrr,
    newMrr: metrics.newMrr,
    mrrCancelado: metrics.mrrCancelado,
    downsellMrr: metrics.downsellMrr,
    reativacaoMrr: metrics.reativacaoMrr,
    upsellMrr: metrics.upsellMrr,
    crossSellMrr: metrics.crossSellMrr,
    nrr: metrics.nrr,
    grr: metrics.grr,
    quickRatio: metrics.quickRatio === Infinity ? undefined : metrics.quickRatio,
    churnCarteira: metrics.churnCarteiraPercent,
    cacPayback: Number.isFinite(metrics.cacPayback) ? metrics.cacPayback : undefined,
    ltvCac: Number.isFinite(metrics.ltvCac) ? metrics.ltvCac : undefined,
    ruleOf40,
    mcPercentPonderada: mcPercent,
    tenureMedio,
    concentracaoTop10: metrics.concentracaoTop10,
    clientesAtivos: metrics.clientesAtivos,
    cancelamentosQtd: metrics.cancelamentosQtd,
  }), [metrics, ruleOf40, mcPercent, tenureMedio]);

  const diagnostico = useMemo(() => computeDiagnostico(diagInput, 'visao-geral'), [diagInput]);

  // ── Deltas ──
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

  // ── Charts ──
  const { mrrLines, mrrChartData } = useMemo(() => {
    const units = metrics.faturamentoPorUnidade;
    const lines: any[] = [
      { dataKey: 'value', label: 'MRR Total', color: 'hsl(var(--primary))' },
    ];
    units.forEach((u, i) => {
      const colors = ['hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
      lines.push({
        dataKey: `mrr_${u.id}`,
        label: `MRR ${u.nome}`,
        color: colors[i % colors.length],
        strokeDasharray: '5 3',
      });
    });
    return { mrrLines: lines, mrrChartData: timeSeries.mrrEvolution };
  }, [timeSeries.mrrEvolution, metrics.faturamentoPorUnidade]);

  const tabLabel = useMemo(() => {
    const now = new Date();
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `Visão geral · ${meses[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

  return (
    <div className="space-y-8">
      {/* HEADER: Botão Diagnóstico */}
      {diagnostico.severity !== 'ok' && (
        <div className="flex justify-end">
          <DiagnosticoButton diagnostico={diagnostico} onClick={() => setDiagOpen(true)} />
        </div>
      )}

      {/* BLOCO 1: Foto da Receita */}
      <section className="space-y-3">
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="MRR Atual (Snapshot)"
            value={fmt(metrics.mrr)}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            subtitle="Foto atual da receita recorrente"
            helpKey="mrr_snapshot"
            trend={deltas.mrr?.trend}
            trendValue={deltas.mrr?.trendValue}
          />
          <KPICardEnhanced
            label="Clientes Ativos"
            value={metrics.clientesAtivos.toLocaleString('pt-BR')}
            icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            helpKey="clientes_ativos"
            trend={deltas.clientes?.trend}
            trendValue={deltas.clientes?.trendValue}
          />
          <KPICardEnhanced
            label="Ticket Médio"
            value={fmtFull(metrics.ticketMedio)}
            icon={<Target className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            helpKey="ticket_medio"
            trend={deltas.ticket?.trend}
            trendValue={deltas.ticket?.trendValue}
          />
          <KPICardEnhanced
            label="ARR"
            value={fmt(metrics.arr)}
            icon={<BarChart3 className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            helpKey="arr"
            trend={deltas.arr?.trend}
            trendValue={deltas.arr?.trendValue}
          />
        </div>
      </section>

      {/* BLOCO 2: Eficiência & Saúde */}
      <section className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Eficiência & saúde</h3>
            <span className="inline-flex items-center rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
              NOVO · 4 MASTERS
            </span>
          </div>
          <p className="text-xs text-muted-foreground">unit economics de SaaS B2B</p>
        </div>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="Rule of 40"
            value={fmtPts(ruleOf40)}
            icon={<TrendingUp className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            size={sMd}
            variant={variantFromBenchmark(ruleOf40, 'rule_of_40')}
            helpKey="rule_of_40"
            subtitle={`growth ${(metrics.crescimentoPercent * 100).toFixed(1)}% + MC ${(mcPercent * 100).toFixed(1)}%`}
            currentValue={ruleOf40}
          />
          <KPICardEnhanced
            label="CAC Payback"
            value={cacPayback > 0 ? fmtMeses(cacPayback) : '—'}
            icon={<Wallet className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            size={sMd}
            variant={cacPayback > 0 ? variantFromBenchmark(cacPayback, 'cac_payback') : 'dark'}
            helpKey="cac_payback"
            subtitle="CAC ÷ (ARPA × MC%)"
            currentValue={cacPayback > 0 ? cacPayback : undefined}
          />
          <KPICardEnhanced
            label="LTV / CAC"
            value={ltvCac > 0 ? fmtX(ltvCac) : '—'}
            icon={<Scale className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            size={sMd}
            variant={ltvCac > 0 ? variantFromBenchmark(ltvCac, 'ltv_cac_recorrente') : 'dark'}
            helpKey="ltv_cac_recorrente"
            subtitle="LTV recorrente ÷ CAC logo"
            currentValue={ltvCac > 0 ? ltvCac : undefined}
          />
          <KPICardEnhanced
            label="Tenure Médio"
            value={tenureMedio > 0 ? fmtMeses(tenureMedio) : '—'}
            icon={<CalendarClock className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            size={sMd}
            variant={tenureMedio > 0 ? variantFromBenchmark(tenureMedio, 'tenure_medio') : 'dark'}
            helpKey="tenure_medio"
            subtitle="média da base ativa"
            currentValue={tenureMedio > 0 ? tenureMedio : undefined}
          />
        </div>
      </section>

      {/* BLOCO 3: Retenção */}
      <section className="space-y-3">
        <div>
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Retenção</h3>
          <p className="text-xs text-muted-foreground">capacidade de manter receita existente</p>
        </div>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="NRR"
            value={fmtPct(metrics.nrr)}
            size={sMd}
            variant={metrics.nrr >= 1 ? 'success' : 'warning'}
            helpKey="nrr"
            icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            currentValue={metrics.nrr}
          />
          <KPICardEnhanced
            label="GRR"
            value={fmtPct(metrics.grr)}
            size={sMd}
            variant={metrics.grr >= 0.9 ? 'success' : 'warning'}
            helpKey="grr"
            icon={<Percent className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            currentValue={metrics.grr}
          />
          <KPICardEnhanced
            label="Concentração Top 10"
            value={fmtPct(metrics.concentracaoTop10)}
            size={sMd}
            variant={metrics.concentracaoTop10 > 0.5 ? 'warning' : 'default'}
            helpKey="concentracao_top10"
            icon={<BarChart3 className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            currentValue={metrics.concentracaoTop10}
          />
          <KPICardEnhanced
            label="Quick Ratio"
            value={metrics.quickRatio === Infinity ? '∞' : metrics.quickRatio.toFixed(2)}
            size={sMd}
            variant={metrics.quickRatio >= 4 ? 'success' : metrics.quickRatio >= 1 ? 'warning' : 'destructive'}
            helpKey="quick_ratio"
            subtitle={metrics.quickRatio >= 4 ? 'Excelente (≥4)' : metrics.quickRatio >= 1 ? 'Atenção' : 'Crítico'}
            icon={<Zap className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />}
            currentValue={metrics.quickRatio === Infinity ? undefined : metrics.quickRatio}
          />
        </div>
      </section>

      {/* BLOCO 4: Diagnóstico Inline */}
      {diagnostico.severity !== 'ok' && (
        <section>
          <DiagnosticoInlineCard diagnostico={diagnostico} onSeeMore={() => setDiagOpen(true)} />
        </section>
      )}

      {/* BLOCO 5: Gráficos + Comparativos */}
      <section className="space-y-3">
        <div>
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Evolução · 12 meses</h3>
          <p className="text-xs text-muted-foreground">série histórica</p>
        </div>
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
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
      </section>

      <section className="space-y-3">
        <div>
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Comparativos temporais</h3>
          <p className="text-xs text-muted-foreground">MRR atual em 3 janelas históricas</p>
        </div>
        {extras ? (
          <ComparativosTemporaisBlock
            trimestre={extras.mrrTrimestre}
            semestre={extras.mrrSemestre}
            ano={extras.mrrAno}
            format="BRL"
          />
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        )}
      </section>

      {/* BLOCO 6: Certificados A1 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>Certificados A1</h3>
          <button onClick={() => refetchCert()} className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`${tvMode ? 'h-5 w-5' : 'h-4 w-4'} ${certLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'}`}>
          <KPICardEnhanced label="Vendas no Período" value={certA1?.vendasQtd?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<ShieldCheck className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Qtde de vendas de certificado A1 com status 'ganho' no período" />
          <KPICardEnhanced label="Perdido p/ Terceiro" value={certA1?.perdidoTerceiroQtd?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant={certA1?.perdidoTerceiroQtd && certA1.perdidoTerceiroQtd > 0 ? 'destructive' : 'default'} icon={<UserX className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Qtde de certificados renovados com terceiro (perdidos) no período" />
          <KPICardEnhanced label="Faturamento A1" value={fmt(certA1?.faturamento || 0)} size={tvMode ? 'lg' : 'md'} variant="primary" icon={<DollarSign className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} formula="Soma dos valores de venda dos certificados A1 com status 'ganho' no período" />
          <KPICardEnhanced label="Oportunidades (Janela)" value={certA1?.oportunidadesJanela?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="default" icon={<Target className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" formula="Clientes com cert vencendo entre -20 e +30 dias de hoje" />
          <KPICardEnhanced label="Vencendo em 30 dias" value={certA1?.oportunidadesVencendo?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant="warning" icon={<Clock className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" formula="Clientes ativos com certificado vencendo nos próximos 30 dias" className="ring-2 ring-warning/40" />
          <KPICardEnhanced label="Vencidos até 20 dias" value={certA1?.oportunidadesVencidas?.toLocaleString('pt-BR') || '0'} size={tvMode ? 'lg' : 'md'} variant={certA1?.oportunidadesVencidas && certA1.oportunidadesVencidas > 0 ? 'destructive' : 'default'} icon={<AlertTriangle className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-current`} />} subtitle="Baseado em hoje" formula="Clientes ativos com certificado vencido há até 20 dias" className={certA1?.oportunidadesVencidas && certA1.oportunidadesVencidas > 0 ? 'ring-2 ring-red-500/40' : ''} />
        </div>
      </section>

      {/* MODAL */}
      <DiagnosticoModal
        diagnostico={diagnostico}
        open={diagOpen}
        onOpenChange={setDiagOpen}
        tabLabel={tabLabel}
      />
    </div>
  );
}
