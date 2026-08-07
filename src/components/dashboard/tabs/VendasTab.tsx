import { useState, useMemo } from 'react';
import { Users, DollarSign, Rocket, TrendingUp, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '../SectionHeader';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ComposedChart, Line, LabelList,
} from 'recharts';
import type { KPIMetrics, DistributionData, DistributionDataPoint, NovoClienteListItem, DashboardFilters } from '../types';
import { NovosClientesTable } from '../tables/NovosClientesTable';
import { useVendasExplorer, useVendasSerie, useVendasProdutos, useVendasTicketStats } from '../hooks/useVendasExtras';
import { DiagnosticoModal } from '../diagnostico';
import { computeDiagnostico, type DiagnosticoInput } from '@/lib/diagnostico';
import { resolveMesAlvo, computeComparativoMensal } from '@/lib/diagnostico/comparativos';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const DONUT_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
];
const OUTROS_COLOR = 'hsl(var(--muted-foreground))';

function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  invertColors = false,
  format: 'pct' | 'abs' | 'currency' = 'pct',
): { trend?: 'up' | 'down'; trendValue?: string } {
  if (current == null || previous == null) {
    return { trendValue: '— vs mês anterior' };
  }
  const diff = current - previous;
  if (diff === 0) return { trendValue: '— vs mês anterior' };

  const direction = diff > 0 ? 'up' : 'down';
  const visualTrend = invertColors ? (direction === 'up' ? 'down' : 'up') : direction;
  const arrow = diff > 0 ? '▲' : '▼';

  let formatted: string;
  if (format === 'abs') {
    formatted = `${diff > 0 ? '+' : ''}${diff}`;
  } else if (format === 'currency') {
    formatted = `${diff > 0 ? '+' : ''}${fmt(diff)}`;
  } else {
    if (previous === 0) return { trendValue: '— vs mês anterior' };
    const pct = (diff / Math.abs(previous)) * 100;
    formatted = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  return {
    trend: visualTrend as 'up' | 'down',
    trendValue: `${arrow} ${formatted} vs mês anterior`,
  };
}

interface Props { metrics: KPIMetrics; distributions: DistributionData; tvMode: boolean; novosClientesList: NovoClienteListItem[]; filters: DashboardFilters; }

export function VendasTab({ metrics, distributions, tvMode, novosClientesList, filters }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin === true;
  const isAdminOrHead = isAdmin || profile?.role === 'head';
  const [diagOpen, setDiagOpen] = useState(false);
  const [excludeHiper, setExcludeHiper] = useState(false);
  const [outrosExpanded, setOutrosExpanded] = useState(false);
  const [expMetric, setExpMetric] = useState<'vendas'|'mrr'|'ticket'|'margem_rs'|'margem_pct'>('mrr');
  const [expDim, setExpDim] = useState('vendedor');
  const [faixaDet, setFaixaDet] = useState(false);
  const [ticketMetric, setTicketMetric] = useState<'qtd'|'mrr'>('qtd');
  const { data: breakdown = [] } = useVendasExplorer(filters, expDim);

  const margemRsTotal = breakdown.reduce((a, r) => a + (r.margem_rs || 0), 0);
  const newMrrTotal = breakdown.reduce((a, r) => a + (r.new_mrr || 0), 0);
  const margemPctTotal = newMrrTotal > 0 ? margemRsTotal / newMrrTotal : 0;

  // Série estendida (14m) + comparativo mensal p/ o diagnóstico de Vendas
  const { data: serieDiag = [] } = useVendasSerie(filters, 14);
  const vendasComp = useMemo(() => {
    const hoje = new Date();
    const { mesAlvoKey, tipo } = resolveMesAlvo(filters.periodoInicio, filters.periodoFim, filters.showAllData, hoje);
    const cQtd = computeComparativoMensal(serieDiag.map((r) => ({ mes: r.mes, value: r.qtd })), mesAlvoKey, tipo, hoje);
    const cMrr = computeComparativoMensal(serieDiag.map((r) => ({ mes: r.mes, value: r.new_mrr })), mesAlvoKey, tipo, hoje);
    const cTicket = computeComparativoMensal(serieDiag.map((r) => ({ mes: r.mes, value: r.ticket })), mesAlvoKey, tipo, hoje);
    return { cQtd, cMrr, cTicket };
  }, [serieDiag, filters.periodoInicio, filters.periodoFim, filters.showAllData]);

  const diagInput: DiagnosticoInput = useMemo(() => ({
    newMrr: metrics.newMrr,
    upsellMrr: metrics.upsellMrr,
    crossSellMrr: metrics.crossSellMrr,
    clientesAtivos: metrics.clientesAtivos,
    // extras de vendas (consumidos pelo Conselho DS via tabKey="vendas")
    novos_clientes: metrics.novosClientes,
    ticket_medio_novo: metrics.novosClientes > 0 ? metrics.newMrr / metrics.novosClientes : 0,
    receita_ativacao: metrics.receitaAtivacao,
    setup_medio: metrics.novosClientes > 0 ? metrics.totalImplantacao / metrics.novosClientes : 0,
    mrr_adicionado: metrics.newMrr + metrics.upsellMrr + metrics.crossSellMrr,
    margem_nova_rs: margemRsTotal,
    margem_nova_pct: margemPctTotal,
    // comparativo mensal (Passo 1)
    vendasComparavel: vendasComp.cQtd.confiavel,
    vendasEhMesCorrente: vendasComp.cQtd.ehMesCorrente,
    comparativoIndeterminado: !vendasComp.cQtd.confiavel,
    vendasQtdAtual: vendasComp.cQtd.atual ?? undefined,
    vendasQtdProj: vendasComp.cQtd.projecao ?? undefined,
    vendasQtdMedia3m: vendasComp.cQtd.media3m ?? undefined,
    vendasQtdYoY: vendasComp.cQtd.yoy ?? undefined,
    vendasMrrAtual: vendasComp.cMrr.atual ?? undefined,
    vendasMrrProj: vendasComp.cMrr.projecao ?? undefined,
    vendasMrrMedia3m: vendasComp.cMrr.media3m ?? undefined,
    vendasMrrYoY: vendasComp.cMrr.yoy ?? undefined,
    vendasTicketAtual: vendasComp.cTicket.atual ?? undefined,
    vendasTicketMedia3m: vendasComp.cTicket.media3m ?? undefined,
  } as any), [metrics, margemRsTotal, margemPctTotal, vendasComp]);

  const diagnostico = useMemo(() => computeDiagnostico(diagInput, 'vendas'), [diagInput]);

  const tabLabel = useMemo(() => {
    const now = new Date();
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `Vendas · ${meses[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

  // Deltas
  const novosD = computeDelta(metrics.novosClientes, metrics.prevNovosClientes, false, 'abs');
  const newMrrD = computeDelta(metrics.newMrr, metrics.prevNewMrr);
  const ativacaoD = computeDelta(metrics.receitaAtivacao, metrics.prevTotalImplantacao);
  const mrrAdicionado = metrics.newMrr + metrics.upsellMrr + metrics.crossSellMrr;
  const prevMrrAdicionado = (metrics.prevNewMrr ?? 0) + (metrics.prevUpsellMrr ?? 0) + (metrics.prevCrossSellMrr ?? 0);
  const mrrAddD = computeDelta(mrrAdicionado, metrics.prevNewMrr != null ? prevMrrAdicionado : null);

  const ticketMedioNovos = metrics.novosClientes > 0 ? metrics.newMrr / metrics.novosClientes : 0;
  const prevTicketMedio = (metrics.prevNovosClientes ?? 0) > 0 ? (metrics.prevNewMrr ?? 0) / (metrics.prevNovosClientes ?? 1) : null;
  const ticketD = computeDelta(ticketMedioNovos, prevTicketMedio);

  const setupMedio = metrics.novosClientes > 0 ? metrics.totalImplantacao / metrics.novosClientes : 0;
  const prevSetup = (metrics.prevNovosClientes ?? 0) > 0 ? (metrics.prevTotalImplantacao ?? 0) / (metrics.prevNovosClientes ?? 1) : null;
  const setupD = computeDelta(setupMedio, prevSetup);

  // Top 5 + Outros for donut
  const origemData = distributions.porOrigemVendaNovos || distributions.porOrigemVenda;
  const { top5, outros, outrosDetail } = useMemo(() => {
    const sorted = [...origemData].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const outrosValue = rest.reduce((s, d) => s + d.value, 0);
    const total = sorted.reduce((s, d) => s + d.value, 0) || 1;
    const outrosPercent = total > 0 ? outrosValue / total : 0;
    return {
      top5: top.map(d => ({ ...d, percent: total > 0 ? d.value / total : 0 })),
      outros: rest.length > 0 ? { name: 'Outros', value: outrosValue, percent: outrosPercent } : null,
      outrosDetail: rest.map(d => ({ ...d, percent: total > 0 ? d.value / total : 0 })),
    };
  }, [origemData]);

  const donutData = outros ? [...top5, outros] : top5;

  // Fornecedores with Hiper toggle
  const fornecedorData = useMemo(() => {
    const src = distributions.porFornecedorNovos || distributions.porFornecedor;
    if (!excludeHiper) return src;
    const filtered = src.filter(d => !d.name.toLowerCase().includes('hiper'));
    const total = filtered.reduce((s, d) => s + d.value, 0) || 1;
    return filtered.map(d => ({ ...d, percent: d.value / total }));
  }, [distributions, excludeHiper]);

  // Evolução e sazonalidade (12 meses)
  const { data: serie = [] } = useVendasSerie(filters, 12);
  const mesLabel = (m: string) => ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][parseInt(m.slice(5,7),10)-1] || '';
  const serieData = serie.map(r => ({ mes: mesLabel(r.mes), new_mrr: r.new_mrr, ticket: r.ticket, qtd: r.qtd }));
  const qtdMax = Math.max(1, ...serie.map(r => r.qtd));

  // Ranking, faixas de ticket e mix de produto
  const { data: rankVend = [] } = useVendasExplorer(filters, 'vendedor');
  const { data: faixas = [] } = useVendasExplorer(filters, faixaDet ? 'faixa_ticket_det' : 'faixa_ticket');
  const { data: ticketStats } = useVendasTicketStats(filters);
  const { data: mixProd = [] } = useVendasProdutos(filters);
  const totalVendMrr = rankVend.reduce((a, r) => a + (r.new_mrr || 0), 0) || 1;
  const FAIXA_ORDER_PADRAO = ['Até R$ 200', 'R$ 200–500', 'R$ 500–1k', 'Acima de R$ 1k'];
  const FAIXA_ORDER_DET = ['Até R$ 100','R$ 100–200','R$ 200–300','R$ 300–500','R$ 500–1k','R$ 1k–2k','Acima de R$ 2k'];
  const faixaOrder = faixaDet ? FAIXA_ORDER_DET : FAIXA_ORDER_PADRAO;
  const faixasOrd = faixaOrder.map(l => faixas.find(f => f.label === l)).filter(Boolean) as typeof faixas;
  const ticketVal = (f: any) => ticketMetric === 'qtd' ? f.qtd : f.new_mrr;
  const faixaMax = Math.max(1, ...faixasOrd.map(ticketVal));
  const mixTop = [...mixProd].sort((a, b) => b.new_mrr - a.new_mrr).slice(0, 10);
  const mixMax = Math.max(1, ...mixTop.map(p => p.new_mrr));
  const margemCls = (p: number) => p >= 0.5 ? 'text-green-500' : p >= 0.3 ? 'text-amber-500' : 'text-red-500';


  return (
    <div className="space-y-6">
      {/* KPIs Row 1 */}
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Novos Clientes" value={metrics.novosClientes.toString()} icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" helpKey="novos_clientes_vendas" trend={novosD.trend} trendValue={novosD.trendValue} />
        <KPICardEnhanced label="New MRR" value={fmt(metrics.newMrr)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" helpKey="new_mrr_vendas" trend={newMrrD.trend} trendValue={newMrrD.trendValue} />
        <KPICardEnhanced label="Receita de Ativação" value={fmt(metrics.receitaAtivacao)} icon={<Rocket className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" helpKey="receita_ativacao" trend={ativacaoD.trend} trendValue={ativacaoD.trendValue} />
        <KPICardEnhanced label="MRR Adicionado" value={fmt(mrrAdicionado)} icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" helpKey="mrr_adicionado" trend={mrrAddD.trend} trendValue={mrrAddD.trendValue} />
      </div>

      {/* KPIs Row 2 */}
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Ticket Médio (Novos)" value={metrics.novosClientes > 0 ? fmt(ticketMedioNovos) : 'N/A'} size={s} variant="primary" helpKey="ticket_medio_novos" trend={ticketD.trend} trendValue={ticketD.trendValue} />
        <KPICardEnhanced label="Setup Médio" value={metrics.novosClientes > 0 ? fmt(setupMedio) : 'N/A'} size={s} variant="primary" helpKey="setup_medio" trend={setupD.trend} trendValue={setupD.trendValue} />
        <KPICardEnhanced label="Margem nova (R$)" value={fmt(margemRsTotal)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" helpKey="margem_nova_rs" />
        <KPICardEnhanced label="Margem % nova" value={`${Math.round(margemPctTotal * 100)}%`} icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" helpKey="margem_pct_nova" />
      </div>

      {/* Evolução de vendas — 12 meses */}
      <Card>
        <CardHeader className={tvMode ? 'pb-2' : ''}>
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Evolução de vendas — 12 meses</CardTitle>
          <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>O número acima de cada barra é a quantidade de vendas do mês.</p>
        </CardHeader>
        <CardContent>
          {serieData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground">Sem dados disponíveis</div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serieData} margin={{ top: 22, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="mes" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <YAxis yAxisId="l" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                  <RechartsTooltip
                    cursor={{ fill: 'hsl(var(--muted) / 0.35)' }}
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload;
                      return (
                        <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg">
                          <div className={cn('font-medium text-foreground mb-1.5', tvMode ? 'text-base' : 'text-xs')}>{label}</div>
                          <div className={cn('space-y-1', tvMode ? 'text-sm' : 'text-xs')}>
                            <div className="flex items-center justify-between gap-6">
                              <span className="text-muted-foreground">Vendas</span>
                              <span className="font-semibold text-foreground tabular-nums">{row.qtd ?? 0}</span>
                            </div>
                            <div className="flex items-center justify-between gap-6">
                              <span className="text-muted-foreground">New MRR</span>
                              <span className="font-semibold text-primary tabular-nums">{fmt(row.new_mrr || 0)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-6">
                              <span className="text-muted-foreground">Ticket médio</span>
                              <span className="font-semibold tabular-nums" style={{ color: 'hsl(var(--chart-2, 199 89% 48%))' }}>{fmt(row.ticket || 0)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: tvMode ? 14 : 11 }} />
                  <Bar yAxisId="l" dataKey="new_mrr" name="New MRR" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="qtd"
                      position="top"
                      offset={6}
                      fill="hsl(var(--muted-foreground))"
                      fontSize={tvMode ? 14 : 11}
                      formatter={(v: number) => (v > 0 ? String(v) : '')}
                    />
                  </Bar>
                  <Line yAxisId="r" dataKey="ticket" name="Ticket médio" stroke="hsl(var(--chart-2, 199 89% 48%))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Explorador — métrica × dimensão */}
      {(() => {
        const METRICS: { id: typeof expMetric; label: string }[] = [
          { id: 'vendas', label: 'Nº de vendas' },
          { id: 'mrr', label: 'New MRR' },
          { id: 'ticket', label: 'Ticket médio' },
          { id: 'margem_rs', label: 'Margem R$' },
          { id: 'margem_pct', label: 'Margem %' },
        ];
        const DIMS = [
          { id: 'vendedor', label: 'Vendedor' },
          { id: 'canal', label: 'Canal' },
          { id: 'fornecedor', label: 'Fornecedor' },
          { id: 'segmento', label: 'Segmento' },
          { id: 'area', label: 'Área' },
          { id: 'uf', label: 'UF' },
          { id: 'cidade', label: 'Cidade' },
          { id: 'unidade', label: 'Unidade' },
        ];
        const expValue = (r: any) =>
          expMetric === 'vendas' ? r.qtd
          : expMetric === 'mrr' ? r.new_mrr
          : expMetric === 'ticket' ? r.ticket
          : expMetric === 'margem_rs' ? r.margem_rs
          : Math.round((r.margem_pct || 0) * 100);
        const expData = [...breakdown]
          .sort((a, b) => expValue(b) - expValue(a))
          .slice(0, 12)
          .map(r => ({ label: r.label, value: expValue(r) }));
        const formatVal = (v: number) =>
          expMetric === 'margem_pct' ? `${v}%`
          : expMetric === 'vendas' ? String(Math.round(v))
          : fmt(v);
        const chipCls = (active: boolean) => cn(
          'px-3 py-1.5 rounded-full text-xs border transition-colors',
          active
            ? 'bg-primary/10 border-primary text-primary'
            : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
        );
        return (
          <Card>
            <CardHeader className={tvMode ? 'pb-2' : ''}>
              <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Explorador — métrica × dimensão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {METRICS.map(m => (
                  <button key={m.id} onClick={() => setExpMetric(m.id)} className={chipCls(expMetric === m.id)}>{m.label}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {DIMS.map(d => (
                  <button key={d.id} onClick={() => setExpDim(d.id)} className={chipCls(expDim === d.id)}>{d.label}</button>
                ))}
              </div>
              {expData.length === 0 ? (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sem dados disponíveis</div>
              ) : (
                <div style={{ height: tvMode ? 420 : 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={expData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 110 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis type="number" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" tickFormatter={(v) => formatVal(Number(v))} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: tvMode ? 14 : 11 }} width={110} className="fill-muted-foreground" />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }}
                        formatter={(value: number, _: string, props: any) => [formatVal(value), props.payload.label]}
                      />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={tvMode ? 36 : 28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Ranking de vendedores */}
      <Card>
        <CardHeader className={tvMode ? 'pb-2' : ''}>
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Ranking de vendedores</CardTitle>
        </CardHeader>
        <CardContent>
          {rankVend.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">Sem dados disponíveis</div>
          ) : (
            <div className="space-y-2">
              {[...rankVend].sort((a, b) => b.new_mrr - a.new_mrr).slice(0, 10).map((r, i) => {
                const pct = Math.round(r.new_mrr / totalVendMrr * 100);
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-t border-border first:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm">
                        <span className="truncate">{r.label}</span>
                        <span className="text-muted-foreground">{r.qtd} vendas · {fmt(r.new_mrr)} · <span className={margemCls(r.margem_pct)}>{Math.round(r.margem_pct * 100)}%</span></span>
                      </div>
                      <div className="h-1.5 bg-muted rounded mt-1 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sazonalidade */}
      <Card>
        <CardHeader className={tvMode ? 'pb-2' : ''}>
          <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Sazonalidade — vendas por mês</CardTitle>
        </CardHeader>
        <CardContent>
          {serie.length === 0 ? (
            <div className="flex items-center justify-center h-[120px] text-muted-foreground">Sem dados disponíveis</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                {serie.map((r, i) => {
                  const t = r.qtd / qtdMax;
                  return (
                    <div
                      key={i}
                      style={{
                        backgroundColor: `hsl(var(--primary) / ${(0.2 + 0.8 * t).toFixed(2)})`,
                        borderRadius: 6,
                        padding: '8px 4px',
                        textAlign: 'center',
                      }}
                    >
                      <div className="text-[11px] text-foreground/80">{mesLabel(r.mes)}</div>
                      <div className="text-sm font-medium text-foreground">{r.qtd}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Intensidade = volume de vendas no mês.</div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Distribuição de ticket + Mix de produto */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className={tvMode ? 'pb-2' : ''}>
            <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Distribuição de ticket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex gap-1">
                {([['Padrão', false], ['Detalhado', true]] as const).map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => setFaixaDet(val)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs border',
                      faixaDet === val
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    style={{ borderWidth: '0.5px' }}
                  >{label}</button>
                ))}
              </div>
              <div className="flex gap-1">
                {([['Qtd', 'qtd'], ['R$', 'mrr']] as const).map(([label, val]) => (
                  <button
                    key={val}
                    onClick={() => setTicketMetric(val)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs border',
                      ticketMetric === val
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    style={{ borderWidth: '0.5px' }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {ticketStats && (
              <div className="space-y-1">
                <div className="text-sm"><span className="font-medium">Mediana {fmt(ticketStats.mediana)}</span> · típico {fmt(ticketStats.p25)}–{fmt(ticketStats.p75)} · faixa {fmt(ticketStats.minimo)}–{fmt(ticketStats.maximo)}</div>
                <div className="text-xs text-muted-foreground">Média {fmt(ticketStats.media)} — puxada por vendas de ticket alto quando difere muito da mediana</div>
              </div>
            )}

            {faixasOrd.length === 0 ? (
              <div className="flex items-center justify-center h-[180px] text-muted-foreground">Sem dados disponíveis</div>
            ) : (
              <div className="space-y-3">
                {faixasOrd.map((f, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1"><span>{f.label}</span><span className="text-muted-foreground">{f.qtd} · {fmt(f.new_mrr)}</span></div>
                    <div className="h-2 bg-muted rounded overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round(ticketVal(f) / faixaMax * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className={tvMode ? 'pb-2' : ''}>
            <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Mix de produto (por item vendido)</CardTitle>
          </CardHeader>
          <CardContent>
            {mixTop.length === 0 ? (
              <div className="flex items-center justify-center h-[180px] text-muted-foreground">Sem dados disponíveis</div>
            ) : (
              <div className="space-y-3">
                {mixTop.map((p, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1"><span className="truncate">{p.label}</span><span className="text-muted-foreground">{p.qtd} · {fmt(p.new_mrr)} · <span className={margemCls(p.margem_pct)}>{Math.round(p.margem_pct * 100)}%</span></span></div>
                    <div className="h-2 bg-muted rounded overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round(p.new_mrr / mixMax * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">

        {/* Donut — Top 5 + Outros */}
        <Card>
          <CardHeader className={tvMode ? 'pb-2' : ''}>
            <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>Vendas por Origem (no período)</CardTitle>
          </CardHeader>
          <CardContent>
            {donutData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sem dados disponíveis</div>
            ) : (
              <>
                <div style={{ height: tvMode ? 390 : 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={tvMode ? 60 : 40}
                        outerRadius={tvMode ? 120 : 80}
                        dataKey="value"
                        paddingAngle={2}
                        labelLine={false}
                        label={({ percent }) => percent < 0.05 ? null : `${(percent * 100).toFixed(0)}%`}
                      >
                        {donutData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.name === 'Outros' ? OUTROS_COLOR : DONUT_COLORS[i % DONUT_COLORS.length]}
                            stroke="hsl(var(--background))"
                            strokeWidth={2}
                            cursor={entry.name === 'Outros' ? 'pointer' : 'default'}
                            onClick={() => entry.name === 'Outros' && setOutrosExpanded(!outrosExpanded)}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }}
                        formatter={(value: number, _: string, props: any) => [`${value} (${(props.payload.percent * 100).toFixed(1)}%)`, props.payload.name]}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ fontSize: tvMode ? 14 : 11 }}
                        formatter={(value) => {
                          const item = donutData.find(d => d.name === value);
                          return (
                            <span className="text-foreground">
                              {value.length > 18 ? value.substring(0, 18) + '...' : value}
                              {item && ` — ${item.value} (${(item.percent * 100).toFixed(1)}%)`}
                            </span>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Outros expandable */}
                {outros && (
                  <div className="mt-2">
                    <button
                      onClick={() => setOutrosExpanded(!outrosExpanded)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {outrosExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {outrosExpanded ? 'Ocultar detalhamento' : `Ver detalhamento de "Outros" (${outrosDetail.length})`}
                    </button>
                    {outrosExpanded && (
                      <div className="mt-2 space-y-1 border-t pt-2">
                        {outrosDetail.map((d, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{d.name}</span>
                            <span className="font-medium">{d.value} ({(d.percent * 100).toFixed(1)}%)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Fornecedores with Hiper toggle */}
        <div>
          <Card>
            <CardHeader className={cn(tvMode ? 'pb-2' : '', 'flex flex-row items-center justify-between')}>
              <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>
                {excludeHiper ? 'Top Fornecedores — excluindo Hiper Software' : 'Vendas por Fornecedor (no período)'}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="hiper-toggle" className="text-xs text-muted-foreground cursor-pointer">Excluir Hiper</Label>
                <Switch id="hiper-toggle" checked={excludeHiper} onCheckedChange={setExcludeHiper} />
              </div>
            </CardHeader>
            <CardContent>
              {fornecedorData.length === 0 ? (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sem dados disponíveis</div>
              ) : (
                <div style={{ height: tvMode ? 400 : 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fornecedorData.map(d => ({ ...d, displayName: d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name }))} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis type="number" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
                      <YAxis type="category" dataKey="displayName" tick={{ fontSize: tvMode ? 14 : 11 }} width={80} className="fill-muted-foreground" />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }}
                        formatter={(value: number, _: string, props: any) => [`${value} (${(props.payload.percent * 100).toFixed(1)}%)`, props.payload.name]}
                      />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={tvMode ? 40 : 30} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══════ CONSELHO DOCTOR SAAS ═══════ */}
      <section>
        <SectionHeader
          title="Conselho DOCTOR SAAS"
          description="Análise estratégica das suas vendas pelo Conselho DS"
          icon={<Sparkles className="h-5 w-5 text-primary" />}
          tvMode={tvMode}
        />
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Receba uma análise estratégica das suas vendas no período, feita pelo Conselho DS com base nos seus indicadores reais.
            </p>
            <Button onClick={() => setDiagOpen(true)} className="shrink-0">
              <Sparkles className="h-4 w-4" />
              Abrir Conselho DS
            </Button>
          </CardContent>
        </Card>
      </section>


      {/* Tabela de novos clientes */}
      <NovosClientesTable items={novosClientesList} tvMode={tvMode} />

      {/* MODAL DIAGNÓSTICO */}
      <DiagnosticoModal
        diagnostico={diagnostico}
        open={diagOpen}
        onOpenChange={setDiagOpen}
        tabLabel={tabLabel}
        tenantId={effectiveTenantId || undefined}
        tabKey="vendas"
        diagInput={diagInput as Record<string, any>}
        filtrosAplicados={{
          unidadeBaseId: filters.unidadeBaseId,
          fornecedorIds: filters.fornecedorIds,
          periodoInicio: filters.periodoInicio,
          periodoFim: filters.periodoFim,
        }}
        isAdmin={isAdmin}
        isAdminOrHead={isAdminOrHead}
      />
    </div>
  );
}
