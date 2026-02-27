import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { useLookups } from "@/hooks/useLookups";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const tipoLabels: Record<string, string> = {
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  downsell: "Downsell",
  venda_avulsa: "Venda Avulsa",
};

const tipoBadgeStyles: Record<string, string> = {
  upsell: "bg-green-500/10 text-green-700 dark:text-green-400",
  cross_sell: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  downsell: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  venda_avulsa: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

type SortField = "data_movimento" | "tipo" | "valor_delta" | "cliente_nome" | "funcionario_nome";
type SortDir = "asc" | "desc";

export default function MovimentosMrrTab() {
  const now = new Date();
  const [periodo, setPeriodo] = useState<DateRange>({
    from: startOfMonth(now),
    to: endOfMonth(now),
  });
  const [tipoFilter, setTipoFilter] = useState("");
  const [funcionarioFilter, setFuncionarioFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("data_movimento");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const lookups = useLookups();

  const { data: movimentos, isLoading } = useQuery({
    queryKey: ["movimentos_mrr_list", periodo, tipoFilter, funcionarioFilter],
    queryFn: async () => {
      let q = supabase
        .from("movimentos_mrr")
        .select("id, tipo, valor_delta, custo_delta, valor_venda_avulsa, data_movimento, descricao, status, estornado_por, estorno_de, cliente_id, funcionario_id, origem_venda, criado_em")
        .eq("status", "ativo")
        .is("estornado_por", null)
        .is("estorno_de", null)
        .order("data_movimento", { ascending: false });

      if (periodo.from) q = q.gte("data_movimento", format(periodo.from, "yyyy-MM-dd"));
      if (periodo.to) q = q.lte("data_movimento", format(periodo.to, "yyyy-MM-dd"));
      if (tipoFilter) q = q.eq("tipo", tipoFilter as any);
      if (funcionarioFilter) q = q.eq("funcionario_id", Number(funcionarioFilter));

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch client names for display
  const clienteIds = useMemo(() => [...new Set((movimentos || []).map(m => m.cliente_id))], [movimentos]);
  const { data: clientesMap } = useQuery({
    queryKey: ["clientes_nomes", clienteIds],
    queryFn: async () => {
      if (!clienteIds.length) return {};
      const map: Record<string, string> = {};
      // Fetch in batches of 100
      for (let i = 0; i < clienteIds.length; i += 100) {
        const batch = clienteIds.slice(i, i + 100);
        const { data } = await supabase
          .from("clientes")
          .select("id, razao_social, nome_fantasia")
          .in("id", batch);
        data?.forEach(c => {
          map[c.id] = c.razao_social || c.nome_fantasia || "—";
        });
      }
      return map;
    },
    enabled: clienteIds.length > 0,
  });

  // Fetch funcionario names
  const funcMap = useMemo(() => {
    const m: Record<number, string> = {};
    lookups.funcionarios.data?.forEach(f => { m[f.id] = f.nome; });
    return m;
  }, [lookups.funcionarios.data]);

  // KPI totals
  const totals = useMemo(() => {
    const items = movimentos || [];
    const upsell = items.filter(m => m.tipo === "upsell").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const crossSell = items.filter(m => m.tipo === "cross_sell").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const downsell = items.filter(m => m.tipo === "downsell").reduce((s, m) => s + Math.abs(Number(m.valor_delta) || 0), 0);
    const vendaAvulsa = items.filter(m => m.tipo === "venda_avulsa").reduce((s, m) => s + (Number(m.valor_venda_avulsa) || 0), 0);
    const qtdTotal = items.length;
    return { upsell, crossSell, downsell, vendaAvulsa, qtdTotal };
  }, [movimentos]);

  // Sorted data
  const sortedData = useMemo(() => {
    const items = [...(movimentos || [])];
    items.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "data_movimento":
          cmp = (a.data_movimento || "").localeCompare(b.data_movimento || "");
          break;
        case "tipo":
          cmp = (a.tipo || "").localeCompare(b.tipo || "");
          break;
        case "valor_delta":
          cmp = (Number(a.valor_delta) || 0) - (Number(b.valor_delta) || 0);
          break;
        case "cliente_nome":
          cmp = ((clientesMap?.[a.cliente_id] || "").localeCompare(clientesMap?.[b.cliente_id] || ""));
          break;
        case "funcionario_nome":
          cmp = ((funcMap[a.funcionario_id || 0] || "").localeCompare(funcMap[b.funcionario_id || 0] || ""));
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [movimentos, sortField, sortDir, clientesMap, funcMap]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <DateRangePicker
          label="Período"
          value={periodo}
          onChange={(v) => setPeriodo(v)}
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Tipo de Movimento</label>
          <Select value={tipoFilter || "__all__"} onValueChange={(v) => setTipoFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="upsell">Upsell</SelectItem>
              <SelectItem value="cross_sell">Cross-sell</SelectItem>
              <SelectItem value="downsell">Downsell</SelectItem>
              <SelectItem value="venda_avulsa">Venda Avulsa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Funcionário</label>
          <Select value={funcionarioFilter || "__all__"} onValueChange={(v) => setFuncionarioFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {lookups.funcionarios.data?.map(f => (
                <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Upsell</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-green-700 dark:text-green-400">+{fmt.format(totals.upsell)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Cross-sell</CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-blue-700 dark:text-blue-400">+{fmt.format(totals.crossSell)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Downsell</CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-orange-700 dark:text-orange-400">-{fmt.format(totals.downsell)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Vendas Avulsas</CardTitle>
            <DollarSign className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{fmt.format(totals.vendaAvulsa)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Qtd Movimentos</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-12" /> : (
              <p className="text-lg font-bold">{totals.qtdTotal}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {([
                ["data_movimento", "Data"],
                ["tipo", "Tipo"],
                ["cliente_nome", "Cliente"],
                ["valor_delta", "Valor Delta"],
              ] as [SortField, string][]).map(([field, label]) => (
                <TableHead key={field}>
                  <button className="flex items-center font-medium hover:text-foreground" onClick={() => toggleSort(field)}>
                    {label}
                    <SortIcon field={field} />
                  </button>
                </TableHead>
              ))}
              <TableHead>Custo Delta</TableHead>
              <TableHead>
                <button className="flex items-center font-medium hover:text-foreground" onClick={() => toggleSort("funcionario_nome")}>
                  Funcionário
                  <SortIcon field="funcionario_nome" />
                </button>
              </TableHead>
              <TableHead>Descrição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !sortedData.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Nenhum movimento encontrado no período.
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {m.data_movimento ? format(parseISO(m.data_movimento), "dd/MM/yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs font-medium", tipoBadgeStyles[m.tipo] || "")}>
                      {tipoLabels[m.tipo] || m.tipo}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {clientesMap?.[m.cliente_id] || "—"}
                  </TableCell>
                  <TableCell className={cn("font-mono text-sm font-medium",
                    Number(m.valor_delta) > 0 ? "text-green-700 dark:text-green-400" :
                    Number(m.valor_delta) < 0 ? "text-orange-700 dark:text-orange-400" : ""
                  )}>
                    {m.tipo === "venda_avulsa"
                      ? fmt.format(Number(m.valor_venda_avulsa) || 0)
                      : fmt.format(Number(m.valor_delta) || 0)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {Number(m.custo_delta) ? fmt.format(Number(m.custo_delta)) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.funcionario_id ? funcMap[m.funcionario_id] || "—" : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {m.descricao || "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
