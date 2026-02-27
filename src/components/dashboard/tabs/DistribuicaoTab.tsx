import { useState, useMemo } from 'react';
import { BarChartCard } from '../charts/BarChartCard';
import { PieChartCard } from '../charts/PieChartCard';
import { BrazilChoroplethMap } from '../charts/BrazilChoroplethMap';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
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

/** Group items with value < minCount into "Outros" */
function groupOutros(data: DistributionDataPoint[], minCount: number): DistributionDataPoint[] {
  const big: DistributionDataPoint[] = [];
  let outrosValue = 0;
  let outrosPercent = 0;
  data.forEach(d => {
    if (d.value < minCount) { outrosValue += d.value; outrosPercent += d.percent; }
    else big.push(d);
  });
  const result = big.sort((a, b) => b.value - a.value);
  if (outrosValue > 0) result.push({ name: 'Outros', value: outrosValue, percent: outrosPercent });
  return result;
}

/** Generate monochromatic green palette based on data length */
function greenPalette(count: number): string[] {
  const lightnessValues = [34, 40, 48, 55, 62, 68, 74, 80, 85, 90];
  return Array.from({ length: count }, (_, i) => `hsl(145 53% ${lightnessValues[Math.min(i, lightnessValues.length - 1)]}%)`);
}

export function DistribuicaoTab({ distributions, tvMode }: Props) {
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [includeHiper, setIncludeHiper] = useState(true);

  // Filter cities by selected state
  const filteredCidades = useMemo(() => {
    if (!selectedState || !distributions.topCidadesByEstado) return distributions.porCidade;
    const cities = distributions.topCidadesByEstado[selectedState];
    if (!cities) return [];
    const total = cities.reduce((s, c) => s + c.qtd, 0) || 1;
    return cities.slice(0, 10).map(c => ({ name: c.nome, value: c.qtd, percent: c.qtd / total }));
  }, [selectedState, distributions]);

  // Filter segmento/area by state — we don't have per-state breakdowns in distributions,
  // so when a state is selected, show as-is (data comes pre-filtered from the hook).
  // The groupOutros logic applies regardless.
  const segmentoData = useMemo(() => groupOutros(distributions.porSegmento, 10), [distributions.porSegmento]);
  const areaData = useMemo(() => groupOutros(distributions.porAreaAtuacao, 10), [distributions.porAreaAtuacao]);

  // Fornecedores with Hiper toggle
  const fornecedorData = useMemo(() => {
    let data = distributions.porFornecedor;
    if (!includeHiper) {
      data = data.filter(d => !d.name.toLowerCase().includes('hiper'));
      // recalc percent
      const total = data.reduce((s, d) => s + d.value, 0) || 1;
      data = data.map(d => ({ ...d, percent: d.value / total }));
    }
    return data;
  }, [distributions.porFornecedor, includeHiper]);

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

      {/* 1. Choropleth Map */}
      <BrazilChoroplethMap
        title="Distribuição Geográfica por Estado"
        data={distributions.porEstado}
        tvMode={tvMode}
        topCidadesByEstado={distributions.topCidadesByEstado}
        selectedState={selectedState}
        onSelectState={setSelectedState}
      />

      {/* 2. Top 10 Cidades — monochromatic */}
      <BarChartCard
        title={selectedState ? `Top 10 Cidades — ${SIGLA_TO_NAME[selectedState] || selectedState}` : 'Top 10 Cidades (Qtde Clientes)'}
        data={filteredCidades}
        tvMode={tvMode}
        height={tvMode ? 450 : 350}
        color="hsl(145 53% 34%)"
      />

      {/* 3. Donuts — monochromatic green with Outros grouping */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <PieChartCard
          title="% Carteira por Segmento"
          data={segmentoData}
          tvMode={tvMode}
          height={tvMode ? 450 : 350}
          colors={segmentoPalette}
        />
        <PieChartCard
          title="% Carteira por Área de Atuação"
          data={areaData}
          tvMode={tvMode}
          height={tvMode ? 450 : 350}
          colors={areaPalette}
        />
      </div>

      {/* 4. Fornecedores with Hiper toggle */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-1">
          <Switch id="hiper-toggle" checked={!includeHiper} onCheckedChange={(v) => setIncludeHiper(!v)} />
          <Label htmlFor="hiper-toggle" className="text-sm cursor-pointer">
            {includeHiper ? 'Incluir Hiper Software' : 'Excluir Hiper Software'}
          </Label>
        </div>
        <BarChartCard
          title={includeHiper ? 'Top 10 Fornecedores (Qtde Clientes)' : 'Top Fornecedores — excluindo Hiper Software'}
          data={fornecedorData}
          tvMode={tvMode}
          height={tvMode ? 450 : 350}
          horizontal={false}
          color="hsl(145 53% 34%)"
        />
      </div>
    </div>
  );
}
