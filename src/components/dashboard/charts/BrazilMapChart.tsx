import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { MapPin, X } from 'lucide-react';
import type { DistributionDataPoint } from '../types';
import { BrazilSvgMap } from './BrazilSvgMap';

interface BrazilMapChartProps {
  title: string;
  data: DistributionDataPoint[];
  tvMode?: boolean;
  className?: string;
  topCidadesByEstado?: Record<string, { nome: string; qtd: number }[]>;
}

const stateNames: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba',
  PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
  RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

const getColorByValue = (value: number, maxValue: number): string => {
  if (value === 0 || maxValue === 0) return 'hsl(var(--muted) / 0.35)';
  const ratio = value / maxValue;
  if (ratio <= 0.1) return 'hsl(145 53% 72%)';
  if (ratio <= 0.25) return 'hsl(145 53% 58%)';
  if (ratio <= 0.4) return 'hsl(145 53% 48%)';
  if (ratio <= 0.6) return 'hsl(145 53% 38%)';
  if (ratio <= 0.8) return 'hsl(145 53% 30%)';
  return 'hsl(145 53% 22%)';
};

export function BrazilMapChart({ title, data, tvMode = false, className, topCidadesByEstado = {} }: BrazilMapChartProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const stateDataMap = useMemo(() => {
    const map: Record<string, DistributionDataPoint> = {};
    data.forEach(d => {
      const n = d.name.trim().toUpperCase();
      if (n.length === 2 && stateNames[n]) map[n] = d;
      else {
        const entry = Object.entries(stateNames).find(([, name]) => name.toLowerCase() === d.name.toLowerCase().trim());
        if (entry) map[entry[0]] = d;
      }
    });
    return map;
  }, [data]);

  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  const totalClientes = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const getStateData = (code: string) => stateDataMap[code] || { name: stateNames[code] || code, value: 0, percent: 0 };
  const getStateColor = (code: string) => getColorByValue(getStateData(code).value, maxValue);
  const handleStateClick = (code: string) => setSelectedState(selectedState === code ? null : code);

  const selectedStateData = selectedState ? getStateData(selectedState) : null;
  const selectedStateCities = selectedState ? topCidadesByEstado[selectedState] : null;
  const sortedData = useMemo(() => [...data].sort((a, b) => b.value - a.value).slice(0, tvMode ? 10 : 8), [data, tvMode]);

  return (
    <Card className={cn('overflow-hidden', className)}>
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
          <div className="flex-1 relative p-4">
            <BrazilSvgMap getStateColor={getStateColor} hoveredState={hoveredState} selectedState={selectedState} onStateHover={setHoveredState} onStateClick={handleStateClick} tvMode={tvMode} />
            {hoveredState && !selectedState && (
              <div className="absolute bg-background/95 backdrop-blur-sm border-2 border-primary/20 rounded-xl shadow-xl p-4 pointer-events-none z-10" style={{ left: '50%', bottom: '20px', transform: 'translateX(-50%)' }}>
                <p className="font-bold text-lg">{stateNames[hoveredState]}</p>
                <p className="text-muted-foreground"><span className="font-mono font-bold text-primary text-2xl">{getStateData(hoveredState).value}</span> clientes</p>
              </div>
            )}
          </div>
          <div className={cn('border-l bg-muted/30 p-4 space-y-4', tvMode ? 'lg:w-80' : 'lg:w-64')}>
            {selectedState && selectedStateData ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg">{stateNames[selectedState]}</h4>
                  <button onClick={() => setSelectedState(null)} className="p-1.5 hover:bg-muted rounded-full"><X className="h-4 w-4 text-muted-foreground" /></button>
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
                          <div className="flex items-center gap-2"><span className="font-bold text-muted-foreground text-sm w-5">{i + 1}</span><span className="truncate text-sm font-medium">{city.nome}</span></div>
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
                {sortedData.map((item, i) => {
                  const code = Object.entries(stateNames).find(([, n]) => n.toLowerCase() === item.name.toLowerCase())?.[0] || item.name.substring(0, 2).toUpperCase();
                  return (
                    <div key={item.name} className="flex items-center justify-between gap-2 p-2 rounded-lg cursor-pointer hover:bg-muted/80" onClick={() => handleStateClick(code)}>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-muted-foreground text-sm w-5">{i + 1}</span>
                        <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: getStateColor(code) }} />
                        <span className="truncate text-sm font-medium">{item.name}</span>
                      </div>
                      <span className="font-mono font-bold text-base">{item.value}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
