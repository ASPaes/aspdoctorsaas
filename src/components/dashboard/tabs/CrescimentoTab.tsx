import { useState } from 'react';
import { TrendingUp, Clock, DollarSign, Calculator, Users, Percent, BarChart3, Shield, ChevronDown, Bug, UserPlus, Flame, Divide, Zap } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { SyncedMultiLineChartCard } from '../charts/SyncedMultiLineChartCard';
import { MultiLineChartCard } from '../charts/MultiLineChartCard';
import { NetNewMrrBreakdown } from '../cards/NetNewMrrBreakdown';
import { SectionHeader } from '../SectionHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useUnitEconomicsSeries } from '../hooks/useUnitEconomicsSeries';
import type { KPIMetrics, TimeSeriesData } from '../types';
import type { MargemContribuicaoData } from '../hooks/useMargemContribuicaoDashboard';
import type { DashboardFilters } from '../types';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

// Delta helper: computes % change and returns trend props for KPICardEnhanced
function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  invertColors = false
): { trend?: 'up' | 'down'; trendValue?: string } {
  if (current == null || previous == null || previous === 0) {
    return { trend: undefined, trendValue: '— vs mês anterior' };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const direction = pct >= 0 ? 'up' : 'down';
  const visualTrend = invertColors ? (direction === 'up' ? 'down' : 'up') : direction;
  const sign = pct >= 0 ? '+' : '';
  return {
    trend: visualTrend as 'up' | 'down',
    trendValue: `${pct >= 0 ? '▲' : '▼'} ${sign}${pct.toFixed(1)}% vs mês anterior`,
  };
}

interface Props {
  metrics: KPIMetrics;
  timeSeries: TimeSeriesData;
  tvMode: boolean;
  mcData?: MargemContribuicaoData;
  filters: DashboardFilters;
}

export function CrescimentoTab({ metrics, timeSeries, tvMode, mcData, filters }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const ranking = metrics.funcionariosRanking || [];
  const mc = mcData;

  const { data: ueData, isLoading: ueLoading } = useUnitEconomicsSeries(filters);
  const current = ueData?.current;
  const series = ueData?.series || [];

  // Previous month from UE series for deltas
  const prevUE = series.length >= 2 ? series[series.length - 2] : null;
  const curUE = current;

  // Previous month from mrrEvolution for top KPIs
  const mrrEvo = timeSeries.mrrEvolution || [];
  const prevMrrPoint = mrrEvo.length >= 2 ? mrrEvo[mrrEvo.length - 2] : null;
  const curMrrPoint = mrrEvo.length >= 1 ? mrrEvo[mrrEvo.length - 1] : null;

  const fmtLtvVal = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '—';
    return v.toFixed(1);
  };

  const fmtLtvCacVal = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '—';
    return v.toFixed(2) + 'x';
  };

  // Deltas for top 4 KPIs
  const mrrDelta = computeDelta(
    curMrrPoint?.value as number | undefined,
    prevMrrPoint?.value as number | undefined
  );

  // For Net New MRR, use UE series (mrr_snapshot diff approximation)
  // Actually use the mrrEvolution values to derive net new per month
  const netNewCur = metrics.netNewMrr;
  // No easy previous net new from existing data, so use MRR delta approach
  const netNewDelta = (() => {
    if (mrrEvo.length >= 3) {
      const prev2 = mrrEvo[mrrEvo.length - 3]?.value as number | undefined;
      const prev1 = mrrEvo[mrrEvo.length - 2]?.value as number | undefined;
      const cur = mrrEvo[mrrEvo.length - 1]?.value as number | undefined;
      if (prev2 != null && prev1 != null && cur != null) {
        const netNewPrev = prev1 - prev2;
        const netNewCurCalc = cur - prev1;
        if (netNewPrev !== 0) {
          const pct = ((netNewCurCalc - netNewPrev) / Math.abs(netNewPrev)) * 100;
          const sign = pct >= 0 ? '+' : '';
          return {
            trend: (pct >= 0 ? 'up' : 'down') as 'up' | 'down',
            trendValue: `${pct >= 0 ? '▲' : '▼'} ${sign}${pct.toFixed(1)}% vs mês anterior`,
          };
        }
      }
    }
    return { trend: undefined, trendValue: '— vs mês anterior' } as { trend?: 'up' | 'down'; trendValue: string };
  })();

  const crescReaisDelta = computeDelta(
    metrics.crescimentoReais,
    prevMrrPoint ? (curMrrPoint?.value as number) - (prevMrrPoint?.value as number) : undefined
  );

  const crescPctDelta = (() => {
    // Use MRR evolution to compute growth % for prev month
    if (mrrEvo.length >= 3) {
      const prev2Val = mrrEvo[mrrEvo.length - 3]?.value as number;
      const prev1Val = mrrEvo[mrrEvo.length - 2]?.value as number;
      const curVal = mrrEvo[mrrEvo.length - 1]?.value as number;
      const prevGrowthPct = prev2Val > 0 ? (prev1Val - prev2Val) / prev2Val : 0;
      const curGrowthPct = prev1Val > 0 ? (curVal - prev1Val) / prev1Val : 0;
      return computeDelta(curGrowthPct, prevGrowthPct);
    }
    return { trend: undefined, trendValue: '— vs mês anterior' } as { trend?: 'up' | 'down'; trendValue: string };
  })();

  // Deltas for Margin section (from UE series)
  const mcTotalDelta = computeDelta(curUE?.mc_total, prevUE?.mc_total);
  const mcPctDelta = computeDelta(curUE?.mc_percent, prevUE?.mc_percent);
  const mcMediaDelta = (() => {
    if (curUE && prevUE && curUE.ativos_fim > 0 && prevUE.ativos_fim > 0) {
      const curMedia = curUE.mc_total / curUE.ativos_fim;
      const prevMedia = prevUE.mc_total / prevUE.ativos_fim;
      return computeDelta(curMedia, prevMedia);
    }
    return { trend: undefined, trendValue: '— vs mês anterior' } as { trend?: 'up' | 'down'; trendValue: string };
  })();

  // Deltas for Unit Economics (from UE series)
  const ltvMDelta = computeDelta(curUE?.ltv_M, prevUE?.ltv_M);
  const ltvRecDelta = computeDelta(curUE?.ltv_rec_margem_M, prevUE?.ltv_rec_margem_M);
  const cacDelta = computeDelta(curUE?.cac_por_logo_M, prevUE?.cac_por_logo_M, true); // inverted
  const ltvCacDelta = computeDelta(curUE?.ltv_cac_rec_M, prevUE?.ltv_cac_rec_M);
  const paybackDelta = computeDelta(curUE?.cac_payback_M, prevUE?.cac_payback_M, true); // inverted

  // Chart data
  const ltvChartData = series.map(m => ({
    monthFull: m.monthFull,
    ltv_M: m.ltv_M,
    ltv_3M: m.ltv_3M,
    ltv_6M: m.ltv_6M,
  }));

  const ltvCacChartData = series.map(m => ({
    monthFull: m.monthFull,
    ltv_cac_rec_M: m.ltv_cac_rec_M,
    ltv_cac_rec_3M: m.ltv_cac_rec_3M,
    ltv_cac_rec_6M: m.ltv_cac_rec_6M,
  }));

  const cacChartData = series.map(m => ({
    monthFull: m.monthFull,
    cac_burn: m.cac_burn_M,
    cac_por_logo: m.cac_por_logo_M,
  }));

  const [debugOpen, setDebugOpen] = useState(false);

  return (
    <div className="space-y-8">

      {/* ═══════ SEÇÃO 1 — Receita e Crescimento ═══════ */}
      <section className="space-y-4">
        <SectionHeader
          title="Receita e Crescimento"
          description="Visão consolidada do MRR e variação no período"
          icon={<TrendingUp className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
          <KPICardEnhanced
            label="MRR Atual (Snapshot)"
            value={fmt(metrics.mrr)}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="primary"
            subtitle="Foto atual da receita recorrente"
            formula="Soma das mensalidades de todos os clientes ativos. Retrato instantâneo."
            trend={mrrDelta.trend}
            trendValue={mrrDelta.trendValue}
          />
          <KPICardEnhanced
            label="Net New MRR (no período)"
            value={fmt(metrics.netNewMrr)}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant={metrics.netNewMrr >= 0 ? 'success' : 'destructive'}
            subtitle="Variação líquida no período"
            formula="New MRR + Upsell + Cross-sell − Downsell − Churn MRR."
            trend={netNewDelta.trend}
            trendValue={netNewDelta.trendValue}
          />
        </div>

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          <KPICardEnhanced
            label="Crescimento R$"
            value={fmt(metrics.crescimentoReais)}
            icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.crescimentoReais >= 0 ? 'success' : 'destructive'}
            formula="MRR atual − MRR no início do período"
            trend={crescReaisDelta.trend}
            trendValue={crescReaisDelta.trendValue}
          />
          <KPICardEnhanced
            label="Crescimento %"
            value={fmtPct(metrics.crescimentoPercent)}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.crescimentoPercent >= 0 ? 'success' : 'destructive'}
            formula="Crescimento R$ ÷ MRR início do período"
            trend={crescPctDelta.trend}
            trendValue={crescPctDelta.trendValue}
          />
        </div>

        <NetNewMrrBreakdown
          newMrr={metrics.newMrr}
          upsellMrr={metrics.upsellMrr}
          crossSellMrr={metrics.crossSellMrr}
          downsellMrr={metrics.downsellMrr}
          mrrCancelado={metrics.mrrCancelado}
          netNewMrr={metrics.netNewMrr}
          tvMode={tvMode}
        />
      </section>

      {/* ═══════ SEÇÃO 2 — Margem e Eficiência ═══════ */}
      <section className="space-y-4">
        <SectionHeader
          title="Margem e Eficiência"
          description="Margem de contribuição da carteira ativa"
          icon={<Calculator className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <KPICardEnhanced
            label="MC Total (R$)"
            value={mc != null ? fmt(mc.mc_total) : '—'}
            icon={<Calculator className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            formula="Receita (MRR) − COGS − Impostos − Custos Fixos alocados."
            trend={mcTotalDelta.trend}
            trendValue={mcTotalDelta.trendValue}
          />
          <KPICardEnhanced
            label="MC% Ponderada"
            value={mc != null ? fmtPct(mc.mc_percent_ponderada) : '—'}
            icon={<Percent className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant={mc && mc.mc_percent_ponderada >= 0.3 ? 'success' : mc && mc.mc_percent_ponderada >= 0.1 ? 'warning' : 'destructive'}
            formula="MC Total ÷ MRR Total. Ponderada pela receita, não média simples."
            trend={mcPctDelta.trend}
            trendValue={mcPctDelta.trendValue}
          />
          <KPICardEnhanced
            label="MC Média / Cliente (R$)"
            value={mc != null ? fmt(mc.mc_media_por_cliente) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            formula="MC Total ÷ Clientes Ativos."
            trend={mcMediaDelta.trend}
            trendValue={mcMediaDelta.trendValue}
          />
        </div>
      </section>

      {/* ═══════ SEÇÃO 3 — Retenção e Unit Economics (modelo SaaS) ═══════ */}
      <section className="space-y-4">
        <SectionHeader
          title="Retenção e Unit Economics"
          description="CAC burn vs por logo, LTV recorrente com margem, LTV/CAC padrão SaaS"
          icon={<Shield className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        {/* Linha 1: CAC e Aquisição */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <KPICardEnhanced
            label="CAC Burn (mês)"
            value={current?.cac_burn_M ? fmt(current.cac_burn_M) : '—'}
            icon={<Flame className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Soma valor_alocado de despesas CAC vigentes no mês (mes_inicial ≤ M ≤ mes_final). Inclui despesas gerais."
          />
          <KPICardEnhanced
            label="Novos Clientes (mês)"
            value={current?.novos_clientes != null ? current.novos_clientes.toString() : '—'}
            icon={<UserPlus className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Clientes com data_venda dentro do mês."
          />
          <KPICardEnhanced
            label="CAC por Logo"
            value={current?.cac_por_logo_M != null ? fmt(current.cac_por_logo_M) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Custo unitário de aquisição"
            formula="CAC Burn ÷ Novos Clientes do mês. Se novos=0, exibe '—'."
            trend={cacDelta.trend}
            trendValue={cacDelta.trendValue}
          />
          <KPICardEnhanced
            label="Ativação Média (novos)"
            value={current?.ativacao_media != null ? fmt(current.ativacao_media) : '—'}
            icon={<Zap className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Setup fee, fora do ARPA"
            formula="Média de valor_ativacao dos novos clientes do mês. NÃO entra no ticket/ARPA."
          />
        </div>

        {/* Linha 2: LTV e métricas recorrentes */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <KPICardEnhanced
            label="ARPA (mês)"
            value={current?.arpa != null ? fmt(current.arpa) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Sem ativação"
            formula="MRR Snapshot ÷ Clientes Ativos. Não inclui valor de ativação (setup fee)."
          />
          <KPICardEnhanced
            label="LTV (meses)"
            value={fmtLtvVal(current?.ltv_M)}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle={current?.ltv_M === 120 ? 'Teto aplicado (churn=0)' : undefined}
            formula="1 ÷ Churn Rate mensal. Teto: 120 meses quando churn=0."
            trend={ltvMDelta.trend}
            trendValue={ltvMDelta.trendValue}
          />
          <KPICardEnhanced
            label="LTV Recorrente (R$)"
            value={current?.ltv_rec_margem_M != null ? fmt(current.ltv_rec_margem_M) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Com margem (MC%)"
            formula="ARPA × MC% Ponderada × LTV (meses). Receita líquida esperada por cliente."
            trend={ltvRecDelta.trend}
            trendValue={ltvRecDelta.trendValue}
          />
          <KPICardEnhanced
            label="LTV/CAC Recorrente"
            value={fmtLtvCacVal(current?.ltv_cac_rec_M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_rec_M != null && current.ltv_cac_rec_M >= 3 ? 'success' : current?.ltv_cac_rec_M != null && current.ltv_cac_rec_M >= 1 ? 'warning' : 'destructive'}
            subtitle={
              current?.ltv_cac_rec_M != null && current.ltv_cac_rec_M >= 3
                ? '✅ Saudável (benchmark: >3x)'
                : current?.ltv_cac_rec_M != null && current.ltv_cac_rec_M >= 1
                ? '⚠️ Atenção (benchmark: >3x)'
                : '🔴 Crítico (benchmark: >3x)'
            }
            formula="LTV Recorrente (R$) ÷ CAC por Logo. Usa CAC unitário, nunca burn total. Razão em 'x'."
            trend={ltvCacDelta.trend}
            trendValue={ltvCacDelta.trendValue}
          />
        </div>

        {/* Linha 3: CAC Payback + janelas 3M/6M */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <KPICardEnhanced
            label="CAC Payback (meses)"
            value={current?.cac_payback_M != null && current.cac_payback_M < 999 ? current.cac_payback_M.toFixed(1) : '—'}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.cac_payback_M != null && current.cac_payback_M <= 12 ? 'success' : 'warning'}
            formula="CAC por Logo ÷ (ARPA × MC%). Meses para recuperar o investimento. Ideal ≤ 12."
            trend={paybackDelta.trend}
            trendValue={paybackDelta.trendValue}
          />
          <KPICardEnhanced
            label="LTV/CAC (3M)"
            value={fmtLtvCacVal(current?.ltv_cac_rec_3M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_rec_3M != null && current.ltv_cac_rec_3M >= 3 ? 'success' : current?.ltv_cac_rec_3M != null && current.ltv_cac_rec_3M >= 1 ? 'warning' : 'destructive'}
            subtitle="Janela 3 meses"
            formula="LTV Rec. (3M) ÷ CAC por Logo (3M). Churn, ARPA e MC% agregados na janela."
          />
          <KPICardEnhanced
            label="LTV/CAC (6M)"
            value={fmtLtvCacVal(current?.ltv_cac_rec_6M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_rec_6M != null && current.ltv_cac_rec_6M >= 3 ? 'success' : current?.ltv_cac_rec_6M != null && current.ltv_cac_rec_6M >= 1 ? 'warning' : 'destructive'}
            subtitle="Janela 6 meses"
            formula="LTV Rec. (6M) ÷ CAC por Logo (6M). Churn, ARPA e MC% agregados na janela."
          />
        </div>
      </section>

      {/* ═══════ SEÇÃO 4 — Detalhes e Evolução ═══════ */}
      <section className="space-y-4">
        <SectionHeader
          title="Detalhes e Evolução"
          description="Ranking de funcionários e séries históricas"
          icon={<BarChart3 className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        {/* MRR por Funcionário */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={`flex items-center gap-2 ${tvMode ? 'text-xl' : 'text-base'}`}>
              <Users className={`${tvMode ? 'h-6 w-6' : 'h-4 w-4'} text-primary`} />
              MRR por Funcionário
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ranking.length > 0 ? (
              <div className="divide-y divide-border">
                {ranking.slice(0, 5).map((f, i) => (
                  <div key={f.nome} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-primary/30 text-primary">
                        {i + 1}
                      </Badge>
                      <span className="text-sm font-medium">{f.nome}</span>
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

        {/* Gráficos com hover sincronizado */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          <SyncedMultiLineChartCard
            title="Evolução LTV (meses)"
            data={ltvChartData}
            lines={[
              { dataKey: 'ltv_M', label: 'Mensal', color: 'hsl(var(--chart-1))' },
              { dataKey: 'ltv_3M', label: 'Média 3M', color: 'hsl(var(--chart-3))', strokeDasharray: '5 5' },
              { dataKey: 'ltv_6M', label: 'Média 6M', color: 'hsl(var(--chart-5))', strokeDasharray: '10 5' },
            ]}
            formatValue={v => v.toFixed(1) + ' meses'}
            tvMode={tvMode}
            syncId="crescimento-ltv-sync"
          />
          <SyncedMultiLineChartCard
            title="Evolução LTV/CAC Recorrente (x)"
            data={ltvCacChartData}
            lines={[
              { dataKey: 'ltv_cac_rec_M', label: 'Mensal', color: 'hsl(var(--chart-2))' },
              { dataKey: 'ltv_cac_rec_3M', label: 'Média 3M', color: 'hsl(var(--chart-4))', strokeDasharray: '5 5' },
              { dataKey: 'ltv_cac_rec_6M', label: 'Média 6M', color: 'hsl(var(--chart-5))', strokeDasharray: '10 5' },
            ]}
            formatValue={v => v.toFixed(2) + 'x'}
            tvMode={tvMode}
            syncId="crescimento-ltv-sync"
          />
        </div>

        <MultiLineChartCard
          title="Evolução CAC: Burn vs Por Logo (R$)"
          data={cacChartData}
          lines={[
            { dataKey: 'cac_burn', label: 'CAC Burn', color: 'hsl(var(--chart-1))' },
            { dataKey: 'cac_por_logo', label: 'CAC por Logo', color: 'hsl(var(--chart-2))', strokeDasharray: '5 5' },
          ]}
          formatValue={v => fmt(v)}
          tvMode={tvMode}
        />
      </section>

      {/* ═══════ DEBUG / AUDITORIA ═══════ */}
      <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Bug className="h-3.5 w-3.5" />
            <span>Dados de Auditoria (Unit Economics SaaS)</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${debugOpen ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="pt-4">
              {series.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1 px-2 font-semibold text-muted-foreground">Mês</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Base</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Cancel.</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Novos</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Churn%</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">ARPA</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">MC%</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV m</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">CAC burn</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">CAC/logo</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV R$</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV/CAC</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Payback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map(m => (
                        <tr key={m.yearMonth} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-1 px-2 font-medium">{m.monthFull}</td>
                          <td className="text-right py-1 px-2">{m.base_inicio}</td>
                          <td className="text-right py-1 px-2">{m.cancelados}</td>
                          <td className="text-right py-1 px-2">{m.novos_clientes}</td>
                          <td className="text-right py-1 px-2">{m.churn_M !== null ? (m.churn_M * 100).toFixed(2) + '%' : '—'}</td>
                          <td className="text-right py-1 px-2">{m.arpa != null ? fmt(m.arpa) : '—'}</td>
                          <td className="text-right py-1 px-2">{m.mc_percent != null ? (m.mc_percent * 100).toFixed(1) + '%' : '—'}</td>
                          <td className="text-right py-1 px-2">{fmtLtvVal(m.ltv_M)}</td>
                          <td className="text-right py-1 px-2">{fmt(m.cac_burn_M)}</td>
                          <td className="text-right py-1 px-2">{m.cac_por_logo_M != null ? fmt(m.cac_por_logo_M) : '—'}</td>
                          <td className="text-right py-1 px-2">{m.ltv_rec_margem_M != null ? fmt(m.ltv_rec_margem_M) : '—'}</td>
                          <td className="text-right py-1 px-2">{fmtLtvCacVal(m.ltv_cac_rec_M)}</td>
                          <td className="text-right py-1 px-2">{m.cac_payback_M != null ? m.cac_payback_M.toFixed(1) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  {ueLoading ? 'Carregando...' : 'Sem dados disponíveis'}
                </p>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
