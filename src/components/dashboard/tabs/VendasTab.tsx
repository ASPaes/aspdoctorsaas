import { useState, useMemo } from 'react';
import { Users, DollarSign, Rocket, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { PieChartCard } from '../charts/PieChartCard';
import { BarChartCard } from '../charts/BarChartCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import type { KPIMetrics, DistributionData, DistributionDataPoint, NovoClienteListItem } from '../types';
import { NovosClientesTable } from '../tables/NovosClientesTable';

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

interface Props { metrics: KPIMetrics; distributions: DistributionData; tvMode: boolean; novosClientesList: NovoClienteListItem[]; }

export function VendasTab({ metrics, distributions, tvMode, novosClientesList }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const [excludeHiper, setExcludeHiper] = useState(false);
  const [outrosExpanded, setOutrosExpanded] = useState(false);

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
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
        <KPICardEnhanced label="Ticket Médio (Novos)" value={metrics.novosClientes > 0 ? fmt(ticketMedioNovos) : 'N/A'} size={s} variant="primary" helpKey="ticket_medio_novos" trend={ticketD.trend} trendValue={ticketD.trendValue} />
        <KPICardEnhanced label="Setup Médio" value={metrics.novosClientes > 0 ? fmt(setupMedio) : 'N/A'} size={s} variant="primary" helpKey="setup_medio" trend={setupD.trend} trendValue={setupD.trendValue} />
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

      {/* Tabela de novos clientes */}
      <NovosClientesTable items={novosClientesList} tvMode={tvMode} />
    </div>
  );
}
