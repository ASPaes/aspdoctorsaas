import { useState, useMemo } from 'react';
import { BarChartCard } from '../charts/BarChartCard';
import { PieChartCard } from '../charts/PieChartCard';
import { BrazilChoroplethMap } from '../charts/BrazilChoroplethMap';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import type { DistributionData, DistributionDataPoint } from '../types';

const SIGLA_TO_NAME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
  RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins',
};

interface Props { distributions: DistributionData; tvMode: boolean; }

/** Top N + group rest into "Outros" */
function topN(data: DistributionDataPoint[], n: number): DistributionDataPoint[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  if (rest.length > 0) {
    const outrosValue = rest.reduce((s, d) => s + d.value, 0);
    const outrosPercent = rest.reduce((s, d) => s + d.percent, 0);
    top.push({ name: 'Outros', value: outrosValue, percent: outrosPercent });
  }
  return top;
}

function greenPalette(count: number): string[] {
  const l = [34, 40, 48, 55, 62, 68, 74, 80, 85, 90];
  return Array.from({ length: count }, (_, i) => `hsl(145 53% ${l[Math.min(i, l.length - 1)]}%)`);
}

export function DistribuicaoTab({ distributions, tvMode }: Props) {
  const [selectedState, setSelectedState] = useState<string | null>(null);

  // Cities filtered by state
  const filteredCidades = useMemo(() => {
    if (!selectedState || !distributions.topCidadesByEstado) return distributions.porCidade;
    const cities = distributions.topCidadesByEstado[selectedState];
    if (!cities || cities.length === 0) return [];
    const total = cities.reduce((s, c) => s + c.qtd, 0) || 1;
    return cities.slice(0, 10).map(c => ({ name: c.nome, value: c.qtd, percent: c.qtd / total }));
  }, [selectedState, distributions]);

  // Segmento — top 5, filtered by state
  const segmentoData = useMemo(() => {
    const src = selectedState && distributions.segmentoByEstado?.[selectedState]
      ? distributions.segmentoByEstado[selectedState]
      : distributions.porSegmento;
    return topN(src, 5);
  }, [selectedState, distributions]);

  // Área de atuação — top 5, filtered by state
  const areaData = useMemo(() => {
    const src = selectedState && distributions.areaAtuacaoByEstado?.[selectedState]
      ? distributions.areaAtuacaoByEstado[selectedState]
      : distributions.porAreaAtuacao;
    return topN(src, 5);
  }, [selectedState, distributions]);

  // Fornecedores filtered by state, all included
  const fornecedorData = useMemo(() => {
    const src = selectedState && distributions.fornecedorByEstado?.[selectedState]
      ? distributions.fornecedorByEstado[selectedState]
      : distributions.porFornecedor;
    return src;
  }, [selectedState, distributions]);

  const segmentoPalette = useMemo(() => greenPalette(segmentoData.length), [segmentoData.length]);
  const areaPalette = useMemo(() => greenPalette(areaData.length), [areaData.length]);

  return (
    <div className="space-y-6">
      {/* State filter badge */}
      {selectedState && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-2 py-1.5 px-3 text-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-primary" />
            Filtrando por: <span className="font-bold">{SIGLA_TO_NAME[selectedState] || selectedState}</span>
            <button onClick={() => setSelectedState(null)} className="ml-1 hover:bg-muted rounded-full p-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        </div>
      )}

      {/* Choropleth Map */}
      <BrazilChoroplethMap
        title="Distribuição Geográfica por Estado"
        data={distributions.porEstado}
        tvMode={tvMode}
        topCidadesByEstado={distributions.topCidadesByEstado}
        selectedState={selectedState}
        onSelectState={setSelectedState}
      />

      {/* Top 10 Cidades */}
      <BarChartCard
        title={selectedState ? `Top 10 Cidades — ${SIGLA_TO_NAME[selectedState] || selectedState}` : 'Top 10 Cidades (Qtde Clientes)'}
        data={filteredCidades}
        tvMode={tvMode}
        height={tvMode ? 450 : 350}
        color="hsl(145 53% 34%)"
      />

      {/* Donuts — top 5 + Outros */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <PieChartCard
          title={selectedState ? `% Carteira por Segmento — ${SIGLA_TO_NAME[selectedState]}` : '% Carteira por Segmento'}
          data={segmentoData}
          tvMode={tvMode}
          height={tvMode ? 450 : 350}
          colors={segmentoPalette}
        />
        <PieChartCard
          title={selectedState ? `% Carteira por Área de Atuação — ${SIGLA_TO_NAME[selectedState]}` : '% Carteira por Área de Atuação'}
          data={areaData}
          tvMode={tvMode}
          height={tvMode ? 450 : 350}
          colors={areaPalette}
        />
      </div>

      {/* Fornecedores — sem toggle, sempre todos */}
      <BarChartCard
        title={selectedState ? `Top 10 Fornecedores — ${SIGLA_TO_NAME[selectedState]}` : 'Top 10 Fornecedores (Qtde Clientes)'}
        data={fornecedorData}
        tvMode={tvMode}
        height={tvMode ? 450 : 350}
        horizontal={false}
        color="hsl(145 53% 34%)"
      />
    </div>
  );
}
