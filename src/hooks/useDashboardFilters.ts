import { useState, useEffect, useCallback } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import type { DashboardFilters } from '@/components/dashboard/types';

const STORAGE_KEY = 'dashboard-filters';

function serialize(filters: DashboardFilters) {
  return JSON.stringify({
    ...filters,
    periodoInicio: filters.periodoInicio?.toISOString() ?? null,
    periodoFim: filters.periodoFim?.toISOString() ?? null,
  });
}

function deserialize(raw: string): DashboardFilters | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      periodoInicio: parsed.periodoInicio ? new Date(parsed.periodoInicio) : null,
      periodoFim: parsed.periodoFim ? new Date(parsed.periodoFim) : null,
    };
  } catch {
    return null;
  }
}

function getDefaults(): DashboardFilters {
  const now = new Date();
  return {
    fornecedorId: null,
    periodoInicio: startOfMonth(now),
    periodoFim: endOfMonth(now),
    showAllData: false,
    unidadeBaseId: null,
  };
}

export function useDashboardFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = deserialize(raw);
        if (parsed) return parsed;
      }
    } catch {}
    return getDefaults();
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, serialize(filters));
    } catch {}
  }, [filters]);

  return { filters, setFilters };
}
