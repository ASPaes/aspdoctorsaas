import { useMemo, useState } from 'react';
import {
  TrendingDown, Users, DollarSign, AlertTriangle, BarChart3,
  Layers, Microscope, Clock, RotateCcw, Trophy, Route,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { CanceladosTable } from '../tables/CanceladosTable';
import { SectionHeader } from '../SectionHeader';

import { DiagnosticoSection, DiagnosticoModal } from '../diagnostico';

import { MotivosCategoryStackedBar } from '../charts/MotivosCategoryStackedBar';
import { MotivosBreakdownChart } from '../charts/MotivosBreakdownChart';
import { MotivosTendenciaChart } from '../charts/MotivosTendenciaChart';
import { ChurnPorSegmentoChart } from '../charts/ChurnPorSegmentoChart';
import { ChurnPorOrigemChart } from '../charts/ChurnPorOrigemChart';
import { MotivoSegmentoHeatmap } from '../charts/MotivoSegmentoHeatmap';
import { TenureBucketsChart } from '../charts/TenureBucketsChart';
import { ReativacoesCard as ReativacoesCardV2 } from '../charts/ReativacoesCard';
import { Top10CanceladosTable } from '../charts/Top10CanceladosTable';

import { useCancelamentosExtras } from '../hooks/useCancelamentosExtras';

import { computeDiagnostico, type DiagnosticoInput } from '@/lib/diagnostico';

import type { KPIMetrics, TimeSeriesData, DistributionData, CanceladoListItem, DashboardFilters } from '../types';

// ─── Formatters ──────────────────────────────────────────────
const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPp = (v: number) => `${(v * 100).toFixed(2)}pp`;

// ─── Delta helper (cores invertidas: subir = ruim) ───────────
function getChurnDeltaInverted(current: number, previous: number | null, format: 'pct' | 'pp') {
  if (previous === null || previous === undefined)
    return { trend: undefined as 'up' | 'down' | 'neutral' | undefined, trendValue: '— vs mês anterior' };

  if (format === 'pp') {
    const delta = current - previous;
    const absDelta = Math.abs(delta);
    const label = `${delta <= 0 ? '▼' : '▲'} ${delta <= 0 ? '-' : '+'}${fmtPp(absDelta)} vs mês anterior`;
    const trend: 'up' | 'down' | 'neutral' = delta < 0 ? 'up' : delta > 0 ? 'down' : 'neutral';
    return { trend, trendValue: label };
  }

  if (previous === 0 && current === 0) return { trend: 'neutral' as const, trendValue: '0% vs mês anterior' };
  if (previous === 0) return { trend: 'down' as const, trendValue: '▲ novo vs mês anterior' };
  const pctChange = (current - previous) / Math.abs(previous);
  const absPct = Math.abs(pctChange);
  const arrow = pctChange <= 0 ? '▼' : '▲';
  const sign = pctChange <= 0 ? '-' : '+';
  const label = `${arrow} ${sign}${(absPct * 100).toFixed(1)}% vs mês anterior`;
  const trend: 'up' | 'down' | 'neutral' = pctChange < 0 ? 'up' : pctChange > 0 ? 'down' : 'neutral';
  return { trend, trendValue: label };
}

// ─── Tooltip custom do gráfico combinado ─────────────────────
function CombinedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-md text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey === 'qtd' ? `Cancelamentos: ${p.value}` : `MRR Churn: ${fmt(p.value)}`}
        </p>
      ))}
    </div>
  );
}

interface Props {
  metrics: KPIMetrics;
  timeSeries: TimeSeriesData;
  distributions: DistributionData;
  tvMode: boolean;
  canceladosList: CanceladoListItem[];
  filters: DashboardFilters;
}

export function CancelamentosTab({
  metrics,
  timeSeries,
  distributions: _distributions,
  tvMode,
  canceladosList,
  filters,
}: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const iconLg = tvMode ? 'h-8 w-8' : 'h-5 w-5';
  const iconMd = tvMode ? 'h-6 w-6' : 'h-4 w-4';

  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin === true;
  const isAdminOrHead = isAdmin || profile?.role === 'head';

  const { data: cancExtras } = useCancelamentosExtras({ filters, metrics });
  

  // ─── Deltas dos 4 KPIs principais (preservado da V1) ────
  const churnQtdArr = timeSeries.churnQtdEvolution;
  const churnMrrArr = timeSeries.churnMrrEvolution;
  const prevIdx = churnQtdArr.length >= 2 ? churnQtdArr.length - 2 : null;

  const prevChurnQtd = prevIdx !== null ? churnQtdArr[prevIdx].value : null;
  const prevChurnMrr = prevIdx !== null ? churnMrrArr[prevIdx].value : null;

  const currChurnQtd = metrics.cancelamentosQtd;
  const currMrrCancelado = metrics.mrrCancelado;
  const currChurnCarteira = metrics.clientesInicioCount > 0
    ? metrics.cancelamentosQtd / metrics.clientesInicioCount
    : 0;
  const currChurnReceita = metrics.mrrInicio > 0
    ? metrics.mrrCancelado / metrics.mrrInicio
    : 0;

  const mrrEvo = timeSeries.mrrEvolution;
  const prevPrevIdx = churnQtdArr.length >= 3 ? churnQtdArr.length - 3 : null;
  const prevBasePoint = prevPrevIdx !== null && mrrEvo.length >= churnQtdArr.length ? mrrEvo[prevPrevIdx] : null;
  const prevBaseActive = prevBasePoint ? (Number((prevBasePoint as any).clientesAtivos) || 0) : null;
  const prevBaseMrr = prevBasePoint ? prevBasePoint.value : null;

  const prevChurnCarteiraRate = prevBaseActive !== null && prevBaseActive > 0 && prevChurnQtd !== null
    ? prevChurnQtd / prevBaseActive
    : null;
  const prevChurnReceitaRate = prevBaseMrr !== null && prevBaseMrr > 0 && prevChurnMrr !== null
    ? prevChurnMrr / prevBaseMrr
    : null;

  const deltaQtd = getChurnDeltaInverted(currChurnQtd, prevChurnQtd, 'pct');
  const deltaMrr = getChurnDeltaInverted(currMrrCancelado, prevChurnMrr, 'pct');
  const deltaChurnCarteira = getChurnDeltaInverted(currChurnCarteira, prevChurnCarteiraRate, 'pp');
  const deltaChurnReceita = getChurnDeltaInverted(currChurnReceita, prevChurnReceitaRate, 'pp');

  const hasEarlyChurn = metrics.cancelamentosEarly > 0 || metrics.mrrCanceladoEarly > 0;

  // ─── Diagnóstico ─────────────────────────────────────────
  const diagInput: DiagnosticoInput & Record<string, any> = useMemo(() => {
    if (!cancExtras) return { clientesAtivos: metrics.clientesAtivos };

    const motivoConcentradoPct = cancExtras.mrrCancelado > 0 && cancExtras.topMotivos.length > 0
      ? cancExtras.topMotivos[0].mrr_perdido / cancExtras.mrrCancelado
      : 0;

    const segmentoChurnMax = cancExtras.churnPorSegmento.reduce((max, seg) => {
      const base = seg.ativos + seg.cancelados;
      if (base < 5) return max;
      const rate = seg.churn_rate / 100;
      return rate > max ? rate : max;
    }, 0);

    const tendenciaSubindoFator = cancExtras.tendenciaMotivos.reduce((max, t) => {
      if (t.qtd_anterior_6m === 0) return max;
      const ratio = t.qtd_recente_6m / t.qtd_anterior_6m;
      return ratio > max ? ratio : max;
    }, 0);

    const winbackTotal12m = cancExtras.reativacoes12m.reduce((sum, r) => sum + r.qtd, 0);

    const mortalidadeQtdPct = cancExtras.cancelamentosQtd > 0
      ? cancExtras.categorias.mortality.qtd / cancExtras.cancelamentosQtd
      : 0;

    // Maior churn rate entre origens com sample mínimo (≥3 cancelamentos)
    const origemMaxChurn = cancExtras.cancelamentosPorOrigem.reduce((max, o) => {
      if (o.qtd_cancelamentos < 3) return max;
      const rate = o.churn_rate / 100; // RPC retorna em %, normalizar pra decimal
      return rate > max ? rate : max;
    }, 0);

    return {
      mrr: metrics.mrr,
      mrrCancelado: cancExtras.mrrCancelado,
      cancelamentosQtd: cancExtras.cancelamentosQtd,
      clientesAtivos: metrics.clientesAtivos,
      earlyChurnRate: cancExtras.earlyChurnRate,
      motivoConcentradoPct,
      segmentoChurnMax,
      tendenciaSubindoFator,
      winbackTotal12m,
      mortalidadeQtdPct,
      origemMaxChurn,
      cancelamentosPorOrigem: cancExtras.cancelamentosPorOrigem,
    };
  }, [cancExtras, metrics]);

  const diagnostico = useMemo(() => computeDiagnostico(diagInput, 'cancelamentos'), [diagInput]);
  const [diagOpen, setDiagOpen] = useState(false);

  // ─── Dados do gráfico combinado (preservado V1) ──────────
  const combinedData = useMemo(() =>
    churnQtdArr.map((item, i) => ({
      month: item.monthFull || item.month,
      qtd: item.value,
      mrr: churnMrrArr[i]?.value || 0,
    })),
    [churnQtdArr, churnMrrArr]
  );

  const tabLabel = useMemo(() => {
    const now = new Date();
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `Cancelamentos · ${meses[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

  return (
    <div className="space-y-8">
      {/* ═══════ BLOCO 1 — MAGNITUDE ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Magnitude do churn"
          description="Quanto perdemos no período — clientes, MRR e taxas"
          icon={<TrendingDown className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
          <KPICardEnhanced
            label="Cancelamentos (Qtde)" value={currChurnQtd.toString()}
            icon={<Users className={`${iconLg} text-red-500`} />}
            size={s} variant="destructive"
            trend={deltaQtd.trend} trendValue={deltaQtd.trendValue}
            helpKey="cancelamentos_qtd"
          />
          <KPICardEnhanced
            label="MRR Cancelado" value={fmt(currMrrCancelado)}
            icon={<DollarSign className={`${iconLg} text-red-500`} />}
            size={s} variant="destructive"
            trend={deltaMrr.trend} trendValue={deltaMrr.trendValue}
            helpKey="mrr_cancelado"
          />
          <KPICardEnhanced
            label="Churn Rate (Carteira)" value={fmtPct(currChurnCarteira)}
            icon={<TrendingDown className={`${iconLg} text-red-500`} />}
            size={s} variant="destructive"
            trend={deltaChurnCarteira.trend} trendValue={deltaChurnCarteira.trendValue}
            helpKey="churn_rate_carteira"
          />
          <KPICardEnhanced
            label="Churn Rate (Receita)" value={fmtPct(currChurnReceita)}
            icon={<DollarSign className={`${iconLg} text-red-500`} />}
            size={s} variant="destructive"
            trend={deltaChurnReceita.trend} trendValue={deltaChurnReceita.trendValue}
            helpKey="churn_rate_receita"
          />
        </div>

        {/* Early Churn strip */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2.5 min-h-[48px]">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span className="text-sm font-medium text-muted-foreground">Early Churn (≤90 dias após cadastro)</span>
          {hasEarlyChurn ? (
            <span className="text-sm text-foreground">
              Qtde: <strong>{metrics.cancelamentosEarly}</strong>
              <span className="mx-2 text-muted-foreground">|</span>
              MRR: <strong>{fmt(metrics.mrrCanceladoEarly)}</strong>
              <span className="mx-2 text-muted-foreground">|</span>
              Rate: <strong>{fmtPct(metrics.earlyChurnRate)}</strong>
            </span>
          ) : (
            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              ✅ Nenhum early churn no período
            </Badge>
          )}
        </div>
      </section>

      {/* ═══════ BLOCO 1.5 — EVOLUÇÃO TEMPORAL 12M (REUSO V1) ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Evolução temporal · 12 meses"
          description="Cancelamentos e MRR perdido mês a mês"
          icon={<BarChart3 className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
              Cancelamentos — Quantidade vs MRR Churn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={tvMode ? 400 : 300}>
              <ComposedChart data={combinedData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickFormatter={(v: number) => {
                    if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
                    return v.toString();
                  }}
                />
                <RTooltip content={<CombinedTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  formatter={(value: string) => value === 'qtd' ? 'Qtde Cancelamentos' : 'MRR Churn (R$)'}
                />
                <Bar yAxisId="left" dataKey="qtd" fill="hsl(var(--destructive))" opacity={0.7} radius={[4, 4, 0, 0]} barSize={28} />
                <Line yAxisId="right" dataKey="mrr" stroke="hsl(30, 90%, 55%)" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      {/* ═══════ BLOCO 2 — COMPOSIÇÃO ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Composição do churn"
          description="Categorias, motivos e tendências de evolução"
          icon={<Layers className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {cancExtras ? (
          <>
            <MotivosCategoryStackedBar categorias={cancExtras.categorias} tvMode={tvMode} />
            <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
              <MotivosBreakdownChart topMotivos={cancExtras.topMotivos} tvMode={tvMode} />
              <MotivosTendenciaChart tendenciaMotivos={cancExtras.tendenciaMotivos} tvMode={tvMode} />
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-32" />
            <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          </>
        )}
      </section>


      {/* ═══════ BLOCO 3 — SEGMENTAÇÃO ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Onde está a dor"
          description="Churn por segmento e correlações motivo × segmento"
          icon={<Microscope className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {cancExtras ? (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <ChurnPorSegmentoChart churnPorSegmento={cancExtras.churnPorSegmento} tvMode={tvMode} />
            <MotivoSegmentoHeatmap heatmapMotivoSegmento={cancExtras.heatmapMotivoSegmento} tvMode={tvMode} />
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        )}
      </section>

      {/* ═══════ BLOCO 3.5 — ORIGEM DE AQUISIÇÃO ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Origem de aquisição dos cancelados"
          description="Que canais trazem cliente que cancela mais — atribuído à origem do primeiro produto vendido"
          icon={<Route className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {cancExtras ? (
          <ChurnPorOrigemChart
            cancelamentosPorOrigem={cancExtras.cancelamentosPorOrigem}
            tvMode={tvMode}
          />
        ) : (
          <Skeleton className="h-80" />
        )}
      </section>

      {/* ═══════ BLOCO 4 — COHORT DE SAÍDA ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Cohort de saída — tenure"
          description="Quanto tempo ficaram ativos antes de cancelar"
          icon={<Clock className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {cancExtras ? (
          <TenureBucketsChart
            buckets={cancExtras.buckets}
            earlyChurnRate={cancExtras.earlyChurnRate}
            tvMode={tvMode}
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </section>

      {/* ═══════ BLOCO 5 — WIN-BACK + TOP 10 ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Recuperação e maiores perdas"
          description="Reativações no período e top 10 cancelados por MRR"
          icon={<RotateCcw className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />

        {cancExtras ? (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <ReativacoesCardV2
              reativacoesQtd={cancExtras.reativacoesQtd}
              mrrReativado={cancExtras.mrrReativado}
              winbackRate12m={cancExtras.winbackRate12m}
              reativacoes12m={cancExtras.reativacoes12m}
              tvMode={tvMode}
            />
            <Top10CanceladosTable top10Cancelados={cancExtras.top10Cancelados} tvMode={tvMode} />
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        )}
      </section>

      {/* ═══════ DIAGNÓSTICO ═══════ */}
      <DiagnosticoSection
        diagnostico={diagnostico}
        onSeeMore={() => setDiagOpen(true)}
        tvMode={tvMode}
      />


      {/* ═══════ BLOCO 8 — TABELA COMPLETA (REUSO V1) ═══════ */}
      <section className="space-y-3">
        <SectionHeader
          title="Lista completa de cancelados"
          description="Todos os cancelamentos do período filtrado"
          icon={<Trophy className={`${iconMd} text-primary`} />}
          tvMode={tvMode}
        />
        <CanceladosTable items={canceladosList} tvMode={tvMode} />
      </section>


      {/* MODAL DIAGNÓSTICO */}
      <DiagnosticoModal
        diagnostico={diagnostico}
        open={diagOpen}
        onOpenChange={setDiagOpen}
        tabLabel={tabLabel}
        tenantId={effectiveTenantId || undefined}
        tabKey="cancelamentos"
        diagInput={diagInput as Record<string, any>}
        filtrosAplicados={{
          unidadeBaseId: filters.unidadeBaseId,
          fornecedorId: filters.fornecedorId,
          periodoInicio: filters.periodoInicio,
          periodoFim: filters.periodoFim,
        }}
        isAdmin={isAdmin}
        isAdminOrHead={isAdminOrHead}
      />
    </div>
  );
}
