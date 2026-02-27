import { TrendingDown, Users, DollarSign, AlertTriangle } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { KPIMetrics, TimeSeriesData, DistributionData } from '../types';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer, Cell,
  BarChart, Bar as Bar2,
} from 'recharts';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPp = (v: number) => `${(v * 100).toFixed(2)}pp`;

interface Props {
  metrics: KPIMetrics;
  timeSeries: TimeSeriesData;
  distributions: DistributionData;
  tvMode: boolean;
}

/* ---------- helpers for delta vs previous month (inverted) ---------- */
function getChurnDeltaInverted(current: number, previous: number | null, format: 'pct' | 'pp') {
  if (previous === null || previous === undefined)
    return { trend: undefined as 'up' | 'down' | 'neutral' | undefined, trendValue: '— vs mês anterior' };

  if (format === 'pp') {
    const delta = current - previous; // both already 0..1 ratios
    const absDelta = Math.abs(delta);
    const label = `${delta <= 0 ? '▼' : '▲'} ${delta <= 0 ? '-' : '+'}${fmtPp(absDelta)} vs mês anterior`;
    // inverted: decrease = good (green/up), increase = bad (red/down)
    const trend: 'up' | 'down' | 'neutral' = delta < 0 ? 'up' : delta > 0 ? 'down' : 'neutral';
    return { trend, trendValue: label };
  }

  // percentage change
  if (previous === 0 && current === 0) return { trend: 'neutral' as const, trendValue: '0% vs mês anterior' };
  if (previous === 0) return { trend: 'down' as const, trendValue: '▲ novo vs mês anterior' };
  const pctChange = (current - previous) / Math.abs(previous);
  const absPct = Math.abs(pctChange);
  const arrow = pctChange <= 0 ? '▼' : '▲';
  const sign = pctChange <= 0 ? '-' : '+';
  const label = `${arrow} ${sign}${(absPct * 100).toFixed(1)}% vs mês anterior`;
  // inverted: decrease = good (green/up), increase = bad (red/down)
  const trend: 'up' | 'down' | 'neutral' = pctChange < 0 ? 'up' : pctChange > 0 ? 'down' : 'neutral';
  return { trend, trendValue: label };
}

/* ---------- custom tooltip for combined chart ---------- */
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

/* ---------- component ---------- */
export function CancelamentosTab({ metrics, timeSeries, distributions, tvMode }: Props) {
  const s = tvMode ? 'tv' : 'lg';

  // Previous month values from time series (index 10 = prev, 11 = current in 12-month array)
  const churnQtdArr = timeSeries.churnQtdEvolution;
  const churnMrrArr = timeSeries.churnMrrEvolution;
  const prevIdx = churnQtdArr.length >= 2 ? churnQtdArr.length - 2 : null;
  const currIdx = churnQtdArr.length >= 1 ? churnQtdArr.length - 1 : null;

  const prevChurnQtd = prevIdx !== null ? churnQtdArr[prevIdx].value : null;
  const prevChurnMrr = prevIdx !== null ? churnMrrArr[prevIdx].value : null;

  // Compute churn rates for current and previous month from time series
  // We approximate using the evolution data
  const currChurnQtd = metrics.cancelamentosQtd;
  const currMrrCancelado = metrics.mrrCancelado;
  const currChurnCarteira = metrics.cancelamentosQtd / Math.max(metrics.clientesAtivos + metrics.cancelamentosQtd, 1);
  const currChurnReceita = metrics.mrrCancelado / Math.max(metrics.mrr + metrics.mrrCancelado, 1);

  // For churn rates prev month, we need active counts from prev month - approximate from mrrEvolution
  const mrrEvo = timeSeries.mrrEvolution;
  const prevMrrPoint = prevIdx !== null && mrrEvo.length >= churnQtdArr.length ? mrrEvo[prevIdx] : null;
  const prevActiveCount = prevMrrPoint ? (Number((prevMrrPoint as any).clientesAtivos) || 0) : null;
  const prevMrr = prevMrrPoint ? prevMrrPoint.value : null;

  const prevChurnCarteiraRate = prevActiveCount !== null && prevChurnQtd !== null
    ? prevChurnQtd / Math.max(prevActiveCount + prevChurnQtd, 1)
    : null;
  const prevChurnReceitaRate = prevMrr !== null && prevChurnMrr !== null
    ? prevChurnMrr / Math.max(prevMrr + prevChurnMrr, 1)
    : null;

  const deltaQtd = getChurnDeltaInverted(currChurnQtd, prevChurnQtd, 'pct');
  const deltaMrr = getChurnDeltaInverted(currMrrCancelado, prevChurnMrr, 'pct');
  const deltaChurnCarteira = getChurnDeltaInverted(currChurnCarteira, prevChurnCarteiraRate, 'pp');
  const deltaChurnReceita = getChurnDeltaInverted(currChurnReceita, prevChurnReceitaRate, 'pp');

  // Early churn
  const hasEarlyChurn = metrics.cancelamentosEarly > 0 || metrics.mrrCanceladoEarly > 0;

  // Combined chart data
  const combinedData = churnQtdArr.map((item, i) => ({
    month: item.monthFull || item.month,
    qtd: item.value,
    mrr: churnMrrArr[i]?.value || 0,
  }));

  // Motivos data
  const motivos = distributions.porMotivoCancelamento || [];
  const maxMotivo = motivos.length > 0 ? motivos[0].value : 1;

  // Ticket médio comparison
  const ticketCancelados = metrics.cancelamentosQtd > 0 ? metrics.mrrCancelado / metrics.cancelamentosQtd : 0;
  const ticketCarteira = metrics.ticketMedio;

  return (
    <div className="space-y-6">
      {/* ===== LINHA 1: 4 KPIs com delta invertido ===== */}
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced
          label="Cancelamentos (Qtde)" value={currChurnQtd.toString()}
          icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />}
          size={s} variant="destructive"
          trend={deltaQtd.trend} trendValue={deltaQtd.trendValue}
          formula="Total de clientes que cancelaram no período selecionado"
        />
        <KPICardEnhanced
          label="MRR Cancelado" value={fmt(currMrrCancelado)}
          icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />}
          size={s} variant="destructive"
          trend={deltaMrr.trend} trendValue={deltaMrr.trendValue}
          formula="Soma das mensalidades dos clientes cancelados + reversões de movimentos"
        />
        <KPICardEnhanced
          label="Churn Rate (Carteira)" value={fmtPct(currChurnCarteira)}
          icon={<TrendingDown className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />}
          size={s} variant="destructive"
          trend={deltaChurnCarteira.trend} trendValue={deltaChurnCarteira.trendValue}
          formula="Cancelamentos ÷ (Clientes Ativos + Cancelados). % de clientes perdidos"
        />
        <KPICardEnhanced
          label="Churn Rate (Receita)" value={fmtPct(currChurnReceita)}
          icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-red-500`} />}
          size={s} variant="destructive"
          trend={deltaChurnReceita.trend} trendValue={deltaChurnReceita.trendValue}
          formula="MRR Cancelado ÷ (MRR Atual + MRR Cancelado). % de receita perdida"
        />
      </div>

      {/* ===== LINHA 2: Early Churn strip compacta ===== */}
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

      {/* ===== LINHA 3: Gráfico combinado barras + linha ===== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
            Evolução do Churn — Quantidade e MRR (12 meses)
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

      {/* ===== LINHA 4: Motivos + Ticket Médio ===== */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Barras horizontais - Cancelamentos por Motivo */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>Cancelamentos por Motivo</CardTitle>
          </CardHeader>
          <CardContent>
            {motivos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sem cancelamentos com motivo no período.</p>
            ) : (
              <div className="space-y-3">
                {motivos.map((m) => (
                  <div key={m.name} className="flex items-center gap-3">
                    <span className="text-sm text-foreground w-40 truncate shrink-0" title={m.name}>{m.name}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-400/70 dark:bg-red-500/50 transition-all"
                        style={{ width: `${Math.max((m.value / maxMotivo) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground whitespace-nowrap w-16 text-right">
                      {m.value} ({(m.percent * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ticket Médio Cancelados vs Carteira */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>Ticket Médio — Cancelados vs Carteira</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-red-500/10 dark:bg-red-900/20 border border-red-500/20 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cancelados</p>
                <p className="text-2xl font-bold text-foreground">{fmt(ticketCancelados)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 border border-border p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Carteira</p>
                <p className="text-2xl font-bold text-foreground">{fmt(ticketCarteira)}</p>
              </div>
            </div>
            <div className="flex justify-center">
              {ticketCancelados > ticketCarteira ? (
                <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">
                  ⚠️ Churns acima do ticket médio
                </Badge>
              ) : ticketCancelados < ticketCarteira ? (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/20">
                  ✅ Churns abaixo do ticket médio
                </Badge>
              ) : (
                <Badge variant="outline">Ticket médio igual</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
