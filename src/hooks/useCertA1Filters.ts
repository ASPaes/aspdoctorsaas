import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "certificados-a1-filters";

export interface CertA1Filters {
  searchText: string;
  quickFilter: string;
  statusFilter: string;
  somenteGanho: boolean;
  vencimentoDe: string;
  vencimentoAte: string;
  sortField: string;
  sortDir: string;
}

const defaultFilters: CertA1Filters = {
  searchText: "",
  quickFilter: "todos",
  statusFilter: "",
  somenteGanho: false,
  vencimentoDe: "",
  vencimentoAte: "",
  sortField: "cert_a1_vencimento",
  sortDir: "asc",
};

function load(): CertA1Filters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFilters;
    return { ...defaultFilters, ...JSON.parse(raw) };
  } catch {
    return defaultFilters;
  }
}

function save(f: CertA1Filters) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {}
}

export function useCertA1Filters() {
  const [filters, setFilters] = useState<CertA1Filters>(load);

  useEffect(() => { save(filters); }, [filters]);

  const updateFilter = useCallback(<K extends keyof CertA1Filters>(key: K, value: CertA1Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { filters, updateFilter };
}
