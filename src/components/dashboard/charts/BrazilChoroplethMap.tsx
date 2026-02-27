import { useState, useMemo } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { DistributionDataPoint } from '../types';

const GEO_URL = '/data/brazil-states.geojson';

const NAME_TO_SIGLA: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amazonas': 'AM', 'Amapá': 'AP', 'Bahia': 'BA',
  'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO',
  'Maranhão': 'MA', 'Minas Gerais': 'MG', 'Mato Grosso do Sul': 'MS', 'Mato Grosso': 'MT',
  'Pará': 'PA', 'Paraíba': 'PB', 'Pernambuco': 'PE', 'Piauí': 'PI', 'Paraná': 'PR',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rondônia': 'RO', 'Roraima': 'RR',
  'Rio Grande do Sul': 'RS', 'Santa Catarina': 'SC', 'Sergipe': 'SE', 'São Paulo': 'SP',
  'Tocantins': 'TO',
};

const SIGLA_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(NAME_TO_SIGLA).map(([k, v]) => [v, k])
);

interface Props {
  title: string;
  data: DistributionDataPoint[];
  tvMode?: boolean;
  topCidadesByEstado?: Record<string, { nome: string; qtd: number }[]>;
  selectedState: string | null;
  onSelectState: (sigla: string | null) => void;
}

export function BrazilChoroplethMap({ title, data, tvMode = false, topCidadesByEstado = {}, selectedState, onSelectState }: Props) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);

  const stateDataMap = useMemo(() => {
    const map: Record<string, DistributionDataPoint> = {};
    data.forEach(d => {
      const key = d.name.trim().toUpperCase();
      if (key.length === 2) map[key] = d;
    });
    return map;
  }, [data]);

  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  const totalClientes = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const getColor = (sigla: string) => {
    const val = stateDataMap[sigla]?.value || 0;
    if (val === 0 || maxValue === 0) return 'hsl(210 12% 90%)'; // muted neutral
    const ratio = val / maxValue;
    if (ratio <= 0.05) return 'hsl(145 53% 85%)';
    if (ratio <= 0.1) return 'hsl(145 53% 75%)';
    if (ratio <= 0.2) return 'hsl(145 53% 65%)';
    if (ratio <= 0.35) return 'hsl(145 53% 55%)';
    if (ratio <= 0.55) return 'hsl(145 53% 44%)';
    if (ratio <= 0.75) return 'hsl(145 53% 36%)';
    return 'hsl(145 53% 26%)';
  };

  const sortedData = useMemo(() => [...data].sort((a, b) => b.value - a.value).slice(0, tvMode ? 12 : 10), [data, tvMode]);
  const selectedStateData = selectedState ? stateDataMap[selectedState] : null;
  const selectedStateCities = selectedState ? topCidadesByEstado[selectedState] : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className={cn('pb-2', tvMode && 'pb-4')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className={cn('text-primary', tvMode ? 'h-6 w-6' : 'h-5 w-5')} />
            <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle>
          </div>
          <Badge variant="secondary">{totalClientes} clientes</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row">
          {/* Map */}
          <div className="flex-1 relative p-4">
            <TooltipProvider delayDuration={0}>
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ scale: tvMode ? 1500 : 1160, center: [-54, -15] }}
                className={cn('w-full mx-auto', tvMode ? 'h-[900px] max-w-[900px]' : 'h-[750px] max-w-[750px]')}
              >
                <Geographies geography={GEO_URL}>
                  {({ geographies }) =>
                    geographies.map(geo => {
                      const geoName = geo.properties.name as string;
                      const sigla = NAME_TO_SIGLA[geoName] || '';
                      const isHovered = hoveredState === sigla;
                      const isSelected = selectedState === sigla;
                      const val = stateDataMap[sigla]?.value || 0;

                      return (
                        <Tooltip key={geo.rsmKey}>
                          <TooltipTrigger asChild>
                            <Geography
                              geography={geo}
                              fill={getColor(sigla)}
                              stroke={isSelected ? 'hsl(145 53% 34%)' : 'hsl(var(--border))'}
                              strokeWidth={isSelected ? 2.5 : isHovered ? 1.5 : 0.5}
                              style={{
                                default: { outline: 'none', cursor: 'pointer' },
                                hover: { outline: 'none', cursor: 'pointer', filter: 'brightness(1.1)' },
                                pressed: { outline: 'none' },
                              }}
                              onMouseEnter={() => setHoveredState(sigla)}
                              onMouseLeave={() => setHoveredState(null)}
                              onClick={() => onSelectState(selectedState === sigla ? null : sigla)}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-sm">
                            <p className="font-bold">{SIGLA_TO_NAME[sigla] || geoName}</p>
                            <p className="text-muted-foreground">{val} clientes</p>
                            <p className="text-xs text-muted-foreground mt-1">Clique para filtrar</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })
                  }
                </Geographies>
              </ComposableMap>
            </TooltipProvider>
          </div>

          {/* Sidebar */}
          <div className={cn('border-l bg-muted/30 p-4 space-y-4', tvMode ? 'lg:w-80' : 'lg:w-64')}>
            {selectedState && selectedStateData ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg">{SIGLA_TO_NAME[selectedState]}</h4>
                  <button onClick={() => onSelectState(null)} className="p-1.5 hover:bg-muted rounded-full">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                <div className="bg-background rounded-xl p-4 shadow-sm border">
                  <p className="text-sm text-muted-foreground">Total de Clientes</p>
                  <p className="font-bold font-mono text-primary text-3xl">{selectedStateData.value}</p>
                  <p className="text-sm text-muted-foreground">{((selectedStateData.percent || 0) * 100).toFixed(1)}% do total</p>
                </div>
                {selectedStateCities && selectedStateCities.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-sm text-muted-foreground">Top 10 Cidades</p>
                    <div className="space-y-1 max-h-[320px] overflow-y-auto">
                      {selectedStateCities.slice(0, 10).map((city, i) => (
                        <div key={city.nome} className={cn('flex justify-between items-center py-2 px-3 rounded-lg', i === 0 ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50')}>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-muted-foreground text-sm w-5">{i + 1}</span>
                            <span className="truncate text-sm font-medium">{city.nome}</span>
                          </div>
                          <span className="font-mono font-bold text-sm">{city.qtd}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="font-semibold text-base">Top Estados</p>
                <p className="text-xs text-muted-foreground mb-2">📍 Clique no estado para filtrar abaixo</p>
                {sortedData.map((item, i) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg cursor-pointer hover:bg-muted/80"
                    onClick={() => onSelectState(item.name.trim().toUpperCase())}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-muted-foreground text-sm w-5">{i + 1}</span>
                      <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: getColor(item.name.trim().toUpperCase()) }} />
                      <span className="truncate text-sm font-medium">{SIGLA_TO_NAME[item.name.trim().toUpperCase()] || item.name}</span>
                    </div>
                    <span className="font-mono font-bold text-base">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
