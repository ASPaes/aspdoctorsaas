import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subMonths } from 'date-fns';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface CohortRevenueDimParams {
  fromCohortMonth?: string;
  toCohortMonth?: string;
  maxAgeMonths?: number;
  fornecedorId?: number | null;
  fornecedorIds?: number[];
  unidadeBaseId?: number | null;
}

export interface CohortDimRow {
  grupo: string;
  base: number;
  mrrTot: number;
  logoM3: number | null;
  logoM6: number | null;
  logoM12: number | null;
  revM3: number | null;
  revM6: number | null;
  revM12: number | null;
}

export interface UseCohortRevenueDimResult {
  isLoading: boolean;
  rows: CohortDimRow[];
}

function normalizeMonth(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function useCohortRevenueDim(
  dimensao: string,
  params: CohortRevenueDimParams = {}
): UseCohortRevenueDimResult {
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

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['cohort-revenue-dim', dimensao, from, to, maxAge, fornecedorId, unidadeBaseId, tid],
    queryFn: async () => {
      const rpcParams: Record<string, any> = {
        p_from_month: from,
        p_to_month: to,
        p_max_age: maxAge,
        p_dimensao: dimensao,
      };
      if (fornecedorId != null) rpcParams.p_fornecedor_id = fornecedorId;
      if (unidadeBaseId != null) rpcParams.p_unidade_base_id = unidadeBaseId;
      if (tid) rpcParams.p_tenant_id = tid;

      const { data, error } = await supabase.rpc('fn_cohort_revenue', rpcParams);
      if (error) throw error;
      return (data ?? []) as {
        grupo: string;
        cohort_month: string;
        age_months: number;
        cohort_size: number;
        retained: number;
        retention_percent: number;
        mrr_inicial: number;
        mrr_retido: number;
        revenue_retention_percent: number;
      }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!rawData || rawData.length === 0) return { isLoading, rows: [] };

    // Aggregate per (grupo, age)
    type AgeAgg = { size: number; retained: number; mrrIni: number; mrrRet: number };
    const byGroup = new Map<string, Map<number, AgeAgg>>();

    for (const row of rawData) {
      const grupo = String(row.grupo ?? '').trim();
      if (!grupo) continue;
      const age = Number(row.age_months);
      if (!byGroup.has(grupo)) byGroup.set(grupo, new Map());
      const ageMap = byGroup.get(grupo)!;
      const cur = ageMap.get(age) ?? { size: 0, retained: 0, mrrIni: 0, mrrRet: 0 };
      cur.size += Number(row.cohort_size ?? 0);
      cur.retained += Number(row.retained ?? 0);
      cur.mrrIni += Number(row.mrr_inicial ?? 0);
      cur.mrrRet += Number(row.mrr_retido ?? 0);
      ageMap.set(age, cur);
    }

    const milestones = [3, 6, 12] as const;

    const rows: CohortDimRow[] = [];
    byGroup.forEach((ageMap, grupo) => {
      const m0 = ageMap.get(0);
      const base = m0?.size ?? 0;
      const mrrTot = m0?.mrrIni ?? 0;
      if (base < 5) return;

      const calc = (m: number) => {
        const a = ageMap.get(m);
        const logo = a && a.size > 0 ? (100 * a.retained) / a.size : null;
        const rev = a && a.mrrIni > 0 ? (100 * a.mrrRet) / a.mrrIni : null;
        return { logo, rev };
      };

      const v3 = calc(milestones[0]);
      const v6 = calc(milestones[1]);
      const v12 = calc(milestones[2]);

      rows.push({
        grupo,
        base,
        mrrTot,
        logoM3: v3.logo,
        logoM6: v6.logo,
        logoM12: v12.logo,
        revM3: v3.rev,
        revM6: v6.rev,
        revM12: v12.rev,
      });
    });

    rows.sort((a, b) => b.mrrTot - a.mrrTot);

    return { isLoading, rows };
  }, [rawData, isLoading]);
}
