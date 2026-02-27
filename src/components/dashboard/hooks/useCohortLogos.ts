import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subMonths } from 'date-fns';

export interface CohortLogosParams {
  fromCohortMonth?: string;
  toCohortMonth?: string;
  maxAgeMonths?: number;
  fornecedorId?: number | null;
  unidadeBaseId?: number | null;
}

export interface CohortEntry {
  month: string;
  size: number;
}

export interface CohortCurvePoint {
  age: string;
  ageNum: number;
  [key: string]: string | number;
}

export interface UseCohortLogosResult {
  isLoading: boolean;
  cohorts: CohortEntry[];
  ageColumns: number[];
  matrix: Map<string, Map<number, number>>;
  retainedMatrix: Map<string, Map<number, number>>;
  curveData: CohortCurvePoint[];
  curveLabels: string[];
  curveIsFallback: boolean;
}

function normalizeMonth(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function useCohortLogos(params: CohortLogosParams = {}): UseCohortLogosResult {
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
    queryKey: ['cohort-logos', from, to, maxAge, fornecedorId, unidadeBaseId],
    queryFn: async () => {
      const rpcParams: Record<string, any> = {
        p_from_month: from,
        p_to_month: to,
        p_max_age: maxAge,
      };
      if (fornecedorId != null) rpcParams.p_fornecedor_id = fornecedorId;
      if (unidadeBaseId != null) rpcParams.p_unidade_base_id = unidadeBaseId;

      const { data, error } = await supabase.rpc('fn_cohort_logos', rpcParams);
      if (error) throw error;
      return (data ?? []) as { cohort_month: string; age_months: number; cohort_size: number; retained: number; retention_percent: number }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const empty: UseCohortLogosResult = {
      isLoading,
      cohorts: [],
      ageColumns: [],
      matrix: new Map(),
      retainedMatrix: new Map(),
      curveData: [],
      curveLabels: [],
      curveIsFallback: false,
    };
    if (!rawData || rawData.length === 0) return empty;

    const cohortsMap = new Map<string, number>();
    const agesSet = new Set<number>();
    const matrix = new Map<string, Map<number, number>>();
    const retainedMatrix = new Map<string, Map<number, number>>();
    const cohortMaxAge = new Map<string, number>();

    for (const row of rawData) {
      const cm = String(row.cohort_month ?? '').slice(0, 7);
      const age = Number(row.age_months);
      const size = Number(row.cohort_size);
      const pct = Number(row.retention_percent);
      const ret = Number(row.retained ?? 0);

      if (!cohortsMap.has(cm)) cohortsMap.set(cm, size);
      agesSet.add(age);
      if (!matrix.has(cm)) matrix.set(cm, new Map());
      matrix.get(cm)!.set(age, pct);
      if (!retainedMatrix.has(cm)) retainedMatrix.set(cm, new Map());
      retainedMatrix.get(cm)!.set(age, ret);
      cohortMaxAge.set(cm, Math.max(cohortMaxAge.get(cm) ?? 0, age));
    }

    const cohorts: CohortEntry[] = Array.from(cohortsMap.entries())
      .map(([month, size]) => ({ month, size }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const ageColumns = Array.from(agesSet).sort((a, b) => a - b);

    const MIN_SIZE = 10;
    let matureCohorts = cohorts.filter(
      c => (cohortMaxAge.get(c.month) ?? 0) >= 3 && c.size >= MIN_SIZE
    ).slice(0, 3);
    let curveIsFallback = false;

    if (matureCohorts.length < 3) {
      matureCohorts = cohorts.filter(
        c => (cohortMaxAge.get(c.month) ?? 0) >= 1
      ).slice(0, 3);
      curveIsFallback = true;
    }

    const last3 = [...matureCohorts].reverse();
    const curveLabels = last3.map(c => c.month);

    let maxAgeWithData = 0;
    last3.forEach(c => {
      const cohortAges = matrix.get(c.month);
      if (cohortAges) {
        cohortAges.forEach((_, age) => { if (age > maxAgeWithData) maxAgeWithData = age; });
      }
    });

    const curveAges = ageColumns.filter(a => a <= maxAgeWithData);

    const curveData: CohortCurvePoint[] = curveAges.map(age => {
      const point: CohortCurvePoint = { age: `M${age}`, ageNum: age };
      last3.forEach((c, i) => {
        const val = matrix.get(c.month)?.get(age);
        point[`cohort_${i}`] = val !== undefined ? val : null as any;
      });
      return point;
    });

    return { isLoading, cohorts, ageColumns, matrix, retainedMatrix, curveData, curveLabels, curveIsFallback };
  }, [rawData, isLoading]);
}
