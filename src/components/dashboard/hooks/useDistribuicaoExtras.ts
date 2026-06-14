import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type { DashboardFilters } from '../types';

export interface CarteiraBreakdownRow {
  label: string;
  qtd: number;
  mrr: number;
  custo: number;
  margem_rs: number;
  margem_pct: number;
  ticket: number;
}

export interface CarteiraChurnRow {
  label: string;
  base: number;
  cancelados: number;
  churn_pct: number;
  mrr_perdido: number;
}

function resolvePeriodo(filters: DashboardFilters): { iniStr: string; fimStr: string } {
  if (filters.showAllData) {
    return {
      iniStr: '2000-01-01',
      fimStr: format(new Date(), 'yyyy-MM-dd'),
    };
  }
  const ini = filters.periodoInicio || startOfMonth(new Date());
  const fim = filters.periodoFim || endOfMonth(new Date());
  return {
    iniStr: format(ini, 'yyyy-MM-dd'),
    fimStr: format(fim, 'yyyy-MM-dd'),
  };
}

export function useCarteiraBreakdown(
  filters: DashboardFilters,
  dim: string,
  uf: string | null = null,
) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { fimStr } = resolvePeriodo(filters);

  return useQuery({
    queryKey: ['carteira-breakdown', tid, fimStr, dim, uf],
    enabled: !!tid && !!dim,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraBreakdownRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_breakdown', {
        p_tenant: tid,
        p_dim: dim,
        p_fim: fimStr,
        p_uf: uf,
      });
      if (error) throw error;
      return (data || []) as CarteiraBreakdownRow[];
    },
  });
}

export function useCarteiraChurn(
  filters: DashboardFilters,
  nivel: string,
  uf: string | null = null,
) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);

  return useQuery({
    queryKey: ['carteira-churn', tid, iniStr, fimStr, nivel, uf],
    enabled: !!tid && !!nivel,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraChurnRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_churn', {
        p_tenant: tid,
        p_nivel: nivel,
        p_ini: iniStr,
        p_fim: fimStr,
        p_uf: uf,
      });
      if (error) throw error;
      return (data || []) as CarteiraChurnRow[];
    },
  });
}
