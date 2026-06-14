import { useState, useMemo, useEffect, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DistributionDataPoint, CityGeoPoint } from '../types';

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

const DEFAULT_VIEW = { center: [-54, -15] as [number, number], zoom: 1 };

type ViewConfig = { center: [number, number]; zoom: number };

function computeBoundsFromGeometry(geometry: any): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const walk = (coords: any) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(walk);
    }
  };
  walk(geometry.coordinates);
  return { minLng, maxLng, minLat, maxLat };
}

function computeViewFromFeature(feature: any): ViewConfig {
  const b = computeBoundsFromGeometry(feature.geometry);
  const center: [number, number] = [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2];
  const span = Math.max(b.maxLng - b.minLng, b.maxLat - b.minLat);
  const zoom = Math.min(12, Math.max(1.5, (41 / span) * 0.7));
  return { center, zoom };
}

interface Props {
  title: string;
  data: DistributionDataPoint[];
  tvMode?: boolean;
  topCidadesByEstado?: Record<string, { nome: string; qtd: number }[]>;
  citiesGeo?: CityGeoPoint[];
  selectedState: string | null;
  onSelectState: (sigla: string | null) => void;
  metric?: 'qtd' | 'mrr' | 'ticket' | 'margem' | 'churn';
}

export function BrazilChoroplethMap({ title, data, tvMode = false, topCidadesByEstado = {}, citiesGeo = [], selectedState, onSelectState, metric = 'qtd' }: Props) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [stateViewMap, setStateViewMap] = useState<Record<string, ViewConfig>>({});
  const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
    coordinates: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
  });
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const stateItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [openCity, setOpenCity] = useState<{ city: CityGeoPoint; x: number; y: number } | null>(null);

  // Fecha o popover ao apertar ESC
  useEffect(() => {
    if (!openCity) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenCity(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openCity]);

  // Scroll suave ao centro da tela quando um estado é selecionado
  useEffect(() => {
    if (selectedState && mapContainerRef.current) {
      mapContainerRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [selectedState]);

  // Auto-scroll do item da lista quando hover no estado do mapa
  useEffect(() => {
    if (hoveredState && stateItemRefs.current[hoveredState]) {
      stateItemRefs.current[hoveredState]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [hoveredState]);

  useEffect(() => {
    let cancelled = false;
    fetch(GEO_URL)
      .then(r => r.json())
      .then((geojson: any) => {
        if (cancelled) return;
        const map: Record<string, ViewConfig> = {};
        (geojson.features || []).forEach((feature: any) => {
          const sigla = NAME_TO_SIGLA[feature?.properties?.name];
          if (!sigla) return;
          map[sigla] = computeViewFromFeature(feature);
        });
        setStateViewMap(map);
      })
      .catch(err => console.error('Failed to load state geometries for zoom:', err));
    return () => { cancelled = true; };
  }, []);

  // ESC fecha o zoom
  useEffect(() => {
    if (!selectedState) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelectState(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedState, onSelectState]);

  // Sincroniza position quando o estado selecionado muda
  useEffect(() => {
    const view = selectedState ? (stateViewMap[selectedState] || DEFAULT_VIEW) : DEFAULT_VIEW;
    setPosition({ coordinates: view.center, zoom: view.zoom });
  }, [selectedState, stateViewMap]);

  const currentView = selectedState ? (stateViewMap[selectedState] || DEFAULT_VIEW) : DEFAULT_VIEW;

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

  const METRIC_LABEL: Record<string, string> = { qtd: 'Clientes', mrr: 'MRR', ticket: 'Ticket médio', margem: 'Margem %', churn: 'Churn' };
  const fmtMetric = (v: number) => {
    if (metric === 'mrr' || metric === 'ticket') return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    if (metric === 'margem') return Math.round(v) + '%';
    if (metric === 'churn') return (Math.round(v * 10) / 10).toFixed(1) + '%';
    return Math.round(v).toLocaleString('pt-BR');
  };
  const getColor = (sigla: string) => {
    const val = stateDataMap[sigla]?.value || 0;
    if (val === 0 || maxValue === 0) return 'hsl(210 12% 90%)';
    const ratio = val / maxValue;
    if (metric === 'churn') {
      if (ratio <= 0.05) return 'hsl(48 85% 82%)';
      if (ratio <= 0.1) return 'hsl(45 85% 72%)';
      if (ratio <= 0.2) return 'hsl(40 85% 62%)';
      if (ratio <= 0.35) return 'hsl(30 85% 55%)';
      if (ratio <= 0.55) return 'hsl(20 82% 50%)';
      if (ratio <= 0.75) return 'hsl(10 78% 45%)';
      return 'hsl(2 75% 38%)';
    }
    if (ratio <= 0.05) return 'hsl(145 53% 85%)';
    if (ratio <= 0.1) return 'hsl(145 53% 75%)';
    if (ratio <= 0.2) return 'hsl(145 53% 65%)';
    if (ratio <= 0.35) return 'hsl(145 53% 55%)';
    if (ratio <= 0.55) return 'hsl(145 53% 44%)';
    if (ratio <= 0.75) return 'hsl(145 53% 36%)';
    return 'hsl(145 53% 26%)';
  };

  const sortedData = useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);
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
          <div ref={mapContainerRef} className="flex-1 relative p-4">
            {selectedState && (
              <button
                onClick={() => onSelectState(null)}
                className="absolute top-6 left-6 z-10 flex items-center gap-2 px-3 py-2 bg-background border rounded-lg shadow-md hover:bg-muted text-sm font-medium transition-colors"
              >
                <span aria-hidden="true">←</span>
                <span>Voltar ao Brasil</span>
              </button>
            )}
            <ComposableMap
                projection="geoMercator"
                projectionConfig={{ scale: tvMode ? 1500 : 1160, center: [-54, -15] }}
                className={cn('w-full mx-auto', tvMode ? 'h-[900px] max-w-[900px]' : 'h-[750px] max-w-[750px]')}
              >
                <ZoomableGroup
                  center={position.coordinates}
                  zoom={position.zoom}
                  minZoom={1}
                  maxZoom={12}
                  onMoveEnd={({ coordinates, zoom }) => setPosition({ coordinates: coordinates as [number, number], zoom })}
                >
                  <Geographies geography={GEO_URL}>
                    {({ geographies }) =>
                      geographies.map(geo => {
                        const geoName = geo.properties.name as string;
                        const sigla = NAME_TO_SIGLA[geoName] || '';
                        const isHovered = hoveredState === sigla;
                        const isSelected = selectedState === sigla;
                        const val = stateDataMap[sigla]?.value || 0;
                        const stateName = SIGLA_TO_NAME[sigla] || geoName;
                        const tooltipText = val > 0
                          ? `${stateName} — ${val} ${val === 1 ? 'cliente' : 'clientes'}`
                          : `${stateName} — sem clientes`;

                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill={getColor(sigla)}
                            stroke={isSelected ? 'hsl(145 53% 34%)' : 'hsl(var(--border))'}
                            strokeWidth={(isSelected ? 2.5 : isHovered ? 1.5 : 0.5) / position.zoom}
                            style={{
                              default: { outline: 'none', cursor: 'pointer' },
                              hover: { outline: 'none', cursor: 'pointer', filter: 'brightness(1.1)' },
                              pressed: { outline: 'none' },
                            }}
                            onMouseEnter={() => setHoveredState(sigla)}
                            onMouseLeave={() => setHoveredState(null)}
                            onClick={() => onSelectState(selectedState === sigla ? null : sigla)}
                          >
                            <title>{tooltipText}</title>
                          </Geography>
                        );
                      })
                    }
                  </Geographies>
                  {citiesGeo.map((city) => {
                    const screenRadius = Math.max(7, 8 / Math.sqrt(position.zoom));
                    const r = screenRadius / position.zoom;
                    const hitRadius = Math.max(10, screenRadius * 1.5) / position.zoom;
                    const cityKey = `${city.uf}-${city.nome}`;
                    const isActive = openCity?.city && `${openCity.city.uf}-${openCity.city.nome}` === cityKey;
                    return (
                      <Marker key={cityKey} coordinates={[city.longitude, city.latitude]}>
                        <g
                          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const target = e.currentTarget as SVGGElement;
                            const rect = target.getBoundingClientRect();
                            setOpenCity(prev => {
                              if (prev?.city && `${prev.city.uf}-${prev.city.nome}` === cityKey) {
                                return null;
                              }
                              return {
                                city,
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                              };
                            });
                          }}
                        >
                          <title>{`${city.nome} — ${city.qtd} ${city.qtd === 1 ? 'cliente' : 'clientes'}`}</title>
                          <circle r={hitRadius} fill="transparent" />
                          <circle
                            r={r}
                            fill="hsl(145 53% 34%)"
                            fillOpacity={isActive ? 1 : 0.85}
                            stroke="white"
                            strokeWidth={isActive ? 2 : 1.2}
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      </Marker>
                    );
                  })}
                </ZoomableGroup>
              </ComposableMap>
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
                    <p className="font-semibold text-sm text-muted-foreground">Cidades</p>
                    <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                      {selectedStateCities.map((city, i) => (
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
                <p className="font-semibold text-base">Estados</p>
                <p className="text-xs text-muted-foreground mb-2">📍 Clique no estado para filtrar abaixo</p>
                <div className="space-y-2 max-h-[680px] overflow-y-auto pr-1">
                  {sortedData.map((item, i) => {
                    const sigla = item.name.trim().toUpperCase();
                    const isHovered = hoveredState === sigla;
                    return (
                      <div
                        key={item.name}
                        ref={el => { stateItemRefs.current[sigla] = el; }}
                        className={cn(
                          'flex items-center justify-between gap-2 p-2 rounded-lg cursor-pointer transition-all',
                          isHovered
                            ? 'bg-primary/10 border border-primary/30 scale-105 shadow-sm'
                            : 'border border-transparent hover:bg-muted/80'
                        )}
                        onClick={() => onSelectState(sigla)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-muted-foreground text-sm w-5">{i + 1}</span>
                          <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: getColor(sigla) }} />
                          <span className="truncate text-sm font-medium">{SIGLA_TO_NAME[sigla] || item.name}</span>
                        </div>
                        <span className="font-mono font-bold text-base">{item.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {openCity && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpenCity(null)}
          />
          <div
            className="fixed z-50 w-72 bg-popover text-popover-foreground border rounded-md shadow-lg p-3"
            style={{
              left: Math.min(Math.max(openCity.x - 144, 8), window.innerWidth - 296),
              top: Math.max(openCity.y - 12, 8),
              transform: 'translateY(-100%)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-semibold text-sm">{openCity.city.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {openCity.city.qtd} {openCity.city.qtd === 1 ? 'cliente' : 'clientes'}
                </p>
              </div>
              <button
                onClick={() => setOpenCity(null)}
                className="p-1 hover:bg-muted rounded-full -mt-1 -mr-1"
                aria-label="Fechar"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
              {openCity.city.clientes.map((nome, i) => (
                <p key={i} className="text-xs leading-tight">• {nome}</p>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
