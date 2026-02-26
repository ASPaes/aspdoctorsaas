import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLookups } from "@/hooks/useLookups";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Filter, ChevronDown, ChevronUp, CalendarIcon, ArrowUpDown, ArrowUp, ArrowDown, Users, TrendingUp, UserPlus } from "lucide-react";

type SortField = "codigo_sequencial" | "razao_social" | "nome_fantasia" | "cnpj" | "produto_id" | "mensalidade" | "cancelado";
type SortDir = "asc" | "desc";

interface DateRange {
  from?: Date;
  to?: Date;
}

function DateRangePicker({ label, value, onChange }: { label: string; value: DateRange; onChange: (v: DateRange) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-left text-xs h-8", !value.from && "text-muted-foreground")}>
              <CalendarIcon className="mr-1 h-3 w-3" />
              {value.from ? format(value.from, "dd/MM/yy") : "De"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={value.from} onSelect={(d) => onChange({ ...value, from: d })} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-left text-xs h-8", !value.to && "text-muted-foreground")}>
              <CalendarIcon className="mr-1 h-3 w-3" />
              {value.to ? format(value.to, "dd/MM/yy") : "Até"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={value.to} onSelect={(d) => onChange({ ...value, to: d })} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function RangeInput({ label, min, max, onMinChange, onMaxChange, prefix }: {
  label: string; min: string; max: string; onMinChange: (v: string) => void; onMaxChange: (v: string) => void; prefix?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1">
        <Input type="number" placeholder={prefix ? `${prefix} Min` : "Min"} value={min} onChange={(e) => onMinChange(e.target.value)} className="h-8 text-xs" />
        <Input type="number" placeholder={prefix ? `${prefix} Max` : "Max"} value={max} onChange={(e) => onMaxChange(e.target.value)} className="h-8 text-xs" />
      </div>
    </div>
  );
}

export default function Clientes() {
  const navigate = useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Quick filters
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("ativos");
  const [unidadeBaseQuick, setUnidadeBaseQuick] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // Advanced filters
  const [periodoCadastro, setPeriodoCadastro] = useState<DateRange>({});
  const [periodoCancelamento, setPeriodoCancelamento] = useState<DateRange>({});
  const [periodoVenda, setPeriodoVenda] = useState<DateRange>({});
  const [periodoAtivacao, setPeriodoAtivacao] = useState<DateRange>({});

  const [recorrenciaAdv, setRecorrenciaAdv] = useState("");
  const [modeloContratoId, setModeloContratoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [origemVendaId, setOrigemVendaId] = useState("");

  const [estadoId, setEstadoId] = useState<number | null>(null);
  const [cidadeId, setCidadeId] = useState("");
  const [motivoCancelamentoId, setMotivoCancelamentoId] = useState("");

  const [mensalidadeMin, setMensalidadeMin] = useState("");
  const [mensalidadeMax, setMensalidadeMax] = useState("");
  const [lucroMin, setLucroMin] = useState("");
  const [lucroMax, setLucroMax] = useState("");
  const [margemMin, setMargemMin] = useState("");
  const [margemMax, setMargemMax] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("razao_social");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Clear city when state changes
  useEffect(() => { setCidadeId(""); }, [estadoId]);

  const lookups = useLookups(estadoId);

  // Build query key from all filters
  const filterKey = useMemo(() => ({
    debouncedSearch, status, unidadeBaseQuick, periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao,
    recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, estadoId, cidadeId, motivoCancelamentoId,
    mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, sortField, sortDir,
  }), [debouncedSearch, status, unidadeBaseQuick, periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao,
    recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, estadoId, cidadeId, motivoCancelamentoId,
    mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, sortField, sortDir]);

  // Pagination
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filterKey]);

  // Query separada para "Novos no Mês" — conta TODOS os clientes com data_venda no mês atual
  const { data: novosNoMes } = useQuery({
    queryKey: ["clientes_novos_mes"],
    queryFn: async () => {
      const now = new Date();
      const firstDay = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const lastDay = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
      const { count, error } = await supabase
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("cancelado", false)
        .gte("data_venda", firstDay)
        .lte("data_venda", lastDay);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: queryResult, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["clientes_lista", filterKey, page],
    queryFn: async () => {
      const selectFields = "id, codigo_sequencial, razao_social, nome_fantasia, cnpj, produto_id, mensalidade, cancelado, lucro_real, margem_bruta_percent, data_venda, unidade_base_id";
      let q = supabase.from("vw_clientes_financeiro").select(selectFields, { count: "exact" }) as any;

      // Status
      if (status === "ativos") q = q.eq("cancelado", false);
      else if (status === "cancelados") q = q.eq("cancelado", true);

      // Text search
      if (debouncedSearch) {
        const s = `%${debouncedSearch}%`;
        const isNumeric = /^\d+$/.test(debouncedSearch.trim());
        if (isNumeric) {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s},codigo_sequencial.eq.${debouncedSearch.trim()}`);
        } else {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s}`);
        }
      }

      // Quick unidade base
      if (unidadeBaseQuick === "__null__") q = q.is("unidade_base_id", null);
      else if (unidadeBaseQuick) q = q.eq("unidade_base_id", Number(unidadeBaseQuick));

      // Advanced recurrence
      if (recorrenciaAdv === "__null__") q = q.is("recorrencia", null);
      else if (recorrenciaAdv) q = q.eq("recorrencia", recorrenciaAdv as any);

      // Date ranges
      const applyDateRange = (field: string, range: DateRange) => {
        if (range.from) q = q.gte(field, format(range.from, "yyyy-MM-dd"));
        if (range.to) q = q.lte(field, format(range.to, "yyyy-MM-dd"));
      };
      applyDateRange("data_cadastro", periodoCadastro);
      applyDateRange("data_cancelamento", periodoCancelamento);
      applyDateRange("data_venda", periodoVenda);
      applyDateRange("data_ativacao", periodoAtivacao);

      // Lookups
      if (modeloContratoId === "__null__") q = q.is("modelo_contrato_id", null);
      else if (modeloContratoId) q = q.eq("modelo_contrato_id", Number(modeloContratoId));
      if (produtoId === "__null__") q = q.is("produto_id", null);
      else if (produtoId) q = q.eq("produto_id", Number(produtoId));
      if (origemVendaId === "__null__") q = q.is("origem_venda_id", null);
      else if (origemVendaId) q = q.eq("origem_venda_id", Number(origemVendaId));
      if (estadoId === -1) q = q.is("estado_id", null);
      else if (estadoId) q = q.eq("estado_id", estadoId);
      if (cidadeId === "__null__") q = q.is("cidade_id", null);
      else if (cidadeId) q = q.eq("cidade_id", Number(cidadeId));
      if (motivoCancelamentoId === "__null__") q = q.is("motivo_cancelamento_id", null);
      else if (motivoCancelamentoId) q = q.eq("motivo_cancelamento_id", Number(motivoCancelamentoId));

      // Numeric ranges
      if (mensalidadeMin) q = q.gte("mensalidade", Number(mensalidadeMin));
      if (mensalidadeMax) q = q.lte("mensalidade", Number(mensalidadeMax));
      if (lucroMin) q = q.gte("lucro_real", Number(lucroMin));
      if (lucroMax) q = q.lte("lucro_real", Number(lucroMax));
      if (margemMin) q = q.gte("margem_bruta_percent", Number(margemMin));
      if (margemMax) q = q.lte("margem_bruta_percent", Number(margemMax));

      // Sort
      q = q.order(sortField, { ascending: sortDir === "asc" });

      // Pagination
      const from = page * PAGE_SIZE;
      q = q.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data as any[], totalCount: count as number };
    },
    placeholderData: (prev) => prev, // keep previous data while loading next page
  });

  const clientes = queryResult?.rows ?? [];
  const totalCount = queryResult?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Lookup maps for display
  const produtoMap = useMemo(() => {
    const m = new Map<number, string>();
    lookups.produtos.data?.forEach((p) => m.set(p.id, p.nome));
    return m;
  }, [lookups.produtos.data]);

  const unidadeBaseMap = useMemo(() => {
    const m = new Map<number, string>();
    lookups.unidadesBase.data?.forEach((u) => m.set(u.id, u.nome));
    return m;
  }, [lookups.unidadesBase.data]);

  const kpis = useMemo(() => {
    const list = clientes;
    const qtdClientes = totalCount;

    const comMensalidade = list.filter((c) => c.mensalidade != null && Number(c.mensalidade) > 0);
    const ticketMedio = comMensalidade.length > 0
      ? comMensalidade.reduce((acc, c) => acc + Number(c.mensalidade), 0) / comMensalidade.length
      : null;

    return { qtdClientes, ticketMedio, clientesNovosMes: novosNoMes ?? 0 };
  }, [clientes, totalCount, novosNoMes]);

  const formatCurrency = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }, [sortField]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const recorrenciaLabel = (_v: string | null) => {
    // kept for potential future use
    return "";
  };

  const clearFilters = () => {
    setPeriodoCadastro({}); setPeriodoCancelamento({}); setPeriodoVenda({}); setPeriodoAtivacao({});
    setRecorrenciaAdv(""); setModeloContratoId(""); setProdutoId(""); setOrigemVendaId("");
    setEstadoId(null); setCidadeId(""); setMotivoCancelamentoId("");
    setMensalidadeMin(""); setMensalidadeMax("");
    setLucroMin(""); setLucroMax(""); setMargemMin(""); setMargemMax("");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="mt-1 text-muted-foreground">Gerencie seus clientes aqui.</p>
        </div>
        <Button onClick={() => navigate("/clientes/novo")}>
          <Plus className="h-4 w-4" />
          Novo Cliente
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Qtde de Clientes</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-7 w-16" /> : <p className="text-2xl font-bold">{kpis.qtdClientes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ticket Médio</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-7 w-24" /> : <p className="text-2xl font-bold">{kpis.ticketMedio != null ? formatCurrency.format(kpis.ticketMedio) : "—"}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Novos no Mês</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{kpis.clientesNovosMes}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Quick filters bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por Cód. Seq., razão social, fantasia, CNPJ..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="cancelados">Cancelados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={unidadeBaseQuick || "__all__"} onValueChange={(v) => setUnidadeBaseQuick(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Unidade Base" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas Unidades</SelectItem>
            <SelectItem value="__null__">Nulo</SelectItem>
            {lookups.unidadesBase.data?.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Advanced filters */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="mr-1 h-4 w-4" />
              Filtros Avançados
              {filtersOpen ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          {filtersOpen && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground">
              Limpar filtros
            </Button>
          )}
        </div>
        <CollapsibleContent className="mt-2">
          <div className="rounded-lg border bg-card p-4 space-y-4">
            {/* Row 1 - Date ranges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <DateRangePicker label="Período de Cadastro" value={periodoCadastro} onChange={setPeriodoCadastro} />
              <DateRangePicker label="Período de Cancelamento" value={periodoCancelamento} onChange={setPeriodoCancelamento} />
              <DateRangePicker label="Período da Venda" value={periodoVenda} onChange={setPeriodoVenda} />
              <DateRangePicker label="Período de Ativação" value={periodoAtivacao} onChange={setPeriodoAtivacao} />
            </div>

            {/* Row 2 - Lookups */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Recorrência</label>
                <Select value={recorrenciaAdv} onValueChange={setRecorrenciaAdv}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="semestral">Semestral</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                    <SelectItem value="semanal">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Modelo de Contrato</label>
                <Select value={modeloContratoId} onValueChange={setModeloContratoId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.modelosContrato.data?.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Produto</label>
                <Select value={produtoId} onValueChange={setProdutoId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.produtos.data?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Origem da Venda</label>
                <Select value={origemVendaId} onValueChange={setOrigemVendaId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.origensVenda.data?.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3 - Estado/Cidade/Motivo/Mensalidade */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Estado</label>
                <Select value={estadoId ? String(estadoId) : ""} onValueChange={(v) => setEstadoId(v === "__null__" ? -1 : v ? Number(v) : null)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.estados.data?.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.sigla} - {e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cidade</label>
                <Select value={cidadeId} onValueChange={setCidadeId} disabled={!estadoId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={estadoId ? "Todas" : "Selecione estado"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.cidades.data?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Motivo Cancelamento</label>
                <Select value={motivoCancelamentoId} onValueChange={setMotivoCancelamentoId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.motivosCancelamento.data?.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.descricao}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <RangeInput label="Mensalidade R$" min={mensalidadeMin} max={mensalidadeMax} onMinChange={setMensalidadeMin} onMaxChange={setMensalidadeMax} prefix="R$" />
            </div>

            {/* Row 4 - Numeric ranges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <RangeInput label="Lucro Real R$" min={lucroMin} max={lucroMax} onMinChange={setLucroMin} onMaxChange={setLucroMax} prefix="R$" />
              <RangeInput label="Margem %" min={margemMin} max={margemMax} onMinChange={setMargemMin} onMaxChange={setMargemMax} prefix="%" />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Results table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {([
                ["codigo_sequencial", "Cód. Seq."],
                ["razao_social", "Razão Social"],
                ["nome_fantasia", "Nome Fantasia"],
                ["cnpj", "CNPJ"],
                ["produto_id", "Produto"],
                ["mensalidade", "Mensalidade"],
                ["cancelado", "Status"],
              ] as [SortField, string][]).map(([field, label]) => (
                <TableHead key={field}>
                  <button className="flex items-center font-medium hover:text-foreground" onClick={() => toggleSort(field)}>
                    {label}
                    <SortIcon field={field} />
                  </button>
                </TableHead>
              ))}
              <TableHead>Unidade Base</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !clientes?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              clientes.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <TableCell className="font-mono text-xs">{c.codigo_sequencial ?? "—"}</TableCell>
                  <TableCell className="font-medium">{c.razao_social || "—"}</TableCell>
                  <TableCell>{c.nome_fantasia || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.cnpj || "—"}</TableCell>
                  <TableCell>{c.produto_id ? produtoMap.get(c.produto_id) || "—" : "—"}</TableCell>
                  <TableCell>{c.mensalidade != null ? `R$ ${Number(c.mensalidade).toFixed(2)}` : "—"}</TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      c.cancelado ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}>
                      {c.cancelado ? "Cancelado" : "Ativo"}
                    </span>
                  </TableCell>
                  <TableCell>{c.unidade_base_id ? unidadeBaseMap.get(c.unidade_base_id) || "—" : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
