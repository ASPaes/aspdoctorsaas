import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface CohortSaldoParams {
  fornecedorId?: number | null;
  unidadeBaseId?: number | null;
  janelaMeses?: number;
}

export interface CohortSaldoRow {
  horizonte_meses: number;
  base_clientes: number;
  base_mrr: number;
  perda_clientes: number;
  ganho_clientes: number;
  saldo_clientes: number;
  perda_mrr: number;
  ganho_mrr: number;
  saldo_mrr: number;
}

export interface UseCohortForecastResult {
  isLoading: boolean;
  rows: CohortSaldoRow[];
}

export function useCohortForecast(params: CohortSaldoParams = {}): UseCohortForecastResult {
  const { effectiveTenantId: tid } = useTenantFilter();
  const fornecedorId = params.fornecedorId ?? null;
  const unidadeBaseId = params.unidadeBaseId ?? null;
  const janela = params.janelaMeses ?? 12;

  const { data, isLoading } = useQuery({
    queryKey: ['cohort-saldo', janela, fornecedorId, unidadeBaseId, tid],
    queryFn: async () => {
      const rpcParams: Record<string, any> = { p_janela_meses: janela, p_horizontes: [3, 6, 12] };
      if (fornecedorId != null) rpcParams.p_fornecedor_id = fornecedorId;
      if (unidadeBaseId != null) rpcParams.p_unidade_base_id = unidadeBaseId;
      if (tid) rpcParams.p_tenant_id = tid;
      const { data, error } = await supabase.rpc('fn_cohort_saldo_forecast' as any, rpcParams);
      if (error) throw error;
      return (data ?? []) as CohortSaldoRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const rows = (data ?? []).map(r => ({
      horizonte_meses: Number(r.horizonte_meses),
      base_clientes: Number(r.base_clientes),
      base_mrr: Number(r.base_mrr),
      perda_clientes: Number(r.perda_clientes),
      ganho_clientes: Number(r.ganho_clientes),
      saldo_clientes: Number(r.saldo_clientes),
      perda_mrr: Number(r.perda_mrr),
      ganho_mrr: Number(r.ganho_mrr),
      saldo_mrr: Number(r.saldo_mrr),
    })).sort((a, b) => a.horizonte_meses - b.horizonte_meses);
    return { isLoading, rows };
  }, [data, isLoading]);
}
