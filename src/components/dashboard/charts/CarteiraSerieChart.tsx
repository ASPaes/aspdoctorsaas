import { useState, useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DashboardFilters } from '../types';
import { useCarteiraSerieUf } from '../hooks/useDistribuicaoExtras';

const PALETTE = ['#22C55E', '#0EA5E9', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#A855F7'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtYm = (ym: string) => { const [y, m] = ym.split('-'); return `${MESES[+m - 1]}/${y.slice(2)}`; };

interface Props { filters: DashboardFilters; }

export function CarteiraSerieChart({ filters }: Props) {
  const [meses, setMeses] = useState<12 | 24>(12);
  const [metricSerie, setMetricSerie] = useState<'mrr' | 'qtd'>('mrr');
  const [selectedUfs, setSelectedUfs] = useState<Set<string> | null>(null);

  const { data: rows = [], isLoading } = useCarteiraSerieUf(filters, meses);

  const allUfsSorted = useMemo(() => [...new Set(rows.map(r => r.uf))].sort(), [rows]);

  const ufsOrdenados = useMemo(() => {
    const ymList = [...new Set(rows.map(r => r.ym))].sort();
    const lastYm = ymList[ymList.length - 1];
    const valByUf: Record<string, number> = {};
    rows.filter(r => r.ym === lastYm).forEach(r => { valByUf[r.uf] = metricSerie === 'mrr' ? r.mrr : r.qtd; });
    return [...new Set(rows.map(r => r.uf))].sort((a, b) => (valByUf[b] || 0) - (valByUf[a] || 0));
  }, [rows, metricSerie]);

  const activeUfs = selectedUfs ?? new Set(ufsOrdenados.slice(0, 6));

  const toggleUf = (uf: string) => {
    const base = selectedUfs ?? new Set(ufsOrdenados.slice(0, 6));
    const next = new Set(base);
    if (next.has(uf)) next.delete(uf); else next.add(uf);
    setSelectedUfs(next);
  };

  const chartData = useMemo(() => {
    const ymList = [...new Set(rows.map(r => r.ym))].sort();
    const byKey: Record<string, number> = {};
    rows.forEach(r => { byKey[`${r.ym}|${r.uf}`] = metricSerie === 'mrr' ? r.mrr : r.qtd; });
    return ymList.map(ym => {
      const o: Record<string, number | string> = { ym };
      [...activeUfs].forEach(uf => { o[uf] = byKey[`${ym}|${uf}`] ?? 0; });
      return o;
    });
  }, [rows, activeUfs, metricSerie]);

  const colorFor = (uf: string) => PALETTE[Math.max(0, allUfsSorted.indexOf(uf)) % PALETTE.length];
  const fmtY = (v: number) => metricSerie === 'mrr' ? (v >= 1000 ? 'R$ ' + (v / 1000).toFixed(0) + 'k' : 'R$ ' + v) : String(v);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Evolução da carteira por estado</CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border overflow-hidden text-sm">
              {(['mrr', 'qtd'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMetricSerie(m)}
                  className={cn('px-3 py-1 transition-colors', metricSerie === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                >
                  {m === 'mrr' ? 'MRR' : 'Clientes'}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border overflow-hidden text-sm">
              {([12, 24] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMeses(m)}
                  className={cn('px-3 py-1 transition-colors', meses === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {ufsOrdenados.map(uf => {
            const on = activeUfs.has(uf);
            return (
              <button
                key={uf}
                onClick={() => toggleUf(uf)}
                className={cn('px-2 py-0.5 rounded-full border text-xs font-medium transition-colors', on ? 'text-white' : 'text-muted-foreground border-border hover:bg-muted')}
                style={on ? { backgroundColor: colorFor(uf), borderColor: colorFor(uf) } : undefined}
              >
                {uf}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Carregando…</p>
        ) : chartData.length === 0 || activeUfs.size === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Selecione ao menos um estado.</p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="ym" tickFormatter={fmtYm} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tickFormatter={fmtY} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={70} />
              <Tooltip
                labelFormatter={(label: string) => fmtYm(label)}
                formatter={(value: number, name: string) => [metricSerie === 'mrr' ? 'R$ ' + Math.round(value).toLocaleString('pt-BR') : value, name]}
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              />
              {[...activeUfs].map(uf => (
                <Line key={uf} type="monotone" dataKey={uf} stroke={colorFor(uf)} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
