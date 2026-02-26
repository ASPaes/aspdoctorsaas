import { BarChartCard } from '../charts/BarChartCard';
import { PieChartCard } from '../charts/PieChartCard';
import { BrazilMapChart } from '../charts/BrazilMapChart';
import type { DistributionData } from '../types';

interface Props { distributions: DistributionData; tvMode: boolean; }

export function DistribuicaoTab({ distributions, tvMode }: Props) {
  return (
    <div className="space-y-6">
      <BrazilMapChart title="Distribuição Geográfica por Estado" data={distributions.porEstado} tvMode={tvMode} topCidadesByEstado={distributions.topCidadesByEstado} />
      <BarChartCard title="Top 10 Cidades (Qtde Clientes)" data={distributions.porCidade} tvMode={tvMode} height={tvMode ? 450 : 350} />
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <PieChartCard title="% Carteira por Segmento" data={distributions.porSegmento} tvMode={tvMode} height={tvMode ? 450 : 350} />
        <PieChartCard title="% Carteira por Área de Atuação" data={distributions.porAreaAtuacao} tvMode={tvMode} height={tvMode ? 450 : 350} />
      </div>
      <BarChartCard title="Top 10 Fornecedores (Qtde Clientes)" data={distributions.porFornecedor} tvMode={tvMode} height={tvMode ? 450 : 350} horizontal={false} />
    </div>
  );
}
