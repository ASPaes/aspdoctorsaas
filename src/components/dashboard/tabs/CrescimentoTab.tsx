import { useState } from 'react';
import { TrendingUp, Clock, DollarSign, Divide, Calculator, Users, Percent, BarChart3, Shield, ChevronDown, Bug } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { MultiLineChartCard } from '../charts/MultiLineChartCard';
import { NetNewMrrBreakdown } from '../cards/NetNewMrrBreakdown';
import { SectionHeader } from '../SectionHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useUnitEconomicsSeries } from '../hooks/useUnitEconomicsSeries';
import type { KPIMetrics, TimeSeriesData } from '../types';
import type { MargemContribuicaoData } from '../hooks/useMargemContribuicaoDashboard';
import type { DashboardFilters } from '../types';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

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

  // Chart data
  const ltvChartData = series.map(m => ({
    monthFull: m.monthFull,
    ltv_M: m.ltv_M,
    ltv_3M: m.ltv_3M,
    ltv_6M: m.ltv_6M,
  }));

  const ltvCacChartData = series.map(m => ({
    monthFull: m.monthFull,
    ltv_cac_M: m.ltv_cac_M,
    ltv_cac_3M: m.ltv_cac_3M,
    ltv_cac_6M: m.ltv_cac_6M,
  }));

  const fmtLtvVal = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '—';
    return v.toFixed(1);
  };

  const fmtLtvCacVal = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '—';
    return v.toFixed(2) + 'x';
  };

  // Debug panel state
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
            formula="Soma das mensalidades de todos os clientes ativos (cancelado=false). Retrato instantâneo, não considera movimentos do período."
          />
          <KPICardEnhanced
            label="Net New MRR (no período)"
            value={fmt(metrics.netNewMrr)}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant={metrics.netNewMrr >= 0 ? 'success' : 'destructive'}
            subtitle="Variação líquida no período"
            formula="New MRR (novos clientes por data_venda) + Upsell + Cross-sell − Downsell − Churn MRR. Diferente do MRR Snapshot, que é a foto atual."
          />
        </div>

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          <KPICardEnhanced
            label="Crescimento R$"
            value={fmt(metrics.crescimentoReais)}
            icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.crescimentoReais >= 0 ? 'success' : 'destructive'}
            trend={metrics.crescimentoReais >= 0 ? 'up' : 'down'}
            trendValue="no período"
            formula="MRR atual − MRR no início do período"
          />
          <KPICardEnhanced
            label="Crescimento %"
            value={fmtPct(metrics.crescimentoPercent)}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.crescimentoPercent >= 0 ? 'success' : 'destructive'}
            formula="Crescimento R$ ÷ MRR início do período"
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
            formula="Receita (MRR) − COGS − Impostos − Custos Fixos alocados. Margem de contribuição total da carteira ativa."
          />
          <KPICardEnhanced
            label="MC% Ponderada"
            value={mc != null ? fmtPct(mc.mc_percent_ponderada) : '—'}
            icon={<Percent className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant={mc && mc.mc_percent_ponderada >= 0.3 ? 'success' : mc && mc.mc_percent_ponderada >= 0.1 ? 'warning' : 'destructive'}
            formula="MC Total ÷ MRR Total × 100. Percentual ponderado pela receita total, não média simples de % por cliente."
          />
          <KPICardEnhanced
            label="MC Média / Cliente (R$)"
            value={mc != null ? fmt(mc.mc_media_por_cliente) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={s}
            variant="dark"
            formula="MC Total ÷ Clientes Ativos. Margem de contribuição média por cliente em Reais."
          />
        </div>
      </section>

      {/* ═══════ SEÇÃO 3 — Retenção e Unit Economics ═══════ */}
      <section className="space-y-4">
        <SectionHeader
          title="Retenção e Unit Economics"
          description="LTV, CAC e payback com visões mensal, 3M e 6M"
          icon={<Shield className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        {/* LTV (meses) — 3 cards */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <KPICardEnhanced
            label="LTV (mês)"
            value={fmtLtvVal(current?.ltv_M)}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle={current?.ltv_M === 120 ? 'Teto aplicado (churn=0)' : undefined}
            formula="1 ÷ Churn Rate do mês. Teto: 120 meses quando churn=0."
          />
          <KPICardEnhanced
            label="LTV (3M)"
            value={fmtLtvVal(current?.ltv_3M)}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Janela 3 meses"
            formula="1 ÷ (cancelados 3M ÷ base_inicio 3M). Churn agregado, não média de LTV."
          />
          <KPICardEnhanced
            label="LTV (6M)"
            value={fmtLtvVal(current?.ltv_6M)}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            subtitle="Janela 6 meses"
            formula="1 ÷ (cancelados 6M ÷ base_inicio 6M). Churn agregado, não média de LTV."
          />
        </div>

        {/* LTV/CAC — 3 cards */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <KPICardEnhanced
            label="LTV/CAC (mês)"
            value={fmtLtvCacVal(current?.ltv_cac_M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_M != null && current.ltv_cac_M >= 3 ? 'success' : current?.ltv_cac_M != null && current.ltv_cac_M >= 1 ? 'warning' : 'destructive'}
            subtitle={current?.ltv_cac_M != null && current.ltv_cac_M >= 3 ? 'Saudável (≥3x)' : current?.ltv_cac_M != null && current.ltv_cac_M >= 1 ? 'Atenção (1-3x)' : 'Crítico (<1x)'}
            formula="LTV R$ (mês) ÷ CAC (mês). Razão em 'x', nunca em %."
          />
          <KPICardEnhanced
            label="LTV/CAC (3M)"
            value={fmtLtvCacVal(current?.ltv_cac_3M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_3M != null && current.ltv_cac_3M >= 3 ? 'success' : current?.ltv_cac_3M != null && current.ltv_cac_3M >= 1 ? 'warning' : 'destructive'}
            subtitle="Janela 3 meses"
            formula="LTV R$ (3M) ÷ CAC (3M). Usa churn e MC agregados da janela."
          />
          <KPICardEnhanced
            label="LTV/CAC (6M)"
            value={fmtLtvCacVal(current?.ltv_cac_6M)}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={current?.ltv_cac_6M != null && current.ltv_cac_6M >= 3 ? 'success' : current?.ltv_cac_6M != null && current.ltv_cac_6M >= 1 ? 'warning' : 'destructive'}
            subtitle="Janela 6 meses"
            formula="LTV R$ (6M) ÷ CAC (6M). Usa churn e MC agregados da janela."
          />
        </div>

        {/* CAC + Payback */}
        <div className={`grid gap-4 ${tvMode ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <KPICardEnhanced
            label="CAC (mês)"
            value={current?.cac_M ? fmt(current.cac_M) : '—'}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Soma valor_alocado das despesas CAC vigentes no mês (mes_inicial..mes_final). Inclui despesas gerais (unidade=null)."
          />
          <KPICardEnhanced
            label="LTV R$ (mês)"
            value={current?.ltv_rs_M != null ? fmt(current.ltv_rs_M) : '—'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Ticket Médio × LTV (meses) × MC%. Receita líquida esperada por cliente."
          />
          <KPICardEnhanced
            label="CAC Payback (meses)"
            value={metrics.cacPayback > 0 && metrics.cacPayback < 100 ? metrics.cacPayback.toFixed(1) : 'N/A'}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.cacPayback > 0 && metrics.cacPayback <= 12 ? 'success' : 'warning'}
            formula="CAC ÷ Lucro Bruto mensal médio por cliente. Ideal ≤ 12 meses."
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
              <div className="space-y-2">
                {ranking.slice(0, 5).map((f, i) => (
                  <div key={f.nome} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-muted-foreground w-5">{i + 1}.</span>
                      <span className="text-sm">{f.nome}</span>
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

        {/* Gráficos multi-linha em 2 colunas */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          <MultiLineChartCard
            title="Evolução LTV (meses)"
            data={ltvChartData}
            lines={[
              { dataKey: 'ltv_M', label: 'Mensal', color: 'hsl(var(--chart-1))' },
              { dataKey: 'ltv_3M', label: 'Média 3M', color: 'hsl(var(--chart-3))', strokeDasharray: '5 5' },
              { dataKey: 'ltv_6M', label: 'Média 6M', color: 'hsl(var(--chart-5))', strokeDasharray: '10 5' },
            ]}
            formatValue={v => v.toFixed(1) + ' meses'}
            tvMode={tvMode}
          />
          <MultiLineChartCard
            title="Evolução LTV/CAC (x)"
            data={ltvCacChartData}
            lines={[
              { dataKey: 'ltv_cac_M', label: 'Mensal', color: 'hsl(var(--chart-2))' },
              { dataKey: 'ltv_cac_3M', label: 'Média 3M', color: 'hsl(var(--chart-4))', strokeDasharray: '5 5' },
              { dataKey: 'ltv_cac_6M', label: 'Média 6M', color: 'hsl(var(--chart-5))', strokeDasharray: '10 5' },
            ]}
            formatValue={v => v.toFixed(2) + 'x'}
            tvMode={tvMode}
          />
        </div>
      </section>

      {/* ═══════ DEBUG PANEL ═══════ */}
      <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Bug className="h-3.5 w-3.5" />
            <span>Dados de Auditoria (Unit Economics)</span>
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
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Base Início</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Cancel.</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">Churn%</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV M</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV 3M</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV 6M</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">CAC</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV R$</th>
                        <th className="text-right py-1 px-2 font-semibold text-muted-foreground">LTV/CAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map(m => (
                        <tr key={m.yearMonth} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-1 px-2 font-medium">{m.monthFull}</td>
                          <td className="text-right py-1 px-2">{m.base_inicio}</td>
                          <td className="text-right py-1 px-2">{m.cancelados}</td>
                          <td className="text-right py-1 px-2">{m.churn_M !== null ? (m.churn_M * 100).toFixed(2) + '%' : '—'}</td>
                          <td className="text-right py-1 px-2">{fmtLtvVal(m.ltv_M)}</td>
                          <td className="text-right py-1 px-2">{fmtLtvVal(m.ltv_3M)}</td>
                          <td className="text-right py-1 px-2">{fmtLtvVal(m.ltv_6M)}</td>
                          <td className="text-right py-1 px-2">{fmt(m.cac_M)}</td>
                          <td className="text-right py-1 px-2">{m.ltv_rs_M !== null ? fmt(m.ltv_rs_M) : '—'}</td>
                          <td className="text-right py-1 px-2">{fmtLtvCacVal(m.ltv_cac_M)}</td>
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
