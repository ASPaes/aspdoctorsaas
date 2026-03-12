import { useState, useEffect, useCallback } from "react";
import type { DateRange } from "@/components/ui/date-range-picker";

const STORAGE_KEY = "clientes-filters";
const NAV_IDS_KEY = "clientes-nav-ids";

export interface ClientesFilters {
  searchText: string;
  status: string;
  unidadeBaseQuick: string;
  somenteMatrizes: boolean;
  periodoCadastro: DateRange;
  periodoCancelamento: DateRange;
  periodoVenda: DateRange;
  periodoAtivacao: DateRange;
  recorrenciaAdv: string;
  modeloContratoId: string;
  produtoId: string;
  origemVendaId: string;
  areaAtuacaoId: string;
  segmentoId: string;
  funcionarioId: string;
  fornecedorId: string;
  estadoId: string;
  cidadeId: string;
  motivoCancelamentoId: string;
  mensalidadeMin: string;
  mensalidadeMax: string;
  lucroMin: string;
  lucroMax: string;
  margemMin: string;
  margemMax: string;
  sortField: string;
  sortDir: string;
  page: number;
  filtersOpen: boolean;
}

const defaultFilters: ClientesFilters = {
  searchText: "",
  status: "ativos",
  unidadeBaseQuick: "",
  somenteMatrizes: false,
  periodoCadastro: {},
  periodoCancelamento: {},
  periodoVenda: {},
  periodoAtivacao: {},
  recorrenciaAdv: "",
  modeloContratoId: "",
  produtoId: "",
  origemVendaId: "",
  areaAtuacaoId: "",
  segmentoId: "",
  funcionarioId: "",
  fornecedorId: "",
  estadoId: "",
  cidadeId: "",
  motivoCancelamentoId: "",
  mensalidadeMin: "",
  mensalidadeMax: "",
  lucroMin: "",
  lucroMax: "",
  margemMin: "",
  margemMax: "",
  sortField: "razao_social",
  sortDir: "asc",
  page: 0,
  filtersOpen: false,
};

function serializeDateRange(dr: DateRange): { from?: string; to?: string } {
  return {
    from: dr.from ? dr.from.toISOString() : undefined,
    to: dr.to ? dr.to.toISOString() : undefined,
  };
}

function deserializeDateRange(obj: any): DateRange {
  if (!obj) return {};
  return {
    from: obj.from ? new Date(obj.from) : undefined,
    to: obj.to ? new Date(obj.to) : undefined,
  };
}

function loadFromSession(): ClientesFilters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFilters;
    const parsed = JSON.parse(raw);
    return {
      ...defaultFilters,
      ...parsed,
      periodoCadastro: deserializeDateRange(parsed.periodoCadastro),
      periodoCancelamento: deserializeDateRange(parsed.periodoCancelamento),
      periodoVenda: deserializeDateRange(parsed.periodoVenda),
      periodoAtivacao: deserializeDateRange(parsed.periodoAtivacao),
    };
  } catch {
    return defaultFilters;
  }
}

function saveToSession(filters: ClientesFilters) {
  try {
    const serializable = {
      ...filters,
      periodoCadastro: serializeDateRange(filters.periodoCadastro),
      periodoCancelamento: serializeDateRange(filters.periodoCancelamento),
      periodoVenda: serializeDateRange(filters.periodoVenda),
      periodoAtivacao: serializeDateRange(filters.periodoAtivacao),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // ignore storage errors
  }
}

export function useClientesFilters() {
  const [filters, setFilters] = useState<ClientesFilters>(loadFromSession);

  // Persist on every change
  useEffect(() => {
    saveToSession(filters);
  }, [filters]);

  const updateFilter = useCallback(<K extends keyof ClientesFilters>(key: K, value: ClientesFilters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      // Reset page when any filter (except page itself) changes
      if (key !== "page" && key !== "filtersOpen") {
        next.page = 0;
      }
      // Clear city when state changes
      if (key === "estadoId") {
        next.cidadeId = "";
      }
      return next;
    });
  }, []);

  const clearAdvancedFilters = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      periodoCadastro: {},
      periodoCancelamento: {},
      periodoVenda: {},
      periodoAtivacao: {},
      recorrenciaAdv: "",
      modeloContratoId: "",
      produtoId: "",
      origemVendaId: "",
      areaAtuacaoId: "",
      segmentoId: "",
      funcionarioId: "",
      fornecedorId: "",
      estadoId: "",
      cidadeId: "",
      motivoCancelamentoId: "",
      mensalidadeMin: "",
      mensalidadeMax: "",
      lucroMin: "",
      lucroMax: "",
      margemMin: "",
      margemMax: "",
      unidadeBaseQuick: "",
      page: 0,
    }));
  }, []);

  return { filters, updateFilter, clearAdvancedFilters, setFilters };
}

/** Store navigation IDs for in-form prev/next navigation */
export function storeNavIds(ids: string[]) {
  try {
    sessionStorage.setItem(NAV_IDS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** Read navigation IDs */
export function getNavIds(): string[] {
  try {
    const raw = sessionStorage.getItem(NAV_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
