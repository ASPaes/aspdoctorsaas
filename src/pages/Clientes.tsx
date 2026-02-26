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
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Filter, ChevronDown, ChevronUp, CalendarIcon, ArrowUpDown, ArrowUp, ArrowDown, Users, TrendingUp, UserPlus, X } from "lucide-react";

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
        <Input type="text" inputMode="decimal" placeholder={prefix ? `${prefix} Min` : "Min"} value={min} onChange={(e) => onMinChange(e.target.value)} className="h-8 text-xs" />
        <Input type="text" inputMode="decimal" placeholder={prefix ? `${prefix} Max` : "Max"} value={max} onChange={(e) => onMaxChange(e.target.value)} className="h-8 text-xs" />
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
  const [areaAtuacaoId, setAreaAtuacaoId] = useState("");
  const [segmentoId, setSegmentoId] = useState("");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");

  // estadoId is now string: "" = all, "__null__" = null filter, "123" = id
  const [estadoId, setEstadoId] = useState("");
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

  // Convert estadoId to number for useLookups (needs numeric id to fetch cidades)
  const estadoIdNumeric = estadoId && estadoId !== "__null__" ? Number(estadoId) : null;
  const lookups = useLookups(estadoIdNumeric);

  // Build query key from all filters
  const filterKey = useMemo(() => ({
    debouncedSearch, status, unidadeBaseQuick, periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao,
    recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, areaAtuacaoId, segmentoId, funcionarioId, fornecedorId,
    estadoId, cidadeId, motivoCancelamentoId,
    mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, sortField, sortDir,
  }), [debouncedSearch, status, unidadeBaseQuick, periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao,
    recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, areaAtuacaoId, segmentoId, funcionarioId, fornecedorId,
    estadoId, cidadeId, motivoCancelamentoId,
    mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, sortField, sortDir]);

  // Pagination
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filterKey]);

  const parseFilterNumber = useCallback((value: string): number | null => {
    const raw = value.trim();
    if (!raw) return null;
    let normalized = raw;
    if (normalized.includes(",") && normalized.includes(".")) normalized = normalized.replace(/\./g, "").replace(",", ".");
    else if (normalized.includes(",")) normalized = normalized.replace(",", ".");
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }, []);

  const valueFilters = useMemo(() => ({
    mensalidadeMin: parseFilterNumber(mensalidadeMin),
    mensalidadeMax: parseFilterNumber(mensalidadeMax),
    lucroMin: parseFilterNumber(lucroMin),
    lucroMax: parseFilterNumber(lucroMax),
    margemMin: parseFilterNumber(margemMin),
    margemMax: parseFilterNumber(margemMax),
  }), [mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, parseFilterNumber]);

  const hasDateOrValueFilters = useMemo(() => {
    const hasDateFilter = periodoCadastro.from || periodoCadastro.to
      || periodoCancelamento.from || periodoCancelamento.to
      || periodoVenda.from || periodoVenda.to
      || periodoAtivacao.from || periodoAtivacao.to;

    const hasValueFilter = valueFilters.mensalidadeMin !== null
      || valueFilters.mensalidadeMax !== null
      || valueFilters.lucroMin !== null
      || valueFilters.lucroMax !== null
      || valueFilters.margemMin !== null
      || valueFilters.margemMax !== null;

    return Boolean(hasDateFilter || hasValueFilter);
  }, [periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao, valueFilters]);

  const round2 = useCallback((n: number) => Math.round((n + Number.EPSILON) * 100) / 100, []);

  const computeLucroReal = useCallback((row: any) => {
    const mensalidade = Number(row.mensalidade ?? 0);
    if (!(mensalidade > 0)) return 0;
    const custo = Number(row.custo_operacao ?? 0);
    const imposto = Number(row.imposto_percentual ?? 0);
    const fixo = Number(row.custo_fixo_percentual ?? 0);
    return round2((mensalidade - custo) - round2(mensalidade * imposto) - round2(mensalidade * fixo));
  }, [round2]);

  const computeMargemBruta = useCallback((row: any) => {
    const mensalidade = Number(row.mensalidade ?? 0);
    if (!(mensalidade > 0)) return 0;
    const custo = Number(row.custo_operacao ?? 0);
    return round2(((mensalidade - custo) / mensalidade) * 100);
  }, [round2]);

  const applyCommonFiltersOnClientes = useCallback((query: any, options?: { forNovosNoMes?: boolean }) => {
    let q = query;
    const forNovosNoMes = options?.forNovosNoMes === true;

    if (forNovosNoMes) {
      const now = new Date();
      const firstDay = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const lastDay = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
      q = q.eq("cancelado", false)
        .gte("data_venda", firstDay)
        .lte("data_venda", lastDay);
    } else {
      if (status === "ativos") q = q.eq("cancelado", false);
      else if (status === "cancelados") q = q.eq("cancelado", true);
    }

    if (debouncedSearch) {
      const s = `%${debouncedSearch}%`;
      const isNumeric = /^\d+$/.test(debouncedSearch.trim());
      if (isNumeric) {
        q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s},codigo_sequencial.eq.${debouncedSearch.trim()}`);
      } else {
        q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s}`);
      }
    }

    if (unidadeBaseQuick === "__null__") q = q.is("unidade_base_id", null);
    else if (unidadeBaseQuick) q = q.eq("unidade_base_id", Number(unidadeBaseQuick));

    if (recorrenciaAdv === "__null__") q = q.is("recorrencia", null);
    else if (recorrenciaAdv) q = q.eq("recorrencia", recorrenciaAdv as any);

    const applyLookupFilter = (field: string, val: string) => {
      if (val === "__null__") q = q.is(field, null);
      else if (val) q = q.eq(field, Number(val));
    };
    applyLookupFilter("modelo_contrato_id", modeloContratoId);
    applyLookupFilter("produto_id", produtoId);
    applyLookupFilter("origem_venda_id", origemVendaId);
    applyLookupFilter("estado_id", estadoId);
    applyLookupFilter("cidade_id", cidadeId);
    applyLookupFilter("motivo_cancelamento_id", motivoCancelamentoId);
    applyLookupFilter("area_atuacao_id", areaAtuacaoId);
    applyLookupFilter("segmento_id", segmentoId);
    applyLookupFilter("funcionario_id", funcionarioId);
    applyLookupFilter("fornecedor_id", fornecedorId);

    const applyDateRange = (field: string, range: DateRange) => {
      if (range.from) q = q.gte(field, format(range.from, "yyyy-MM-dd"));
      if (range.to) q = q.lte(field, format(range.to, "yyyy-MM-dd"));
    };
    applyDateRange("data_cadastro", periodoCadastro);
    applyDateRange("data_cancelamento", periodoCancelamento);
    applyDateRange("data_venda", periodoVenda);
    applyDateRange("data_ativacao", periodoAtivacao);

    if (valueFilters.mensalidadeMin !== null) q = q.gte("mensalidade", valueFilters.mensalidadeMin);
    if (valueFilters.mensalidadeMax !== null) q = q.lte("mensalidade", valueFilters.mensalidadeMax);

    return q;
  }, [
    areaAtuacaoId,
    cidadeId,
    debouncedSearch,
    estadoId,
    fornecedorId,
    funcionarioId,
    modeloContratoId,
    motivoCancelamentoId,
    origemVendaId,
    periodoAtivacao,
    periodoCadastro,
    periodoCancelamento,
    periodoVenda,
    produtoId,
    recorrenciaAdv,
    segmentoId,
    status,
    unidadeBaseQuick,
    valueFilters,
  ]);

  const fetchClientesFilteredRows = useCallback(async (options?: { forNovosNoMes?: boolean }) => {
    const selectFields = [
      "id",
      "codigo_sequencial",
      "razao_social",
      "nome_fantasia",
      "cnpj",
      "produto_id",
      "mensalidade",
      "cancelado",
      "data_venda",
      "unidade_base_id",
      "custo_operacao",
      "imposto_percentual",
      "custo_fixo_percentual",
    ].join(",");

    const pageSize = 1000;
    const rows: any[] = [];

    for (let offset = 0; ; offset += pageSize) {
      let q = supabase.from("clientes").select(selectFields) as any;
      q = applyCommonFiltersOnClientes(q, options);
      q = q.range(offset, offset + pageSize - 1);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      rows.push(...data);
      if (data.length < pageSize) break;
    }

    const filtered = rows.filter((row) => {
      const lucroReal = computeLucroReal(row);
      const margemBruta = computeMargemBruta(row);

      if (valueFilters.lucroMin !== null && lucroReal < valueFilters.lucroMin) return false;
      if (valueFilters.lucroMax !== null && lucroReal > valueFilters.lucroMax) return false;
      if (valueFilters.margemMin !== null && margemBruta < valueFilters.margemMin) return false;
      if (valueFilters.margemMax !== null && margemBruta > valueFilters.margemMax) return false;

      return true;
    });

    const withCalculated = filtered.map((row) => ({
      ...row,
      lucro_real: computeLucroReal(row),
      margem_bruta_percent: computeMargemBruta(row),
    }));

    if (options?.forNovosNoMes) return withCalculated;

    const sorted = [...withCalculated].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      let cmp = 0;
      if (sortField === "mensalidade" || sortField === "codigo_sequencial") {
        cmp = Number(aVal ?? Number.NEGATIVE_INFINITY) - Number(bVal ?? Number.NEGATIVE_INFINITY);
      } else if (sortField === "cancelado") {
        cmp = Number(Boolean(aVal)) - Number(Boolean(bVal));
      } else {
        cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""), "pt-BR", { sensitivity: "base" });
      }

      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [applyCommonFiltersOnClientes, computeLucroReal, computeMargemBruta, sortDir, sortField, valueFilters]);

  // Query "Novos no Mês" respeitando os filtros ativos
  const { data: novosNoMes } = useQuery({
    queryKey: ["clientes_novos_mes", filterKey],
    queryFn: async () => {
      if (hasDateOrValueFilters) {
        const rows = await fetchClientesFilteredRows({ forNovosNoMes: true });
        return rows.length;
      }

      const now = new Date();
      const firstDay = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const lastDay = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
      let q = supabase
        .from("vw_clientes_financeiro")
        .select("id", { count: "exact", head: true }) as any;

      q = q.eq("cancelado", false)
        .gte("data_venda", firstDay)
        .lte("data_venda", lastDay);

      if (debouncedSearch) {
        const s = `%${debouncedSearch}%`;
        const isNumeric = /^\d+$/.test(debouncedSearch.trim());
        if (isNumeric) {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s},codigo_sequencial.eq.${debouncedSearch.trim()}`);
        } else {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s}`);
        }
      }
      if (unidadeBaseQuick === "__null__") q = q.is("unidade_base_id", null);
      else if (unidadeBaseQuick) q = q.eq("unidade_base_id", Number(unidadeBaseQuick));

      if (recorrenciaAdv === "__null__") q = q.is("recorrencia", null);
      else if (recorrenciaAdv) q = q.eq("recorrencia", recorrenciaAdv as any);

      const applyLookup = (field: string, val: string) => {
        if (val === "__null__") q = q.is(field, null);
        else if (val) q = q.eq(field, Number(val));
      };
      applyLookup("modelo_contrato_id", modeloContratoId);
      applyLookup("produto_id", produtoId);
      applyLookup("origem_venda_id", origemVendaId);
      applyLookup("estado_id", estadoId);
      applyLookup("cidade_id", cidadeId);
      applyLookup("motivo_cancelamento_id", motivoCancelamentoId);
      applyLookup("area_atuacao_id", areaAtuacaoId);
      applyLookup("segmento_id", segmentoId);
      applyLookup("funcionario_id", funcionarioId);
      applyLookup("fornecedor_id", fornecedorId);

      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: queryResult, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["clientes_lista", filterKey, page],
    queryFn: async () => {
      if (hasDateOrValueFilters) {
        const rows = await fetchClientesFilteredRows();
        const from = page * PAGE_SIZE;
        return {
          rows: rows.slice(from, from + PAGE_SIZE),
          totalCount: rows.length,
        };
      }

      const selectFields = "id, codigo_sequencial, razao_social, nome_fantasia, cnpj, produto_id, mensalidade, cancelado, lucro_real, margem_bruta_percent, data_venda, unidade_base_id";
      let q = supabase.from("vw_clientes_financeiro").select(selectFields, { count: "exact" }) as any;

      if (status === "ativos") q = q.eq("cancelado", false);
      else if (status === "cancelados") q = q.eq("cancelado", true);

      if (debouncedSearch) {
        const s = `%${debouncedSearch}%`;
        const isNumeric = /^\d+$/.test(debouncedSearch.trim());
        if (isNumeric) {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s},codigo_sequencial.eq.${debouncedSearch.trim()}`);
        } else {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s}`);
        }
      }

      if (unidadeBaseQuick === "__null__") q = q.is("unidade_base_id", null);
      else if (unidadeBaseQuick) q = q.eq("unidade_base_id", Number(unidadeBaseQuick));

      if (recorrenciaAdv === "__null__") q = q.is("recorrencia", null);
      else if (recorrenciaAdv) q = q.eq("recorrencia", recorrenciaAdv as any);

      const applyLookupFilter = (field: string, val: string) => {
        if (val === "__null__") q = q.is(field, null);
        else if (val) q = q.eq(field, Number(val));
      };
      applyLookupFilter("modelo_contrato_id", modeloContratoId);
      applyLookupFilter("produto_id", produtoId);
      applyLookupFilter("origem_venda_id", origemVendaId);
      applyLookupFilter("estado_id", estadoId);
      applyLookupFilter("cidade_id", cidadeId);
      applyLookupFilter("motivo_cancelamento_id", motivoCancelamentoId);
      applyLookupFilter("area_atuacao_id", areaAtuacaoId);
      applyLookupFilter("segmento_id", segmentoId);
      applyLookupFilter("funcionario_id", funcionarioId);
      applyLookupFilter("fornecedor_id", fornecedorId);

      q = q.order(sortField, { ascending: sortDir === "asc" });

      const from = page * PAGE_SIZE;
      q = q.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data as any[], totalCount: count as number };
    },
    placeholderData: (prev) => prev,
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

  const clearFilters = () => {
    setPeriodoCadastro({}); setPeriodoCancelamento({}); setPeriodoVenda({}); setPeriodoAtivacao({});
    setRecorrenciaAdv(""); setModeloContratoId(""); setProdutoId(""); setOrigemVendaId("");
    setAreaAtuacaoId(""); setSegmentoId(""); setFuncionarioId(""); setFornecedorId("");
    setEstadoId(""); setCidadeId(""); setMotivoCancelamentoId("");
    setMensalidadeMin(""); setMensalidadeMax("");
    setLucroMin(""); setLucroMax(""); setMargemMin(""); setMargemMax("");
    setUnidadeBaseQuick("");
  };

  // Helper to resolve display name for a filter value
  const resolveLabel = (val: string, items: { id: number; nome?: string; descricao?: string; sigla?: string }[] | undefined): string => {
    if (val === "__null__") return "Nulo";
    const item = items?.find((i) => String(i.id) === val);
    if (!item) return val;
    if (item.sigla) return `${item.sigla} - ${(item as any).nome}`;
    return item.nome || (item as any).descricao || val;
  };

  const recorrenciaLabels: Record<string, string> = { mensal: "Mensal", semestral: "Semestral", anual: "Anual", semanal: "Semanal", __null__: "Nulo" };

  // Active filter badges
  const activeFilters = useMemo(() => {
    const badges: { key: string; label: string; displayValue: string; onClear: () => void }[] = [];

    if (unidadeBaseQuick) badges.push({ key: "ub", label: "Unidade Base", displayValue: resolveLabel(unidadeBaseQuick, lookups.unidadesBase.data), onClear: () => setUnidadeBaseQuick("") });
    if (recorrenciaAdv) badges.push({ key: "rec", label: "Recorrência", displayValue: recorrenciaLabels[recorrenciaAdv] || recorrenciaAdv, onClear: () => setRecorrenciaAdv("") });
    if (modeloContratoId) badges.push({ key: "mc", label: "Mod. Contrato", displayValue: resolveLabel(modeloContratoId, lookups.modelosContrato.data), onClear: () => setModeloContratoId("") });
    if (produtoId) badges.push({ key: "prod", label: "Produto", displayValue: resolveLabel(produtoId, lookups.produtos.data), onClear: () => setProdutoId("") });
    if (origemVendaId) badges.push({ key: "ov", label: "Origem Venda", displayValue: resolveLabel(origemVendaId, lookups.origensVenda.data), onClear: () => setOrigemVendaId("") });
    if (areaAtuacaoId) badges.push({ key: "aa", label: "Área Atuação", displayValue: resolveLabel(areaAtuacaoId, lookups.areasAtuacao.data), onClear: () => setAreaAtuacaoId("") });
    if (segmentoId) badges.push({ key: "seg", label: "Segmento", displayValue: resolveLabel(segmentoId, lookups.segmentos.data), onClear: () => setSegmentoId("") });
    if (funcionarioId) badges.push({ key: "func", label: "Funcionário", displayValue: resolveLabel(funcionarioId, lookups.funcionarios.data), onClear: () => setFuncionarioId("") });
    if (fornecedorId) badges.push({ key: "forn", label: "Fornecedor", displayValue: resolveLabel(fornecedorId, lookups.fornecedores.data), onClear: () => setFornecedorId("") });
    if (estadoId) badges.push({ key: "est", label: "Estado", displayValue: resolveLabel(estadoId, lookups.estados.data as any), onClear: () => setEstadoId("") });
    if (cidadeId) badges.push({ key: "cid", label: "Cidade", displayValue: resolveLabel(cidadeId, lookups.cidades.data), onClear: () => setCidadeId("") });
    if (motivoCancelamentoId) badges.push({ key: "mot", label: "Motivo Cancel.", displayValue: resolveLabel(motivoCancelamentoId, lookups.motivosCancelamento.data?.map(m => ({ id: m.id, nome: m.descricao }))), onClear: () => setMotivoCancelamentoId("") });

    const fmtDate = (d: Date) => format(d, "dd/MM/yy");
    if (periodoCadastro.from || periodoCadastro.to) badges.push({ key: "pc", label: "Cadastro", displayValue: `${periodoCadastro.from ? fmtDate(periodoCadastro.from) : "…"} – ${periodoCadastro.to ? fmtDate(periodoCadastro.to) : "…"}`, onClear: () => setPeriodoCadastro({}) });
    if (periodoCancelamento.from || periodoCancelamento.to) badges.push({ key: "pcan", label: "Cancelamento", displayValue: `${periodoCancelamento.from ? fmtDate(periodoCancelamento.from) : "…"} – ${periodoCancelamento.to ? fmtDate(periodoCancelamento.to) : "…"}`, onClear: () => setPeriodoCancelamento({}) });
    if (periodoVenda.from || periodoVenda.to) badges.push({ key: "pv", label: "Venda", displayValue: `${periodoVenda.from ? fmtDate(periodoVenda.from) : "…"} – ${periodoVenda.to ? fmtDate(periodoVenda.to) : "…"}`, onClear: () => setPeriodoVenda({}) });
    if (periodoAtivacao.from || periodoAtivacao.to) badges.push({ key: "pa", label: "Ativação", displayValue: `${periodoAtivacao.from ? fmtDate(periodoAtivacao.from) : "…"} – ${periodoAtivacao.to ? fmtDate(periodoAtivacao.to) : "…"}`, onClear: () => setPeriodoAtivacao({}) });

    if (mensalidadeMin || mensalidadeMax) badges.push({ key: "mens", label: "Mensalidade", displayValue: `${mensalidadeMin || "…"} – ${mensalidadeMax || "…"}`, onClear: () => { setMensalidadeMin(""); setMensalidadeMax(""); } });
    if (lucroMin || lucroMax) badges.push({ key: "luc", label: "Lucro", displayValue: `${lucroMin || "…"} – ${lucroMax || "…"}`, onClear: () => { setLucroMin(""); setLucroMax(""); } });
    if (margemMin || margemMax) badges.push({ key: "marg", label: "Margem", displayValue: `${margemMin || "…"} – ${margemMax || "…"}`, onClear: () => { setMargemMin(""); setMargemMax(""); } });

    return badges;
  }, [unidadeBaseQuick, recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, areaAtuacaoId, segmentoId, funcionarioId, fornecedorId, estadoId, cidadeId, motivoCancelamentoId, periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao, mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax, lookups]);

  // Helper for Select value/onChange with __all__ pattern
  const selVal = (v: string) => v || "__all__";
  const selChange = (setter: (v: string) => void) => (v: string) => setter(v === "__all__" ? "" : v);

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
        <Select value={selVal(unidadeBaseQuick)} onValueChange={selChange(setUnidadeBaseQuick)}>
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
          {activeFilters.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground">
              Limpar filtros
            </Button>
          )}
        </div>

        {/* Active filter badges — always visible */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {activeFilters.map((f) => (
              <Badge key={f.key} variant="secondary" className="pl-2 pr-1 py-0.5 text-xs gap-1 cursor-default">
                <span className="font-medium">{f.label}:</span> {f.displayValue}
                <button
                  onClick={(e) => { e.stopPropagation(); f.onClear(); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

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
                <Select value={selVal(recorrenciaAdv)} onValueChange={selChange(setRecorrenciaAdv)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
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
                <Select value={selVal(modeloContratoId)} onValueChange={selChange(setModeloContratoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.modelosContrato.data?.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Produto</label>
                <Select value={selVal(produtoId)} onValueChange={selChange(setProdutoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.produtos.data?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Origem da Venda</label>
                <Select value={selVal(origemVendaId)} onValueChange={selChange(setOrigemVendaId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.origensVenda.data?.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3 - More lookups */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Área de Atuação</label>
                <Select value={selVal(areaAtuacaoId)} onValueChange={selChange(setAreaAtuacaoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.areasAtuacao.data?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Segmento</label>
                <Select value={selVal(segmentoId)} onValueChange={selChange(setSegmentoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.segmentos.data?.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Funcionário</label>
                <Select value={selVal(funcionarioId)} onValueChange={selChange(setFuncionarioId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.funcionarios.data?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
                <Select value={selVal(fornecedorId)} onValueChange={selChange(setFornecedorId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.fornecedores.data?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4 - Estado/Cidade/Motivo/Mensalidade */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Estado</label>
                <Select value={selVal(estadoId)} onValueChange={selChange(setEstadoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.estados.data?.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.sigla} - {e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cidade</label>
                <Select value={selVal(cidadeId)} onValueChange={selChange(setCidadeId)} disabled={!estadoIdNumeric}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={estadoIdNumeric ? undefined : "Selecione estado"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.cidades.data?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Motivo Cancelamento</label>
                <Select value={selVal(motivoCancelamentoId)} onValueChange={selChange(setMotivoCancelamentoId)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="__null__">Nulo</SelectItem>
                    {lookups.motivosCancelamento.data?.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.descricao}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <RangeInput label="Mensalidade R$" min={mensalidadeMin} max={mensalidadeMax} onMinChange={setMensalidadeMin} onMaxChange={setMensalidadeMax} prefix="R$" />
            </div>

            {/* Row 5 - Numeric ranges */}
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
