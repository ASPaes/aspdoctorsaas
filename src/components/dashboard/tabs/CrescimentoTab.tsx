import { useMemo, useState } from 'react';
import {
  TrendingUp, DollarSign, Calculator, BarChart3, Users, UserPlus,
  Percent, Zap, Flame, Divide, Wallet, Activity, Scale, Target, Sparkles,
} from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { ARPAComboCard, ReativacoesCard } from '../cards/CrescimentoCustomCards';
import { NetNewMrrBreakdown } from '../cards/NetNewMrrBreakdown';
import { MrrForecastChart, GrowthRateBarChart } from '../charts/CrescimentoCharts';
import { SyncedMultiLineChartCard } from '../charts/SyncedMultiLineChartCard';
import { MultiLineChartCard } from '../charts/MultiLineChartCard';
import { SectionHeader } from '../SectionHeader';
import { ComparativosTemporaisBlock } from '../ComparativosTemporaisBlock';
import { DiagnosticoButton, DiagnosticoInlineCard, DiagnosticoModal } from '../diagnostico';
import { useUnitEconomicsSeries } from '../hooks/useUnitEconomicsSeries';
import { useCrescimentoExtras } from '../hooks/useCrescimentoExtras';
import { useVisaoGeralExtras } from '../hooks/useVisaoGeralExtras';
import { computeDiagnostico, type DiagnosticoInput } from '@/lib/diagnostico';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

import type { KPIMetrics, TimeSeriesData, DashboardFilters } from '../types';
import type { MargemContribuicaoData } from '../hooks/useMargemContribuicaoDashboard';

// ─── Formatters ──────────────────────────────────────────────
const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtX = (v: number) => v === Infinity ? '∞' : `${v.toFixed(2)}x`;
const fmtMeses = (v: number) => `${v.toFixed(1)}m`;
const fmtPts = (v: number) => v.toFixed(1);

// ─── Delta helper ────────────────────────────────────────────
function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  invertColors = false,
): { trend?: 'up' | 'down' | 'neutral'; trendValue?: string } {
  if (current == null || previous == null || previous === 0) {
    return { trend: undefined, trendValue: '— vs mês anterior' };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (pct === 0) return { trend: 'neutral', trendValue: '0% vs mês anterior' };
  const direction = pct >= 0 ? 'up' : 'down';
  const visualTrend = invertColors ? (direction === 'up' ? 'down' : 'up') : direction;
  const sign = pct >= 0 ? '+' : '';
  return {
    trend: visualTrend as 'up' | 'down',
    trendValue: `${sign}${pct.toFixed(1)}% vs mês anterior`,
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
  const sLg = tvMode ? 'tv' : 'lg';
  const sMd = tvMode ? 'lg' : 'md';
  const iconLg = tvMode ? 'h-8 w-8' : 'h-5 w-5';
  const iconMd = tvMode ? 'h-6 w-6' : 'h-4 w-4';

  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin === true;
  const isAdminOrHead = isAdmin || profile?.role === 'head';

  const { data: ueData } = useUnitEconomicsSeries(filters);
  const { data: extras } = useCrescimentoExtras({ filters, metrics, unitEconomics: ueData, mcData });
  const { data: vgExtras } = useVisaoGeralExtras(filters);

  const ueCurrent = ueData?.current;
  const uePrev = ueData && ueData.series.length >= 2 ? ueData.series[ueData.series.length - 2] : null;
  const series = ueData?.series || [];

  // ─── Diagnóstico ─────────────────────────────────────────
  const mcPercent = mcData?.mc_percent_ponderada ?? 0;

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
    cacPayback: Number.isFinite(metrics.cacPayback) ? metrics.cacPayback : undefined,
    ltvCac: Number.isFinite(metrics.ltvCac) ? metrics.ltvCac : undefined,
    ruleOf40: extras?.ruleOf40,
    mcPercentPonderada: mcPercent,
    concentracaoTop10: metrics.concentracaoTop10,
    clientesAtivos: metrics.clientesAtivos,
    cancelamentosQtd: metrics.cancelamentosQtd,
    // Crescimento V2
    burnMultiple: extras?.burnMultiple ?? undefined,
    magicNumber: extras?.magicNumber ?? undefined,
    expansionRate: extras?.expansionRate ?? undefined,
    growthRateMoM: extras?.growthRateMoM ?? undefined,
    arrGrowthYoY: extras?.arrGrowthYoY ?? undefined,
    netLogoGrowth: extras?.netLogoGrowth,
    logoGrowthRate: extras?.logoGrowthRate ?? undefined,
    growthPersistence: extras?.growthPersistence ?? undefined,
  } as any), [metrics, extras, mcPercent]);

  const diagnostico = useMemo(() => computeDiagnostico(diagInput, 'crescimento'), [diagInput]);
  const [diagOpen, setDiagOpen] = useState(false);

  // ─── Chart data ──────────────────────────────────────────
  const ltvChartData = useMemo(() => series.map((m) => ({
    monthFull: m.monthFull,
    ltv_M: m.ltv_M,
    ltv_3M: m.ltv_3M,
    ltv_6M: m.ltv_6M,
  })), [series]);

  const ltvCacChartData = useMemo(() => series.map((m) => ({
    monthFull: m.monthFull,
    ltv_cac_rec_M: m.ltv_cac_rec_M,
    ltv_cac_rec_3M: m.ltv_cac_rec_3M,
    ltv_cac_rec_6M: m.ltv_cac_rec_6M,
  })), [series]);

  const cacChartData = useMemo(() => series.map((m) => ({
    monthFull: m.monthFull,
    cac_burn: m.cac_burn_M,
    cac_por_logo: m.cac_por_logo_M,
  })), [series]);

  // ─── Deltas ──────────────────────────────────────────────
  const cacDelta = computeDelta(ueCurrent?.cac_por_logo_M, uePrev?.cac_por_logo_M, true);
  const paybackDelta = computeDelta(ueCurrent?.cac_payback_M, uePrev?.cac_payback_M, true);
  const ltvCacDelta = computeDelta(ueCurrent?.ltv_cac_rec_M, uePrev?.ltv_cac_rec_M);

  const mrrEvo = timeSeries.mrrEvolution || [];
  const prevMrrPoint = mrrEvo.length >= 2 ? mrrEvo[mrrEvo.length - 2] : null;
  const curMrrPoint = mrrEvo.length >= 1 ? mrrEvo[mrrEvo.length - 1] : null;
  const mrrDelta = computeDelta(curMrrPoint?.value as number | undefined, prevMrrPoint?.value as number | undefined);
  const arrDelta = computeDelta(metrics.arr, prevMrrPoint ? (prevMrrPoint.value as number) * 12 : undefined);

  // ─── Crescimento extras (fallback safe) ──────────────────
  const growthMoM = extras?.growthRateMoM;
  const arrGrowth = extras?.arrGrowthYoY;
  const ruleOf40 = extras?.ruleOf40 ?? 0;
  const growthPersistence = extras?.growthPersistence;
  const expansionRate = extras?.expansionRate;
  const netLogoGrowth = extras?.netLogoGrowth ?? 0;
  const logoGrowthRate = extras?.logoGrowthRate;
  const burnMultiple = extras?.burnMultiple;
  const magicNumber = extras?.magicNumber;

  return (
    <div className="space-y-8">
      {/* HEADER: Botão Diagnóstico */}
      {diagnostico.severity !== 'ok' && (
        <div className="flex justify-end">
          <DiagnosticoButton diagnostico={diagnostico} onClick={() => setDiagOpen(true)} />
        </div>
      )}

      {/* ═══════ BLOCO 1 — VELOCITY ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Velocity — velocidade do crescimento"
          description="Foto atual + ritmo de variação da receita"
          icon={<TrendingUp className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {/* Linha 1 — 4 cards principais */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="MRR Atual (Snapshot)"
            value={fmt(metrics.mrr)}
            icon={<DollarSign className={`${iconLg} text-primary`} />}
            size={sLg}
            variant="primary"
            subtitle="Foto atual da receita recorrente"
            helpKey="mrr_snapshot"
            trend={mrrDelta.trend}
            trendValue={mrrDelta.trendValue}
          />
          <KPICardEnhanced
            label="Net New MRR"
            value={`${metrics.netNewMrr >= 0 ? '+' : ''}${fmt(metrics.netNewMrr)}`}
            icon={<Calculator className={`${iconLg} text-primary`} />}
            size={sLg}
            variant={metrics.netNewMrr >= 0 ? 'success' : 'destructive'}
            subtitle="Variação líquida no período"
            helpKey="net_new_mrr"
          />
          <KPICardEnhanced
            label="Growth Rate MoM"
            value={growthMoM != null ? fmtPct(growthMoM) : '—'}
            icon={<TrendingUp className={`${iconLg} text-primary`} />}
            size={sLg}
            variant="dark"
            helpKey="mrr_growth_rate_mom"
            currentValue={growthMoM ?? undefined}
          />
          <KPICardEnhanced
            label="ARR"
            value={fmt(metrics.arr)}
            icon={<BarChart3 className={`${iconLg} text-primary`} />}
            size={sLg}
            variant="dark"
            helpKey="arr"
            trend={arrDelta.trend}
            trendValue={arrDelta.trendValue}
          />
        </div>

        {/* Linha 2 — 3 cards complementares */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 md:grid-cols-3'}`}>
          <KPICardEnhanced
            label="ARR Growth YoY"
            value={arrGrowth != null ? fmtPct(arrGrowth) : '—'}
            icon={<BarChart3 className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="arr_growth_yoy"
            currentValue={arrGrowth ?? undefined}
          />
          <KPICardEnhanced
            label="Rule of 40"
            value={fmtPts(ruleOf40)}
            icon={<Target className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="rule_of_40"
            subtitle={`growth ${fmtPct1(metrics.crescimentoPercent)} + MC ${fmtPct1(mcPercent)}`}
            currentValue={ruleOf40}
          />
          <KPICardEnhanced
            label="Growth Persistence"
            value={growthPersistence != null ? fmtPts(growthPersistence) : '—'}
            icon={<Activity className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="growth_persistence"
            subtitle={growthPersistence == null ? 'Aguardando série de 24m' : undefined}
            currentValue={growthPersistence ?? undefined}
          />
        </div>
      </section>

      {/* ═══════ BLOCO 2 — COMPOSITION ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Composition — composição do growth"
          description="De onde vem a variação do MRR"
          icon={<Sparkles className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {/* Waterfall (2/3) + ReativacoesCard (1/3) */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <NetNewMrrBreakdown
              newMrr={metrics.newMrr}
              upsellMrr={metrics.upsellMrr}
              crossSellMrr={metrics.crossSellMrr}
              reativacaoMrr={metrics.reativacaoMrr}
              reajusteMrr={metrics.reajusteMrr}
              downsellMrr={metrics.downsellMrr}
              mrrCancelado={metrics.mrrCancelado}
              netNewMrr={metrics.netNewMrr}
              tvMode={tvMode}
            />
          </div>
          <ReativacoesCard
            qtdLogos={extras?.reativacoesQtd ?? 0}
            mrrRecuperado={extras?.reativacoesMrr ?? 0}
            size={sMd}
          />
        </div>

        {/* 4 cards de qualidade do growth */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="NRR"
            value={fmtPct(metrics.nrr)}
            size={sMd}
            variant="dark"
            helpKey="nrr"
            icon={<Percent className={`${iconMd} text-current`} />}
            currentValue={metrics.nrr}
          />
          <KPICardEnhanced
            label="GRR"
            value={fmtPct(metrics.grr)}
            size={sMd}
            variant="dark"
            helpKey="grr"
            icon={<Percent className={`${iconMd} text-current`} />}
            currentValue={metrics.grr}
          />
          <KPICardEnhanced
            label="Quick Ratio"
            value={metrics.quickRatio === Infinity ? '∞' : metrics.quickRatio.toFixed(2)}
            size={sMd}
            variant="dark"
            helpKey="quick_ratio"
            icon={<Zap className={`${iconMd} text-current`} />}
            currentValue={metrics.quickRatio === Infinity ? undefined : metrics.quickRatio}
          />
          <KPICardEnhanced
            label="Expansion Rate"
            value={expansionRate != null ? fmtPct(expansionRate) : '—'}
            size={sMd}
            variant="dark"
            helpKey="expansion_rate"
            icon={<TrendingUp className={`${iconMd} text-current`} />}
            currentValue={expansionRate ?? undefined}
          />
        </div>
      </section>

      {/* ═══════ BLOCO 3 — ACQUISITION ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Acquisition — aquisição de logos"
          description="Velocidade e qualidade da entrada de novos clientes"
          icon={<UserPlus className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="Novos Clientes"
            value={(ueCurrent?.novos_clientes ?? metrics.novosClientes ?? 0).toLocaleString('pt-BR')}
            icon={<UserPlus className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="novos_clientes_mes"
          />
          <KPICardEnhanced
            label="Net Logo Growth"
            value={netLogoGrowth >= 0 ? `+${netLogoGrowth}` : `${netLogoGrowth}`}
            icon={<Users className={`${iconMd} text-current`} />}
            size={sMd}
            variant={netLogoGrowth > 0 ? 'success' : netLogoGrowth === 0 ? 'dark' : 'destructive'}
            helpKey="net_logo_growth"
            subtitle={`${ueCurrent?.novos_clientes ?? 0} novos − ${ueCurrent?.cancelados ?? 0} cancelados`}
          />
          <KPICardEnhanced
            label="Logo Growth Rate"
            value={logoGrowthRate != null ? fmtPct(logoGrowthRate) : '—'}
            icon={<Percent className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="logo_growth_rate"
            currentValue={logoGrowthRate ?? undefined}
          />
          <ARPAComboCard
            arpaNovo={extras?.arpaNovo ?? null}
            arpaBase={extras?.arpaBase ?? null}
            ratio={extras?.arpaRatio ?? null}
            size={sMd}
          />
        </div>
      </section>

      {/* ═══════ BLOCO 4 — EFFICIENCY ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Efficiency — eficiência de capital"
          description="Quanto custa e quanto rende cada R$ investido em aquisição"
          icon={<Flame className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-5'}`}>
          <KPICardEnhanced
            label="CAC por Logo"
            value={ueCurrent?.cac_por_logo_M != null ? fmt(ueCurrent.cac_por_logo_M) : '—'}
            icon={<Wallet className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="cac_por_logo"
            trend={cacDelta.trend}
            trendValue={cacDelta.trendValue}
          />
          <KPICardEnhanced
            label="CAC Payback"
            value={ueCurrent?.cac_payback_M != null && ueCurrent.cac_payback_M < 999 ? fmtMeses(ueCurrent.cac_payback_M) : '—'}
            icon={<Wallet className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="cac_payback"
            currentValue={ueCurrent?.cac_payback_M != null && ueCurrent.cac_payback_M < 999 ? ueCurrent.cac_payback_M : undefined}
            trend={paybackDelta.trend}
            trendValue={paybackDelta.trendValue}
          />
          <KPICardEnhanced
            label="LTV / CAC"
            value={ueCurrent?.ltv_cac_rec_M != null ? fmtX(ueCurrent.ltv_cac_rec_M) : '—'}
            icon={<Scale className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="ltv_cac_recorrente"
            currentValue={ueCurrent?.ltv_cac_rec_M ?? undefined}
            trend={ltvCacDelta.trend}
            trendValue={ltvCacDelta.trendValue}
          />
          <KPICardEnhanced
            label="Burn Multiple"
            value={burnMultiple != null ? fmtX(burnMultiple) : '—'}
            icon={<Flame className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="burn_multiple"
            subtitle="CAC ÷ Net New MRR"
            currentValue={burnMultiple ?? undefined}
          />
          <KPICardEnhanced
            label="Magic Number"
            value={magicNumber != null ? magicNumber.toFixed(2) : '—'}
            icon={<Divide className={`${iconMd} text-current`} />}
            size={sMd}
            variant="dark"
            helpKey="magic_number"
            subtitle="(Net New × 12) ÷ CAC"
            currentValue={magicNumber ?? undefined}
          />
        </div>
      </section>

      {/* ═══════ DIAGNÓSTICO INLINE ═══════ */}
      {diagnostico.severity !== 'ok' && (
        <section>
          <DiagnosticoInlineCard diagnostico={diagnostico} onSeeMore={() => setDiagOpen(true)} />
        </section>
      )}

      {/* ═══════ BLOCO 5 — EVOLUÇÃO TEMPORAL ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Evolução temporal · 12 meses"
          description="Tendências e projeções"
          icon={<BarChart3 className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {/* MRR Forecast + Growth Rate Bar */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          <MrrForecastChart
            series={extras?.mrrSeries24m ?? []}
            forecast={extras?.mrrForecast ?? null}
            tvMode={tvMode}
          />
          <GrowthRateBarChart
            series={extras?.mrrSeries24m ?? []}
            tvMode={tvMode}
          />
        </div>

        {/* LTV + LTV/CAC */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          <SyncedMultiLineChartCard
            title="LTV — janela mensal vs 3m vs 6m"
            data={ltvChartData}
            lines={[
              { dataKey: 'ltv_M', label: 'LTV mensal', color: 'hsl(var(--primary))' },
              { dataKey: 'ltv_3M', label: 'LTV 3m', color: 'hsl(var(--chart-2))', strokeDasharray: '5 3' },
              { dataKey: 'ltv_6M', label: 'LTV 6m', color: 'hsl(var(--chart-3))', strokeDasharray: '5 3' },
            ]}
            formatValue={(v) => `${v.toFixed(1)} meses`}
            tvMode={tvMode}
            syncId="crescimento-ltv-sync"
          />
          <SyncedMultiLineChartCard
            title="LTV/CAC — janela mensal vs 3m vs 6m"
            data={ltvCacChartData}
            lines={[
              { dataKey: 'ltv_cac_rec_M', label: 'LTV/CAC mensal', color: 'hsl(var(--primary))' },
              { dataKey: 'ltv_cac_rec_3M', label: 'LTV/CAC 3m', color: 'hsl(var(--chart-2))', strokeDasharray: '5 3' },
              { dataKey: 'ltv_cac_rec_6M', label: 'LTV/CAC 6m', color: 'hsl(var(--chart-3))', strokeDasharray: '5 3' },
            ]}
            formatValue={(v) => `${v.toFixed(2)}x`}
            tvMode={tvMode}
            syncId="crescimento-ltv-sync"
          />
        </div>

        {/* CAC Burn vs por Logo */}
        <MultiLineChartCard
          title="CAC — burn total vs por logo"
          data={cacChartData}
          lines={[
            { dataKey: 'cac_burn', label: 'CAC Burn (total)', color: 'hsl(var(--primary))' },
            { dataKey: 'cac_por_logo', label: 'CAC por Logo', color: 'hsl(var(--chart-2))', strokeDasharray: '5 3' },
          ]}
          formatValue={(v) => fmt(v)}
          tvMode={tvMode}
        />
      </section>

      {/* ═══════ COMPARATIVOS TEMPORAIS ═══════ */}
      <section className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className={`font-semibold text-foreground ${tvMode ? 'text-2xl' : 'text-lg'}`}>
              Comparativos temporais — MRR
            </h3>
            <span className="inline-flex items-center rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
              REUSO
            </span>
          </div>
          <p className="text-xs text-muted-foreground">MRR atual em 3 janelas históricas</p>
        </div>
        {vgExtras ? (
          <ComparativosTemporaisBlock
            trimestre={vgExtras.mrrTrimestre}
            semestre={vgExtras.mrrSemestre}
            ano={vgExtras.mrrAno}
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

      {/* MODAL DIAGNÓSTICO */}
      <DiagnosticoModal
        diagnostico={diagnostico}
        open={diagOpen}
        onOpenChange={setDiagOpen}
      />
    </div>
  );
}
