import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subMonths } from 'date-fns';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface CohortForecastParams {
  fromCohortMonth?: string;
  toCohortMonth?: string;
  maxAgeMonths?: number;
  fornecedorId?: number | null;
  unidadeBaseId?: number | null;
}

export interface CohortForecastRow {
  horizonte_meses: number;
  base_clientes: number;
  base_mrr: number;
  perda_clientes_esp: number;
  perda_mrr_esp: number;
  retencao_clientes_esp_pct: number;
  retencao_mrr_esp_pct: number;
}

export interface UseCohortForecastResult {
  isLoading: boolean;
  rows: CohortForecastRow[];
}

function normalizeMonth(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function useCohortForecast(params: CohortForecastParams = {}): UseCohortForecastResult {
  const { effectiveTenantId: tid } = useTenantFilter();
  const maxAge = Math.min(params.maxAgeMonths ?? 12, 36);
  const from = params.fromCohortMonth
    ? normalizeMonth(params.fromCohortMonth)
    : format(subMonths(new Date(), 12), 'yyyy-MM-dd');
  const to = params.toCohortMonth
    ? normalizeMonth(params.toCohortMonth)
    : format(new Date(), 'yyyy-MM-dd');
  const fornecedorId = params.fornecedorId ?? null;
  const unidadeBaseId = params.unidadeBaseId ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ['cohort-forecast', from, to, maxAge, fornecedorId, unidadeBaseId, tid],
    queryFn: async () => {
      const rpcParams: Record<string, any> = {
        p_from_month: from,
        p_to_month: to,
        p_max_age: maxAge,
        p_horizontes: [6, 12],
      };
      if (fornecedorId != null) rpcParams.p_fornecedor_id = fornecedorId;
      if (unidadeBaseId != null) rpcParams.p_unidade_base_id = unidadeBaseId;
      if (tid) rpcParams.p_tenant_id = tid;

      const { data, error } = await supabase.rpc('fn_cohort_survival_forecast' as any, rpcParams);
      if (error) throw error;
      return (data ?? []) as CohortForecastRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const rows = (data ?? [])
      .map(r => ({
        horizonte_meses: Number(r.horizonte_meses),
        base_clientes: Number(r.base_clientes),
        base_mrr: Number(r.base_mrr),
        perda_clientes_esp: Number(r.perda_clientes_esp),
        perda_mrr_esp: Number(r.perda_mrr_esp),
        retencao_clientes_esp_pct: Number(r.retencao_clientes_esp_pct),
        retencao_mrr_esp_pct: Number(r.retencao_mrr_esp_pct),
      }))
      .sort((a, b) => a.horizonte_meses - b.horizonte_meses);
    return { isLoading, rows };
  }, [data, isLoading]);
}
