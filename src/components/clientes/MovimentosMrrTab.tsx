import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { useLookups } from "@/hooks/useLookups";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, UserMinus, ArrowUpCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProtectedElement } from "@/components/auth/ProtectedElement";
import { MultiSelectFilter } from "@/components/atendimento/MultiSelectFilter";
import { exportMovimentosMrrXlsx, type ClienteInfo } from "@/lib/exportMovimentosMrrXlsx";
import { toast } from "sonner";



const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const tipoLabels: Record<string, string> = {
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  downsell: "Downsell",
  venda_avulsa: "Venda Avulsa",
  reactivation: "Reativação",
  reajuste: "Reajuste",
  churn: "Churn",
};

const tipoBadgeStyles: Record<string, string> = {
  upsell: "bg-green-500/10 text-green-700 dark:text-green-400",
  cross_sell: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  downsell: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  venda_avulsa: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  reactivation: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  reajuste: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  churn: "bg-red-500/10 text-red-700 dark:text-red-400",
};

type SortField = "data_movimento" | "tipo" | "valor_delta" | "cliente_nome" | "funcionario_nome";
type SortDir = "asc" | "desc";

// Sentinela para "Sem fornecedor" no multi-select (ids reais de fornecedor são > 0).
const SEM_FORNECEDOR = -1;

// Quantos cliente_ids por request no `.in()` — UUID tem 37 chars na URL e
// PostgREST/proxy cortam GETs muito longos.
const CLIENTES_CHUNK = 150;

function formatCNPJ(v?: string | null): string {
  if (!v) return "";
  const d = String(v).replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}

function ClienteCell({ info }: { info?: ClienteInfo }) {
  if (!info) return <>—</>;
  const fantasia = info.fantasia && info.fantasia !== info.razao ? info.fantasia : "";
  return (
    <>
      <div className="truncate">{info.razao || "—"}</div>
      {(fantasia || info.cnpj) && (
        <div className="truncate text-[11px] leading-tight text-muted-foreground">
          {fantasia}
          {fantasia && info.cnpj ? " · " : ""}
          {info.cnpj && <span className="font-mono">{info.cnpj}</span>}
        </div>
      )}
    </>
  );
}

export default function MovimentosMrrTab() {
  const now = new Date();
  const [periodo, setPeriodo] = useState<DateRange>({
    from: startOfMonth(now),
    to: endOfMonth(now),
  });
  const [tipoFilter, setTipoFilter] = useState("");
  const [funcionarioFilter, setFuncionarioFilter] = useState("");
  const [fornecedorFilter, setFornecedorFilter] = useState<number[]>([]);
  const [sortField, setSortField] = useState<SortField>("data_movimento");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const lookups = useLookups();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;

  // Ordenado para a queryKey não invalidar só porque o usuário clicou em outra ordem.
  const fornecedorSel = useMemo(
    () => [...fornecedorFilter].sort((a, b) => a - b),
    [fornecedorFilter]
  );

  const { data: movimentos, isLoading } = useQuery({
    queryKey: ["movimentos_mrr_list", periodo, tipoFilter, funcionarioFilter, fornecedorSel, tid],
    queryFn: async () => {
      const data = await fetchAllRows<any>(() => {
        let q = supabase
          .from("vw_movimentos_mrr" as any)
          .select("id, tipo, valor_delta, custo_delta, valor_venda_avulsa, data_movimento, descricao, status, estornado_por, estorno_de, cliente_id, funcionario_id, fornecedor_efetivo, origem_venda, criado_em, cliente_razao_social, cliente_nome_fantasia, funcionario_nome")
          .eq("status", "ativo")
          .is("estornado_por", null)
          .is("estorno_de", null)
          .order("data_movimento", { ascending: false });

        q = tf(q);

        if (periodo.from) q = q.gte("data_movimento", format(periodo.from, "yyyy-MM-dd"));
        if (periodo.to) q = q.lte("data_movimento", format(periodo.to, "yyyy-MM-dd"));
        if (tipoFilter) q = q.eq("tipo", tipoFilter as any);
        if (funcionarioFilter) q = q.eq("funcionario_id", Number(funcionarioFilter));
        // Multi-seleção: "Sem fornecedor" convive com N fornecedores reais.
        // Só cai no `.or()` (que anula o índice) quando os dois casos são pedidos juntos.
        const semFornecedor = fornecedorSel.includes(SEM_FORNECEDOR);
        const idsFornecedor = fornecedorSel.filter((id) => id !== SEM_FORNECEDOR);
        if (semFornecedor && idsFornecedor.length) {
          q = q.or(`fornecedor_efetivo.is.null,fornecedor_efetivo.in.(${idsFornecedor.join(",")})`);
        } else if (semFornecedor) {
          q = q.is("fornecedor_efetivo", null);
        } else if (idsFornecedor.length) {
          q = q.in("fornecedor_efetivo", idsFornecedor);
        }

        return q;
      });
      return data || [];
    },
  });

  const { data: fornecedores } = useQuery({
    queryKey: ["movimentos_mrr_fornecedores_efetivo", tid],
    queryFn: async () => {
      if (!tid) return [];
      const { data: idsRaw } = await supabase
        .from("vw_movimentos_mrr" as any)
        .select("fornecedor_efetivo")
        .eq("tenant_id", tid)
        .not("fornecedor_efetivo", "is", null);
      const ids = [...new Set((idsRaw || []).map((x: any) => x.fornecedor_efetivo))].filter(Boolean);
      if (!ids.length) return [];
      const { data } = await supabase
        .from("fornecedores")
        .select("id, nome")
        .eq("tenant_id", tid)
        .in("id", ids as any)
        .order("nome", { ascending: true });
      return data || [];
    },
    enabled: !!tid,
  });

  const clienteIds = useMemo(() => {
    const s = new Set<string>();
    (movimentos || []).forEach((m: any) => { if (m.cliente_id) s.add(m.cliente_id); });
    return [...s].sort();
  }, [movimentos]);

  // A view vw_movimentos_mrr traz razão social e nome fantasia, mas não o CNPJ —
  // buscamos só ele em `clientes`, em lotes, sem mexer na view.
  const { data: cnpjMap } = useQuery({
    queryKey: ["movimentos_mrr_clientes_cnpj", tid, clienteIds],
    queryFn: async () => {
      const out: Record<string, string> = {};
      for (let i = 0; i < clienteIds.length; i += CLIENTES_CHUNK) {
        const chunk = clienteIds.slice(i, i + CLIENTES_CHUNK);
        const { data, error } = await tf(
          supabase.from("clientes").select("id, cnpj").in("id", chunk)
        );
        if (error) throw error;
        (data || []).forEach((c: any) => { out[c.id] = c.cnpj || ""; });
      }
      return out;
    },
    enabled: clienteIds.length > 0,
  });

  // Razão social e nome fantasia vêm achatados da view; CNPJ vem da query acima.
  const clientesMap = useMemo(() => {
    const map: Record<string, ClienteInfo> = {};
    (movimentos || []).forEach((m: any) => {
      if (!m.cliente_id) return;
      map[m.cliente_id] = {
        razao: m.cliente_razao_social || m.cliente_nome_fantasia || "—",
        fantasia: m.cliente_nome_fantasia || "",
        cnpj: formatCNPJ(cnpjMap?.[m.cliente_id]),
      };
    });
    return map;
  }, [movimentos, cnpjMap]);

  // Fetch funcionario names
  const funcMap = useMemo(() => {
    const m: Record<number, string> = {};
    lookups.funcionarios.data?.forEach(f => { m[f.id] = f.nome; });
    return m;
  }, [lookups.funcionarios.data]);

  const fornecedorMap = useMemo(() => {
    return new Map<number, string>((fornecedores ?? []).map((f: any) => [f.id, f.nome]));
  }, [fornecedores]);

  const fornecedorOptions = useMemo(() => [
    { id: SEM_FORNECEDOR, nome: "Sem fornecedor" },
    ...(fornecedores ?? []).map((f: any) => ({ id: f.id as number, nome: f.nome as string })),
  ], [fornecedores]);

  // O MultiSelectFilter já mostra a contagem num badge — o label não repete o número.
  const fornecedorLabel = fornecedorFilter.length === 0
    ? "Todos os fornecedores"
    : fornecedorFilter.length === 1
      ? (fornecedorOptions.find(o => o.id === fornecedorFilter[0])?.nome ?? "Fornecedores")
      : "Fornecedores";

  const handleExportXlsx = () => {
    try {
      exportMovimentosMrrXlsx({
        rows: sortedData,
        clientesMap: clientesMap ?? {},
        funcMap,
        fornecedorMap,
      });
    } catch (e: any) {
      toast.error("Falha ao exportar: " + (e?.message ?? String(e)));
    }

  };



  // KPI totals
  const totals = useMemo(() => {
    const items = movimentos || [];
    const upsell = items.filter(m => m.tipo === "upsell").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const crossSell = items.filter(m => m.tipo === "cross_sell").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const downsell = items.filter(m => m.tipo === "downsell").reduce((s, m) => s + Math.abs(Number(m.valor_delta) || 0), 0);
    const vendaAvulsa = items.filter(m => m.tipo === "venda_avulsa").reduce((s, m) => s + (Number(m.valor_venda_avulsa) || 0), 0);
    const reactivation = items.filter(m => m.tipo === "reactivation").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const reajuste = items.filter(m => m.tipo === "reajuste").reduce((s, m) => s + (Number(m.valor_delta) || 0), 0);
    const churn = items.filter(m => m.tipo === "churn").reduce((s, m) => s + Math.abs(Number(m.valor_delta) || 0), 0);
    const qtdTotal = items.length;
    return { upsell, crossSell, downsell, vendaAvulsa, reactivation, reajuste, churn, qtdTotal };
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
          cmp = ((clientesMap?.[a.cliente_id]?.razao || "").localeCompare(clientesMap?.[b.cliente_id]?.razao || ""));
          break;
        case "funcionario_nome":
          cmp = ((a.funcionario_nome || funcMap[a.funcionario_id || 0] || "").localeCompare(b.funcionario_nome || funcMap[b.funcionario_id || 0] || ""));
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
              <SelectItem value="reactivation">Reativação</SelectItem>
              <SelectItem value="reajuste">Reajuste</SelectItem>
              <SelectItem value="churn">Churn</SelectItem>
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
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
          <MultiSelectFilter
            label={fornecedorLabel}
            options={fornecedorOptions}
            selected={fornecedorFilter}
            onChange={setFornecedorFilter}
            className="h-9 w-[220px] font-normal"
            searchPlaceholder="Buscar fornecedor..."
          />
        </div>
        <div className="ml-auto">
          <ProtectedElement resource="clientes.exportar" action="view" mode="notify">
            <Button
              variant="outline"
              onClick={handleExportXlsx}
              disabled={isLoading || sortedData.length === 0}
            >
              <Download className="h-4 w-4" />
              Exportar XLSX
            </Button>
          </ProtectedElement>
        </div>
      </div>


      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
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
            <CardTitle className="text-xs font-medium text-muted-foreground">Reativação</CardTitle>
            <RefreshCw className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">+{fmt.format(totals.reactivation)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Reajuste</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-cyan-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <div>
                <p className="text-lg font-bold text-cyan-700 dark:text-cyan-400">+{fmt.format(totals.reajuste)}</p>
                <p className="text-[9px] text-muted-foreground">Não soma no MRR</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Churn</CardTitle>
            <UserMinus className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-6 w-20" /> : (
              <p className="text-lg font-bold text-red-700 dark:text-red-400">-{fmt.format(totals.churn)}</p>
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
                  <TableCell className="max-w-[240px] text-sm">
                    <ClienteCell info={clientesMap?.[m.cliente_id]} />
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
                    {m.funcionario_nome || (m.funcionario_id ? funcMap[m.funcionario_id] : null) || "—"}
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
