import { useState, useMemo } from 'react';
import { BrazilChoroplethMap } from '../charts/BrazilChoroplethMap';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingDown, TrendingUp, AlertTriangle, PieChart, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DistributionData, DashboardFilters } from '../types';
import {
  useCarteiraBreakdown,
  useCarteiraChurn,
  useCarteiraVariacao,
  useChurnDetalheUf,
  useCarteiraClientesCidade,
} from '../hooks/useDistribuicaoExtras';

const SIGLA_TO_NAME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
  RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins',
};

interface Props { distributions: DistributionData; tvMode: boolean; filters: DashboardFilters; }

const CAP = 15;
const fmtMoney = (v: number | undefined) => 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');

const REGIOES: Record<string, string[]> = {
  'Norte': ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  'Nordeste': ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  'Sudeste': ['ES', 'MG', 'RJ', 'SP'],
  'Sul': ['PR', 'RS', 'SC'],
};

export function DistribuicaoTab({ distributions, tvMode, filters }: Props) {
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [estadoTab, setEstadoTab] = useState<'cidades' | 'churn'>('cidades');
  const [metric, setMetric] = useState<'qtd' | 'mrr' | 'ticket' | 'margem' | 'churn'>('qtd');
  const [mode, setMode] = useState<'nivel' | 'variacao'>('nivel');

  const selectState = (uf: string | null) => {
    setSelectedState(uf);
    setSelectedCity(null);
    setEstadoTab('cidades');
  };

  const { data: ufBreak = [] } = useCarteiraBreakdown(filters, 'estado');
  const { data: ufChurn = [] } = useCarteiraChurn(filters, 'estado');
  const { data: ufVar = [] } = useCarteiraVariacao(filters);
  const { data: cidades = [], isLoading: loadingCidades } = useCarteiraBreakdown(filters, 'cidade', selectedState);
  const { data: churnDet = [] } = useChurnDetalheUf(filters, selectedState);
  const { data: clientesCidade = [], isLoading: loadingClientes } = useCarteiraClientesCidade(filters, selectedState, selectedCity);

  const mapData = useMemo(() => {
    if (mode === 'variacao') {
      return ufVar
        .filter((r: any) => r.uf && r.uf !== '(sem informação)' && r.mrr_anterior > 0)
        .map((r: any) => ({ name: r.uf, value: Math.round((r.delta_pct ?? 0) * 1000) / 10, percent: 0 }));
    }
    let rows: { name: string; value: number }[];
    if (metric === 'churn') {
      rows = ufChurn.filter((r: any) => r.base >= 10).map((r: any) => ({ name: r.label, value: Math.round(r.churn_pct * 1000) / 10 }));
    } else {
      const field = (r: any) =>
        metric === 'qtd' ? r.qtd : metric === 'mrr' ? r.mrr : metric === 'ticket' ? r.ticket : Math.round(r.margem_pct * 1000) / 10;
      rows = ufBreak.map((r: any) => ({ name: r.label, value: field(r) }));
    }
    const total = rows.reduce((s, r) => s + (r.value || 0), 0) || 1;
    return rows.filter(r => r.name && r.name !== '(sem informação)').map(r => ({ ...r, percent: r.value / total }));
  }, [mode, metric, ufBreak, ufChurn, ufVar]);

  const insights = useMemo(() => {
    const ufNome = (s: string) => SIGLA_TO_NAME[s] || s;
    const fmtPct = (d: number) => (d > 0 ? '+' : '') + (d * 100).toFixed(1) + '%';
    const out: { tone: 'down' | 'up' | 'warn' | 'info'; title: string; text: string }[] = [];
    const varValid = ufVar.filter((r: any) => r.uf && r.uf.length === 2 && r.mrr_anterior >= 1500 && r.delta_pct != null);
    if (varValid.length) {
      const queda = [...varValid].sort((a: any, b: any) => a.delta_pct! - b.delta_pct!)[0];
      const alta = [...varValid].sort((a: any, b: any) => b.delta_pct! - a.delta_pct!)[0];
      if (queda && (queda.delta_pct ?? 0) < -0.03) out.push({ tone: 'down', title: `${ufNome(queda.uf)} é a maior queda`, text: `MRR ${fmtPct(queda.delta_pct!)} no período. Vale checar retenção na praça.` });
      if (alta && (alta.delta_pct ?? 0) > 0.03) out.push({ tone: 'up', title: `${ufNome(alta.uf)} é o destaque`, text: `MRR ${fmtPct(alta.delta_pct!)} no período. Praça aquecida.` });
    }
    const churnValid = ufChurn.filter((r: any) => r.label && r.label.length === 2 && r.base >= 10);
    if (churnValid.length) {
      const pior = [...churnValid].sort((a: any, b: any) => b.churn_pct - a.churn_pct)[0];
      if (pior && pior.churn_pct > 0) out.push({ tone: 'warn', title: `Pior churn: ${ufNome(pior.label)}`, text: `${(pior.churn_pct * 100).toFixed(0)}% da base cancelou no período (${pior.cancelados} de ${pior.base}).` });
    }
    const totalMrr = ufBreak.reduce((s: number, r: any) => s + (r.mrr || 0), 0);
    if (totalMrr > 0) {
      const top = [...ufBreak].filter((r: any) => r.label && r.label.length === 2).sort((a: any, b: any) => b.mrr - a.mrr)[0];
      if (top) {
        const share = (top.mrr / totalMrr) * 100;
        if (share >= 40) out.push({ tone: 'info', title: 'Concentração de receita', text: `${ufNome(top.label)} concentra ${share.toFixed(0)}% do MRR. Dependência de uma praça é risco estrutural.` });
      }
    }
    return out;
  }, [ufVar, ufChurn, ufBreak]);

  const rankRows = useMemo(() => {
    const rows = [...mapData];
    rows.sort((a, b) => mode === 'variacao' ? Math.abs(b.value) - Math.abs(a.value) : b.value - a.value);
    return rows.slice(0, 8);
  }, [mapData, mode]);
  const maxRank = useMemo(() => Math.max(...mapData.map(d => Math.abs(d.value)), 1), [mapData]);

  const estadoRow: any = selectedState ? ufBreak.find((r: any) => r.label === selectedState) : null;
  const churnRow: any = selectedState ? ufChurn.find((r: any) => r.label === selectedState) : null;
  const cidadeRow: any = selectedCity ? cidades.find((r: any) => r.label === selectedCity) : null;
  const churnMrrPerdido = churnDet.reduce((s, c) => s + (c.mrr_perdido || 0), 0);

  const fmtVal = (v: number) => {
    if (mode === 'variacao') return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    if (metric === 'mrr' || metric === 'ticket') return fmtMoney(v);
    if (metric === 'margem' || metric === 'churn') return v.toFixed(1) + '%';
    return Math.round(v).toLocaleString('pt-BR');
  };

  const legend = mode === 'variacao'
    ? { left: 'caiu', right: 'cresceu', colors: ['hsl(2 76% 44%)', 'hsl(5 74% 52%)', 'hsl(210 14% 40%)', 'hsl(145 58% 44%)', 'hsl(145 64% 32%)'] }
    : metric === 'churn'
      ? { left: 'menor', right: 'maior', colors: ['hsl(48 85% 72%)', 'hsl(40 85% 62%)', 'hsl(20 82% 50%)', 'hsl(2 75% 38%)'] }
      : { left: 'menor', right: 'maior', colors: ['hsl(145 53% 75%)', 'hsl(145 53% 55%)', 'hsl(145 53% 44%)', 'hsl(145 53% 26%)'] };

  const metricOpts: { key: typeof metric; label: string }[] = [
    { key: 'qtd', label: 'Qtd clientes' }, { key: 'mrr', label: 'MRR' }, { key: 'ticket', label: 'Ticket médio' },
    { key: 'margem', label: 'Margem %' }, { key: 'churn', label: 'Churn' },
  ];
  const rankTitle = mode === 'variacao' ? 'Variação por estado' : `Ranking · ${metricOpts.find(o => o.key === metric)?.label}`;

  return (
    <div className="space-y-4">
      {/* Modo + métrica */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border overflow-hidden">
          {(['nivel', 'variacao'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('px-4 py-1.5 text-sm transition-colors', mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              {m === 'nivel' ? 'Nível' : 'Variação'}
            </button>
          ))}
        </div>

        {mode === 'nivel' ? (
          <div className="flex flex-wrap gap-2">
            {metricOpts.map(o => (
              <button
                key={o.key}
                onClick={() => setMetric(o.key)}
                className={cn('px-3 py-1.5 rounded-full border text-sm transition-colors', metric === o.key ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            Quanto a carteira de cada estado cresceu ou encolheu no período — verde subiu · vermelho caiu
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* Esquerda: mapa + legenda */}
        <div className="space-y-3">
          <BrazilChoroplethMap
            title="Distribuição geográfica"
            data={mapData}
            tvMode={tvMode}
            selectedState={selectedState}
            onSelectState={selectState}
            metric={mode === 'variacao' ? ('variacao' as any) : metric}
            citiesGeo={mode === 'nivel' && metric === 'churn' ? (distributions.citiesGeoChurn ?? []) : (distributions.citiesGeo ?? [])}
            markerColor={mode === 'nivel' && metric === 'churn' ? 'hsl(0 72% 50%)' : 'hsl(199 89% 45%)'}
            hideSidebar
          />
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <span>{legend.left}</span>
            {legend.colors.map((c, i) => (
              <span key={i} className="h-3 w-8 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span>{legend.right}</span>
          </div>
        </div>

        {/* Direita */}
        <div className="space-y-4">
          {!selectedState ? (
            <>
              {insights.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Leitura do período</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {insights.map((ins, i) => {
                        const Icon = ins.tone === 'down' ? TrendingDown : ins.tone === 'up' ? TrendingUp : ins.tone === 'warn' ? AlertTriangle : PieChart;
                        const color = ins.tone === 'down' ? 'text-red-500 bg-red-500/10'
                          : ins.tone === 'up' ? 'text-emerald-500 bg-emerald-500/10'
                          : ins.tone === 'warn' ? 'text-amber-500 bg-amber-500/10'
                          : 'text-sky-500 bg-sky-500/10';
                        return (
                          <li key={i} className="flex gap-3">
                            <div className={cn('h-8 w-8 rounded-full flex items-center justify-center shrink-0', color)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="text-sm leading-snug">
                              <span className="font-semibold">{ins.title}.</span>{' '}
                              <span className="text-muted-foreground">{ins.text}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{rankTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {rankRows.map((r) => {
                      const up = r.value >= 0;
                      const w = mode === 'variacao'
                        ? Math.min(Math.abs(r.value), CAP) / CAP * 100
                        : (Math.abs(r.value) / maxRank) * 100;
                      const barColor = mode === 'variacao' ? (up ? 'hsl(145 64% 40%)' : 'hsl(2 76% 52%)') : 'hsl(145 53% 40%)';
                      const txtColor = mode === 'variacao' ? (up ? 'text-emerald-500' : 'text-red-500') : 'text-foreground';
                      return (
                        <button
                          key={r.name}
                          onClick={() => selectState(r.name)}
                          className="w-full grid grid-cols-[3rem_1fr_5rem] items-center gap-2 text-sm hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                        >
                          <span className="font-medium text-left">{r.name}</span>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: barColor }} />
                          </div>
                          <span className={cn('font-mono text-right text-xs', txtColor)}>
                            {mode === 'variacao' ? (up ? '▲ ' : '▼ ') : ''}{fmtVal(r.value)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              {mode === 'variacao' && (
                <p className="text-xs text-muted-foreground leading-relaxed px-1">
                  <span className="font-medium text-foreground">Como ler:</span> mostra quanto o MRR da carteira de cada estado cresceu ou encolheu <span className="font-medium text-foreground">durante o período selecionado</span> (carteira no fim vs. no início). <span className="text-emerald-500 font-medium">Verde</span> subiu, <span className="text-red-500 font-medium">vermelho</span> caiu. A lista traz quem mais se moveu. Atenção: estado com poucos clientes vira % grande com qualquer mudança — confira o tamanho da base antes de concluir.
                </p>
              )}
            </>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 text-sm">
                  <button onClick={() => selectState(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                    Brasil
                  </button>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button
                    onClick={() => setSelectedCity(null)}
                    className={cn('transition-colors', selectedCity ? 'text-muted-foreground hover:text-foreground' : 'text-foreground font-semibold')}
                  >
                    {SIGLA_TO_NAME[selectedState] || selectedState}
                  </button>
                  {selectedCity && (
                    <>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-foreground font-semibold">{selectedCity}</span>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedCity ? (
                  <>
                    {/* Cards do estado */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Carteira</p>
                        <p className="text-lg font-semibold">{estadoRow?.qtd ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{fmtMoney(estadoRow?.mrr)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Ticket médio</p>
                        <p className="text-lg font-semibold">{fmtMoney(estadoRow?.ticket)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Churn</p>
                        <p className={cn('text-lg font-semibold', (churnRow?.churn_pct ?? 0) >= 0.2 ? 'text-red-500' : 'text-foreground')}>
                          {(((churnRow?.churn_pct ?? 0)) * 100).toFixed(0)}%
                        </p>
                        <p className="text-xs text-muted-foreground">{churnRow?.cancelados ?? 0} de {churnRow?.base ?? 0}</p>
                      </div>
                    </div>

                    {/* Abas Cidades | Saíram */}
                    <div className="inline-flex rounded-lg border overflow-hidden text-sm">
                      <button
                        onClick={() => setEstadoTab('cidades')}
                        className={cn('px-3 py-1.5 transition-colors', estadoTab === 'cidades' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                      >
                        Cidades
                      </button>
                      <button
                        onClick={() => setEstadoTab('churn')}
                        className={cn('px-3 py-1.5 transition-colors', estadoTab === 'churn' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                      >
                        Saíram ({churnDet.length})
                      </button>
                    </div>

                    {estadoTab === 'cidades' ? (
                      loadingCidades ? (
                        <p className="text-sm text-muted-foreground">Carregando…</p>
                      ) : cidades.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem cidades cadastradas.</p>
                      ) : (
                        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                          {cidades.map((c: any) => (
                            <li key={c.label}>
                              <button
                                onClick={() => setSelectedCity(c.label)}
                                className="w-full flex items-center justify-between gap-2 rounded-lg border p-2 hover:bg-muted/50 transition-colors text-left"
                              >
                                <span className="text-sm font-medium truncate">{c.label}</span>
                                <span className="text-xs text-muted-foreground shrink-0 font-mono">
                                  {c.qtd} cli · {fmtMoney(c.mrr)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {churnDet.length} cancelamento(s) · {fmtMoney(churnMrrPerdido)} de MRR perdido no período
                        </p>
                        {churnDet.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum cancelamento no período.</p>
                        ) : (
                          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                            {churnDet.map((c, i) => (
                              <li key={i} className="flex items-start justify-between gap-2 border-b pb-2 last:border-b-0">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{c.cliente}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {c.segmento}{c.cidade ? ' · ' + c.cidade : ''}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-sm font-mono">{fmtMoney(c.mrr_perdido)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {c.data_cancelamento ? c.data_cancelamento.split('-').reverse().join('/') : ''}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Cards da cidade */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Carteira</p>
                        <p className="text-lg font-semibold">{cidadeRow?.qtd ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{fmtMoney(cidadeRow?.mrr)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Ticket médio</p>
                        <p className="text-lg font-semibold">{fmtMoney(cidadeRow?.ticket)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Clientes ativos</h4>
                      {loadingClientes ? (
                        <p className="text-sm text-muted-foreground">Carregando…</p>
                      ) : clientesCidade.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum cliente ativo.</p>
                      ) : (
                        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                          {clientesCidade.map((c, i) => (
                            <li key={i} className="flex items-start justify-between gap-2 border-b pb-2 last:border-b-0">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{c.cliente}</p>
                                <p className="text-xs text-muted-foreground truncate">{c.segmento}</p>
                              </div>
                              <p className="text-sm font-mono shrink-0">{fmtMoney(c.mrr)}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
