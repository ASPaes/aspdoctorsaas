import { Users, DollarSign, Rocket, TrendingUp } from 'lucide-react';
import { KPICardEnhanced } from '../cards/KPICardEnhanced';
import { PieChartCard } from '../charts/PieChartCard';
import { BarChartCard } from '../charts/BarChartCard';
import type { KPIMetrics, DistributionData } from '../types';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

interface Props { metrics: KPIMetrics; distributions: DistributionData; tvMode: boolean; }

export function VendasTab({ metrics, distributions, tvMode }: Props) {
  const s = tvMode ? 'tv' : 'lg';
  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        <KPICardEnhanced label="Novos Clientes" value={metrics.novosClientes.toString()} icon={<Users className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" />
        <KPICardEnhanced label="New MRR" value={fmt(metrics.newMrr)} icon={<DollarSign className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" />
        <KPICardEnhanced label="Receita de Ativação" value={fmt(metrics.receitaAtivacao)} icon={<Rocket className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-primary`} />} size={s} variant="dark" formula="Soma dos valores de ativação/setup" />
        <KPICardEnhanced label="MRR Adicionado" value={fmt(metrics.newMrr + metrics.upsellMrr + metrics.crossSellMrr)} icon={<TrendingUp className={`${tvMode ? 'h-8 w-8' : 'h-5 w-5'} text-green-500`} />} size={s} variant="success" formula="New MRR + Upsell + Cross-sell" />
      </div>

      <div className={`grid gap-4 ${tvMode ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
        <KPICardEnhanced label="Ticket Médio (Novos)" value={metrics.novosClientes > 0 ? fmt(metrics.newMrr / metrics.novosClientes) : 'N/A'} size={s} variant="primary" formula="New MRR ÷ Novos Clientes" />
        <KPICardEnhanced label="Setup Médio" value={metrics.novosClientes > 0 ? fmt(metrics.totalImplantacao / metrics.novosClientes) : 'N/A'} size={s} variant="primary" formula="Total Implantação ÷ Novos Clientes" />
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <PieChartCard title="Vendas por Origem" data={distributions.porOrigemVenda} tvMode={tvMode} height={tvMode ? 450 : 350} />
        <BarChartCard title="Top 10 Fornecedores (Qtde Clientes)" data={distributions.porFornecedor} tvMode={tvMode} height={tvMode ? 450 : 350} />
      </div>
    </div>
  );
}
