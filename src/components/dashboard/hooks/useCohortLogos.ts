import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subMonths } from 'date-fns';

export interface CohortLogosParams {
  /** Earliest cohort month (YYYY-MM or YYYY-MM-DD). Defaults to 12 months ago. */
  fromCohortMonth?: string;
  /** Latest cohort month (YYYY-MM or YYYY-MM-DD). Defaults to current month. */
  toCohortMonth?: string;
  /** Max age_months column to fetch. Capped at 12. Default 12. */
  maxAgeMonths?: number;
}

export interface CohortEntry {
  month: string;   // YYYY-MM
  size: number;
}

export interface CohortCurvePoint {
  age: string;       // "M0", "M1", …
  ageNum: number;
  [key: string]: string | number; // cohort_0, cohort_1, cohort_2
}

export interface UseCohortLogosResult {
  isLoading: boolean;
  /** Available cohorts ordered desc by month */
  cohorts: CohortEntry[];
  /** Sorted age columns present in data */
  ageColumns: number[];
  /** Map<cohort YYYY-MM, Map<age_months, retention_percent>> */
  matrix: Map<string, Map<number, number>>;
  /** Map<cohort YYYY-MM, Map<age_months, retained_count>> */
  retainedMatrix: Map<string, Map<number, number>>;
  /** Curve data for the last 3 mature cohorts (for LineChart) */
  curveData: CohortCurvePoint[];
  /** Labels for the last 3 mature cohorts (e.g. "jan/25") */
  curveLabels: string[];
  /** True when no cohorts with age>=3 were found, using fallback age>=1 */
  curveIsFallback: boolean;
}

function normalizeMonth(input: string): string {
  // Accept YYYY-MM or YYYY-MM-DD → return YYYY-MM-01 for query
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function useCohortLogos(params: CohortLogosParams = {}): UseCohortLogosResult {
  const maxAge = Math.min(params.maxAgeMonths ?? 12, 12);
  const from = params.fromCohortMonth
    ? normalizeMonth(params.fromCohortMonth)
    : format(subMonths(new Date(), 12), 'yyyy-MM-dd');
  const to = params.toCohortMonth
    ? normalizeMonth(params.toCohortMonth)
    : format(new Date(), 'yyyy-MM-dd');

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['cohort-logos', from, to, maxAge],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vw_cohort_logos')
        .select('cohort_month, age_months, cohort_size, retained, retention_percent')
        .gte('cohort_month', from)
        .lte('cohort_month', to)
        .lte('age_months', maxAge)
        .order('cohort_month', { ascending: false })
        .order('age_months', { ascending: true });
      if (error) throw error;
      return data ?? [];
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

    // Build cohorts list and matrix
    const cohortsMap = new Map<string, number>();
    const agesSet = new Set<number>();
    const matrix = new Map<string, Map<number, number>>();
    const retainedMatrix = new Map<string, Map<number, number>>();
    const cohortMaxAge = new Map<string, number>();

    for (const row of rawData) {
      const cm = String(row.cohort_month ?? '').slice(0, 7); // YYYY-MM
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

    // Cohorts ordered descending
    const cohorts: CohortEntry[] = Array.from(cohortsMap.entries())
      .map(([month, size]) => ({ month, size }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const ageColumns = Array.from(agesSet).sort((a, b) => a - b);

    // Select last 3 "mature" cohorts for the curve chart
    // Primary: max_age >= 3 AND size >= 10, ordered desc by month
    // Fallback: max_age >= 1, any size
    const MIN_SIZE = 10;
    let matureCohorts = cohorts.filter(
      c => (cohortMaxAge.get(c.month) ?? 0) >= 3 && c.size >= MIN_SIZE
    ).slice(0, 3);
    let curveIsFallback = false;

    if (matureCohorts.length < 3) {
      // Fallback: at least age >= 1
      matureCohorts = cohorts.filter(
        c => (cohortMaxAge.get(c.month) ?? 0) >= 1
      ).slice(0, 3);
      curveIsFallback = true;
    }

    // Ascending for chart legend order
    const last3 = [...matureCohorts].reverse();
    const curveLabels = last3.map(c => c.month);

    // Find the max age that has actual data among the selected cohorts
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
