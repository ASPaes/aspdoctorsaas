import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Search, X, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { MultiSelectFilter } from '@/components/atendimento/MultiSelectFilter';
import { exportNovosClientesXlsx } from '@/lib/exportNovosClientesXlsx';
import type { NovoClienteListItem } from '../types';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

/**
 * `dataVenda` vem de uma coluna `date` ('YYYY-MM-DD'). `new Date(s)` interpreta
 * como meia-noite UTC e, em America/Sao_Paulo, a tela mostrava sempre o dia
 * anterior. `parseISO` de string date-only resolve em horario local.
 */
const fmtData = (v: string) => {
  if (!v) return '—';
  try {
    return format(parseISO(v.slice(0, 10)), 'dd/MM/yyyy');
  } catch {
    return '—';
  }
};

/** Data local em 'YYYY-MM-DD' para comparar com o campo `date` sem passar por UTC. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

type SortField = 'razaoSocial' | 'dataVenda' | 'vendedor' | 'origem' | 'valorAtivacao' | 'mensalidade';
type SortDir = 'asc' | 'desc';

const COLUMNS: { field: SortField; label: string; numeric?: boolean }[] = [
  { field: 'razaoSocial', label: 'Nome' },
  { field: 'dataVenda', label: 'Data Venda' },
  { field: 'vendedor', label: 'Vendedor' },
  { field: 'origem', label: 'Origem' },
  { field: 'valorAtivacao', label: 'Vlr Ativação', numeric: true },
  { field: 'mensalidade', label: 'Vlr MRR', numeric: true },
];

const parseValor = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

interface Props {
  items: NovoClienteListItem[];
  tvMode: boolean;
}

export function NovosClientesTable({ items, tvMode }: Props) {
  const [busca, setBusca] = useState('');
  const [vendedores, setVendedores] = useState<string[]>([]);
  const [origens, setOrigens] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<{ from: Date; to: Date } | null>(null);
  const [ativMin, setAtivMin] = useState('');
  const [ativMax, setAtivMax] = useState('');
  const [mrrMin, setMrrMin] = useState('');
  const [mrrMax, setMrrMax] = useState('');

  const [sortField, setSortField] = useState<SortField>('dataVenda');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const vendedorOptions = useMemo(
    () => Array.from(new Set(items.map((c) => c.vendedor).filter(Boolean)))
      .sort(collator.compare)
      .map((v) => ({ id: v, nome: v })),
    [items],
  );

  const origemOptions = useMemo(
    () => Array.from(new Set(items.map((c) => c.origem).filter(Boolean)))
      .sort(collator.compare)
      .map((v) => ({ id: v, nome: v })),
    [items],
  );

  // Limites do seletor de data quando nenhum recorte proprio foi feito: mostra o
  // intervalo real da lista em vez de um periodo inventado.
  const bounds = useMemo(() => {
    const datas = items.map((c) => c.dataVenda).filter(Boolean).sort();
    const hoje = new Date();
    if (!datas.length) return { from: hoje, to: hoje };
    return { from: parseISO(datas[0].slice(0, 10)), to: parseISO(datas[datas.length - 1].slice(0, 10)) };
  }, [items]);

  const valoresAtivos = [ativMin, ativMax, mrrMin, mrrMax].filter((s) => s.trim() !== '').length;

  const temFiltro =
    busca.trim() !== '' || vendedores.length > 0 || origens.length > 0 || periodo !== null || valoresAtivos > 0;

  const limpar = () => {
    setBusca('');
    setVendedores([]);
    setOrigens([]);
    setPeriodo(null);
    setAtivMin('');
    setAtivMax('');
    setMrrMin('');
    setMrrMax('');
  };

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const de = periodo ? ymd(periodo.from) : null;
    const ate = periodo ? ymd(periodo.to) : null;
    const nAtivMin = parseValor(ativMin);
    const nAtivMax = parseValor(ativMax);
    const nMrrMin = parseValor(mrrMin);
    const nMrrMax = parseValor(mrrMax);

    return items.filter((c) => {
      if (termo) {
        const alvo = `${c.razaoSocial} ${c.nomeFantasia ?? ''}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      if (vendedores.length && !vendedores.includes(c.vendedor)) return false;
      if (origens.length && !origens.includes(c.origem)) return false;
      if (de || ate) {
        const d = (c.dataVenda || '').slice(0, 10);
        if (!d) return false;
        if (de && d < de) return false;
        if (ate && d > ate) return false;
      }
      if (nAtivMin !== null && c.valorAtivacao < nAtivMin) return false;
      if (nAtivMax !== null && c.valorAtivacao > nAtivMax) return false;
      if (nMrrMin !== null && c.mensalidade < nMrrMin) return false;
      if (nMrrMax !== null && c.mensalidade > nMrrMax) return false;
      return true;
    });
  }, [items, busca, vendedores, origens, periodo, ativMin, ativMax, mrrMin, mrrMax]);

  const linhas = useMemo(() => {
    const arr = [...filtrados];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'razaoSocial':
          cmp = collator.compare(a.razaoSocial || '', b.razaoSocial || '');
          break;
        case 'dataVenda':
          cmp = (a.dataVenda || '').localeCompare(b.dataVenda || '');
          break;
        case 'vendedor':
          cmp = collator.compare(a.vendedor || '', b.vendedor || '');
          break;
        case 'origem':
          cmp = collator.compare(a.origem || '', b.origem || '');
          break;
        case 'valorAtivacao':
          cmp = a.valorAtivacao - b.valorAtivacao;
          break;
        case 'mensalidade':
          cmp = a.mensalidade - b.mensalidade;
          break;
      }
      // Desempate estavel: sem isso, valores iguais trocam de lugar a cada render.
      if (cmp === 0) cmp = collator.compare(a.razaoSocial || '', b.razaoSocial || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtrados, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Valor e data comecam pelo maior, que e o que se quer olhar primeiro.
      setSortDir(field === 'dataVenda' || field === 'valorAtivacao' || field === 'mensalidade' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const exportar = () => {
    try {
      exportNovosClientesXlsx(linhas);
    } catch (e: any) {
      toast.error('Falha ao exportar: ' + (e?.message ?? String(e)));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        {/* `CardHeader` centraliza os filhos; sem `w-full` o titulo e o botao ficam colados no meio. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
            Novos Clientes no Período ({temFiltro ? `${linhas.length} de ${items.length}` : items.length})
          </CardTitle>
          {!tvMode && (
            <Button variant="outline" size="sm" onClick={exportar} disabled={linhas.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar Excel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!tvMode && items.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome..."
                className="h-9 pl-8"
              />
            </div>

            <MultiSelectFilter
              label={vendedores.length ? 'Vendedores' : 'Todos os vendedores'}
              options={vendedorOptions}
              selected={vendedores}
              onChange={setVendedores}
              className="h-9"
              searchPlaceholder="Buscar vendedor..."
            />

            <MultiSelectFilter
              label={origens.length ? 'Origens' : 'Todas as origens'}
              options={origemOptions}
              selected={origens}
              onChange={setOrigens}
              className="h-9"
              searchPlaceholder="Buscar origem..."
            />

            <div className="flex items-center gap-1">
              <DateRangePicker
                dateRange={periodo ?? bounds}
                onDateRangeChange={setPeriodo}
                className="h-9"
              />
              {periodo && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setPeriodo(null)}
                  title="Limpar filtro de data"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Valores
                  {valoresAtivos > 0 && (
                    <Badge variant="secondary" className="ml-2">{valoresAtivos}</Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[260px] space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Vlr Ativação (R$)</Label>
                  <div className="flex items-center gap-2">
                    <Input value={ativMin} onChange={(e) => setAtivMin(e.target.value)} placeholder="mín" inputMode="decimal" className="h-8" />
                    <Input value={ativMax} onChange={(e) => setAtivMax(e.target.value)} placeholder="máx" inputMode="decimal" className="h-8" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Vlr MRR (R$)</Label>
                  <div className="flex items-center gap-2">
                    <Input value={mrrMin} onChange={(e) => setMrrMin(e.target.value)} placeholder="mín" inputMode="decimal" className="h-8" />
                    <Input value={mrrMax} onChange={(e) => setMrrMax(e.target.value)} placeholder="máx" inputMode="decimal" className="h-8" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {temFiltro && (
              <Button variant="ghost" size="sm" className="h-9" onClick={limpar}>
                <X className="mr-1 h-4 w-4" />
                Limpar
              </Button>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum novo cliente no período selecionado.</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum cliente atende aos filtros aplicados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map(({ field, label, numeric }) => (
                  <TableHead key={field} className={numeric ? 'text-right' : undefined}>
                    <button
                      type="button"
                      className={`flex w-full items-center font-medium hover:text-foreground ${numeric ? 'justify-end' : ''}`}
                      onClick={() => toggleSort(field)}
                    >
                      {label}
                      <SortIcon field={field} />
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">{c.razaoSocial}</span>
                      {c.nomeFantasia && (
                        <span className="block text-xs text-muted-foreground">{c.nomeFantasia}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{fmtData(c.dataVenda)}</TableCell>
                  <TableCell>{c.vendedor}</TableCell>
                  <TableCell className="max-w-[150px] truncate" title={c.origem}>{c.origem}</TableCell>
                  <TableCell className="text-right">{fmt(c.valorAtivacao)}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(c.mensalidade)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
