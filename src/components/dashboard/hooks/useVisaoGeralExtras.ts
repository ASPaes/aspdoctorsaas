import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type { DashboardFilters } from '../types';

export interface ComparativoMRR {
  /** Label do período de comparação, ex: "Q1 26" ou "S2 25" ou "maio 25" */
  periodoLabel: string;
  /** MRR atual (mais recente) */
  current: number;
  /** MRR no período de comparação */
  previous: number;
  /** Série de pontos mensais para o sparkline (do mais antigo ao atual) */
  sparklinePoints: number[];
}

export interface VisaoGeralExtras {
  /** Tenure médio em meses (clientes ativos) */
  tenureMedio: number;
  /** Comparativo MRR atual vs fim do trimestre anterior */
  mrrTrimestre: ComparativoMRR;
  /** Comparativo MRR atual vs último dia do semestre anterior */
  mrrSemestre: ComparativoMRR;
  /** Comparativo MRR atual vs 12 meses atrás */
  mrrAno: ComparativoMRR;
  /** Série completa: 13 pontos mensais de MRR (último dia de cada mês nos últimos 12 meses + atual) */
  mrrSeries: { dataCorte: string; mrr: number }[];
}

const defaultExtras: VisaoGeralExtras = {
  tenureMedio: 0,
  mrrTrimestre: { periodoLabel: '', current: 0, previous: 0, sparklinePoints: [] },
  mrrSemestre: { periodoLabel: '', current: 0, previous: 0, sparklinePoints: [] },
  mrrAno: { periodoLabel: '', current: 0, previous: 0, sparklinePoints: [] },
  mrrSeries: [],
};

const MES_PT_ABBREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function quarterLabel(date: Date): string {
  const m = date.getMonth();
  const q = Math.floor(m / 3) + 1;
  const yy = String(date.getFullYear()).slice(-2);
  return `Q${q} ${yy}`;
}

function semesterLabel(date: Date): string {
  const m = date.getMonth();
  const s = m < 6 ? 1 : 2;
  const yy = String(date.getFullYear()).slice(-2);
  return `S${s} ${yy}`;
}

function monthYearLabel(date: Date): string {
  return `${MES_PT_ABBREV[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`;
}

/**
 * Hook isolado da Visão Geral V2.
 * Calcula Tenure Médio + comparativos temporais de MRR (Q/S/Ano) com sparklines.
 * NÃO substitui useDashboardData — é complementar.
 */
export function useVisaoGeralExtras(filters?: DashboardFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const unidadeBaseId = filters?.unidadeBaseId ?? null;
  const fornecedorId = filters?.fornecedorId ?? null;
  const fornecedorIds = filters?.fornecedorIds ?? [];
  const dataReferencia = filters?.periodoFim
    ? new Date(filters.periodoFim).toISOString().slice(0, 10)
    : null;

  return useQuery({
    queryKey: ['visao-geral-extras', tid, unidadeBaseId, JSON.stringify(fornecedorIds), dataReferencia],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VisaoGeralExtras> => {
      if (!tid) return defaultExtras;

      // ── Query 1: 13 pontos mensais de MRR (últimos 12 meses + atual) ──
      const { data: seriesData, error: seriesError } = await supabase.rpc('get_mrr_monthly_snapshots', {
        p_tenant_id: tid,
        p_months_back: 12,
        p_unidade_base_id: unidadeBaseId,
        p_fornecedor_id: null,
        p_fornecedor_ids: fornecedorIds.length ? fornecedorIds : null,
        p_data_referencia: dataReferencia,
      } as any);

      if (seriesError) {
        console.error('[useVisaoGeralExtras] series error:', seriesError);
      }

      const mrrSeries: { dataCorte: string; mrr: number }[] = (seriesData as any[] | null ?? []).map((row: any) => ({
        dataCorte: row.data_corte,
        mrr: Number(row.mrr) || 0,
      }));

      // ── Query 2: Tenure médio ──
      const { data: tenureData, error: tenureError } = await supabase.rpc('get_tenure_medio_meses', {
        p_tenant_id: tid,
        p_unidade_base_id: unidadeBaseId,
        p_fornecedor_id: null,
        p_fornecedor_ids: fornecedorIds.length ? fornecedorIds : null,
      } as any);

      if (tenureError) {
        console.error('[useVisaoGeralExtras] tenure error:', tenureError);
      }

      const tenureMedio = Number(tenureData) || 0;

      // ── Cálculo dos comparativos a partir da série ──
      if (mrrSeries.length === 0) {
        return { ...defaultExtras, tenureMedio };
      }

      const last = mrrSeries[mrrSeries.length - 1];
      const currentMrr = last.mrr;

      // Identificar pontos-chave na série
      // Série tem ~13 pontos: índice 0 = 12 meses atrás, índice 12 = atual
      const idxAno = 0;
      const idxSemestre = Math.max(0, mrrSeries.length - 7); // 6 meses atrás
      const idxTrimestre = Math.max(0, mrrSeries.length - 4); // 3 meses atrás

      const dateFromIso = (iso: string) => new Date(iso + 'T12:00:00');

      const mrrTrimestre: ComparativoMRR = {
        periodoLabel: quarterLabel(dateFromIso(mrrSeries[idxTrimestre].dataCorte)),
        current: currentMrr,
        previous: mrrSeries[idxTrimestre].mrr,
        sparklinePoints: mrrSeries.slice(idxTrimestre).map((p) => p.mrr),
      };

      const mrrSemestre: ComparativoMRR = {
        periodoLabel: semesterLabel(dateFromIso(mrrSeries[idxSemestre].dataCorte)),
        current: currentMrr,
        previous: mrrSeries[idxSemestre].mrr,
        sparklinePoints: mrrSeries.slice(idxSemestre).map((p) => p.mrr),
      };

      const mrrAno: ComparativoMRR = {
        periodoLabel: monthYearLabel(dateFromIso(mrrSeries[idxAno].dataCorte)),
        current: currentMrr,
        previous: mrrSeries[idxAno].mrr,
        sparklinePoints: mrrSeries.map((p) => p.mrr),
      };

      return {
        tenureMedio,
        mrrTrimestre,
        mrrSemestre,
        mrrAno,
        mrrSeries,
      };
    },
  });
}
