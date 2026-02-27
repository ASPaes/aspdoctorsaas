import { TrendingUp, Clock, DollarSign, Divide, Calculator, Users, Percent, BarChart3, Shield, ChevronDown } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { LineChartCard } from '../charts/LineChartCard';
import { NetNewMrrBreakdown } from '../cards/NetNewMrrBreakdown';
import { SectionHeader } from '../SectionHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KPIMetrics, TimeSeriesData } from '../types';
import type { MargemContribuicaoData } from '../hooks/useMargemContribuicaoDashboard';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

interface Props { metrics: KPIMetrics; timeSeries: TimeSeriesData; tvMode: boolean; mcData?: MargemContribuicaoData; }

export function CrescimentoTab({ metrics, timeSeries, tvMode, mcData }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  const ranking = metrics.funcionariosRanking || [];
  const mc = mcData;

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

        {/* Linha 1: 2 cards grandes */}
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

        {/* Linha 2: 2 cards médios */}
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

        {/* Breakdown logo abaixo do contexto de receita */}
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
          description="Lifetime Value, custo de aquisição e payback"
          icon={<Shield className={`${tvMode ? 'h-6 w-6' : 'h-5 w-5'} text-primary`} />}
          tvMode={tvMode}
        />

        <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'}`}>
          <KPICardEnhanced
            label="LTV (meses)"
            value={metrics.ltvMeses > 0 ? metrics.ltvMeses.toFixed(1) : 'N/A'}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="1 ÷ Churn Rate mensal. Usa a mesma fórmula do gráfico de evolução."
          />
          <KPICardEnhanced
            label="LTV (R$)"
            value={metrics.ltvReais > 0 ? fmt(metrics.ltvReais) : 'N/A'}
            icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Ticket Médio × LTV em meses. Receita esperada por cliente ao longo da vida."
          />
          <KPICardEnhanced
            label="CAC"
            value={metrics.cac > 0 ? fmt(metrics.cac) : 'N/A'}
            size={tvMode ? 'tv' : 'md'}
            variant="dark"
            formula="Total de despesas CAC ativas no período ÷ Novos clientes"
          />
          <KPICardEnhanced
            label="LTV/CAC"
            value={metrics.ltvCac > 0 ? metrics.ltvCac.toFixed(2) + 'x' : 'N/A'}
            icon={<Divide className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.ltvCac >= 3 ? 'success' : metrics.ltvCac >= 1 ? 'warning' : 'destructive'}
            subtitle={metrics.ltvCac >= 3 ? 'Saudável (≥3x)' : metrics.ltvCac >= 1 ? 'Atenção (1-3x)' : 'Crítico (<1x)'}
            formula="LTV em R$ ÷ CAC. Ideal ≥ 3x"
          />
          <KPICardEnhanced
            label="CAC Payback (meses)"
            value={metrics.cacPayback > 0 && metrics.cacPayback < 100 ? metrics.cacPayback.toFixed(1) : 'N/A'}
            icon={<Clock className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />}
            size={tvMode ? 'tv' : 'md'}
            variant={metrics.cacPayback > 0 && metrics.cacPayback <= 12 ? 'success' : 'warning'}
            formula="CAC ÷ Lucro Bruto mensal médio por cliente. Ideal ≤ 12 meses"
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

        {/* Gráficos em 2 colunas */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          <LineChartCard title="Evolução LTV (meses) — 1 ÷ Churn mensal (média 3m)" data={timeSeries.ltvMesesEvolution} formatValue={v => v.toFixed(1) + ' meses'} tvMode={tvMode} color="hsl(var(--chart-3))" />
          <LineChartCard title="Evolução LTV/CAC (x)" data={timeSeries.ltvCacEvolution} formatValue={v => v.toFixed(2) + 'x'} tvMode={tvMode} color="hsl(var(--chart-5))" />
        </div>
      </section>
    </div>
  );
}
