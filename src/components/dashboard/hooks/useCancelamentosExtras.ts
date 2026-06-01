import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type { DashboardFilters, KPIMetrics } from '../types';

// ─── Subtipos de arrays retornados pela RPC ──────────────────

export interface TopMotivo {
  motivo: string;
  categoria: 'voluntary' | 'involuntary' | 'mortality' | 'sem_classif';
  qtd: number;
  mrr_perdido: number;
  tenure_medio_dias: number;
  qtd_early: number;
}

export interface TendenciaMotivo {
  motivo: string;
  qtd_anterior_6m: number;
  qtd_recente_6m: number;
  delta: number;
}

export interface ChurnSegmento {
  segmento: string;
  ativos: number;
  cancelados: number;
  churn_rate: number;
  tenure_canc: number;
  tenure_ativos: number;
}

export interface HeatmapCell {
  motivo: string;
  segmento: string;
  qtd: number;
  mrr: number;
}

export interface Top10Cancelado {
  cliente_id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  segmento: string;
  motivo: string;
  categoria_churn: 'voluntary' | 'involuntary' | 'mortality' | 'sem_classif';
  mrr_perdido: number;
  tenure_dias: number;
  data_cancelamento: string;
}

export interface CancelamentoOrigem {
  origem: string;
  qtd_cancelamentos: number;
  mrr_cancelado: number;
  qtd_ativos_inicio: number;
  churn_rate: number;
  ticket_medio_cancelado: number;
}

export interface EvolucaoMes {
  mes: string;
  qtd: number;
  mrr: number;
}

export interface ReativacaoMes {
  mes: string;
  qtd: number;
  mrr: number;
  tempo_medio_fora_dias: number | null;
}

export interface CancelamentosExtras {
  cancelamentosQtd: number;
  mrrCancelado: number;
  clientesInicio: number;
  mrrInicio: number;
  churnRateLogo: number;
  churnRateMrr: number;
  netLogoChurn: number;
  mrrLiquidoPerdido: number;
  tenureMedioCancDias: number;
  reativacoesQtd: number;
  mrrReativado: number;
  winbackRate12m: number;

  cacPerdido: number | null;

  earlyChurnQtd: number;
  earlyChurnMrr: number;
  earlyChurnRate: number;

  categorias: {
    voluntary: { mrr: number; qtd: number };
    involuntary: { mrr: number; qtd: number };
    mortality: { mrr: number; qtd: number };
    semClassif: { mrr: number; qtd: number };
  };

  buckets: {
    ate90d: { qtd: number; mrr: number };
    d91_180: { qtd: number; mrr: number };
    d181_365: { qtd: number; mrr: number };
    mais1y: { qtd: number; mrr: number };
  };

  topMotivos: TopMotivo[];
  tendenciaMotivos: TendenciaMotivo[];
  churnPorSegmento: ChurnSegmento[];
  heatmapMotivoSegmento: HeatmapCell[];
  top10Cancelados: Top10Cancelado[];
  evolucao12m: EvolucaoMes[];
  reativacoes12m: ReativacaoMes[];
}

/**
 * Hook complementar para a aba Cancelamentos V2.
 * Consome a RPC `get_cancelamentos_breakdown` (1 chamada, todos os dados).
 * Calcula client-side apenas `cacPerdido` = metrics.cac × cancelamentosQtd.
 */
export function useCancelamentosExtras(params: {
  filters: DashboardFilters;
  metrics: KPIMetrics;
}) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { filters, metrics } = params;

  const unidadeBaseId = filters.unidadeBaseId ?? null;
  const fornecedorId = filters.fornecedorId ?? null;
  const periodoInicio = filters.periodoInicio
    ? new Date(filters.periodoInicio).toISOString().slice(0, 10)
    : null;
  const periodoFim = filters.periodoFim
    ? new Date(filters.periodoFim).toISOString().slice(0, 10)
    : null;

  return useQuery({
    queryKey: ['cancelamentos-extras', tid, periodoInicio, periodoFim, unidadeBaseId, fornecedorId],
    enabled: !!tid && !!periodoInicio && !!periodoFim,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CancelamentosExtras> => {
      const { data, error } = await (supabase.rpc as any)('get_cancelamentos_breakdown', {
        p_tenant_id: tid,
        p_periodo_inicio: periodoInicio,
        p_periodo_fim: periodoFim,
        p_unidade_base_id: unidadeBaseId,
        p_fornecedor_id: fornecedorId,
      });

      if (error) {
        console.error('[useCancelamentosExtras] RPC error:', error);
        throw error;
      }

      const row = (data?.[0] ?? {}) as any;

      const cacValor = Number(metrics.cac) || 0;
      const cancelQtd = Number(row.cancelamentos_qtd) || 0;
      const cacPerdido = cacValor > 0 ? cacValor * cancelQtd : null;

      return {
        cancelamentosQtd: Number(row.cancelamentos_qtd) || 0,
        mrrCancelado: Number(row.mrr_cancelado) || 0,
        clientesInicio: Number(row.clientes_inicio) || 0,
        mrrInicio: Number(row.mrr_inicio) || 0,
        churnRateLogo: Number(row.churn_rate_logo) || 0,
        churnRateMrr: Number(row.churn_rate_mrr) || 0,
        netLogoChurn: Number(row.net_logo_churn) || 0,
        mrrLiquidoPerdido: Number(row.mrr_liquido_perdido) || 0,
        tenureMedioCancDias: Number(row.tenure_medio_canc_dias) || 0,
        reativacoesQtd: Number(row.reativacoes_qtd) || 0,
        mrrReativado: Number(row.mrr_reativado) || 0,
        winbackRate12m: Number(row.winback_rate_12m) || 0,

        cacPerdido,

        earlyChurnQtd: Number(row.early_churn_qtd) || 0,
        earlyChurnMrr: Number(row.early_churn_mrr) || 0,
        earlyChurnRate: Number(row.early_churn_rate) || 0,

        categorias: {
          voluntary: {
            mrr: Number(row.cat_voluntary_mrr) || 0,
            qtd: Number(row.cat_voluntary_qtd) || 0,
          },
          involuntary: {
            mrr: Number(row.cat_involuntary_mrr) || 0,
            qtd: Number(row.cat_involuntary_qtd) || 0,
          },
          mortality: {
            mrr: Number(row.cat_mortality_mrr) || 0,
            qtd: Number(row.cat_mortality_qtd) || 0,
          },
          semClassif: {
            mrr: Number(row.cat_sem_classif_mrr) || 0,
            qtd: Number(row.cat_sem_classif_qtd) || 0,
          },
        },

        buckets: {
          ate90d: {
            qtd: Number(row.bucket_ate_90d_qtd) || 0,
            mrr: Number(row.bucket_ate_90d_mrr) || 0,
          },
          d91_180: {
            qtd: Number(row.bucket_91_180d_qtd) || 0,
            mrr: Number(row.bucket_91_180d_mrr) || 0,
          },
          d181_365: {
            qtd: Number(row.bucket_181_365d_qtd) || 0,
            mrr: Number(row.bucket_181_365d_mrr) || 0,
          },
          mais1y: {
            qtd: Number(row.bucket_mais_1y_qtd) || 0,
            mrr: Number(row.bucket_mais_1y_mrr) || 0,
          },
        },

        topMotivos: (row.top_motivos ?? []) as TopMotivo[],
        tendenciaMotivos: (row.tendencia_motivos ?? []) as TendenciaMotivo[],
        churnPorSegmento: (row.churn_por_segmento ?? []) as ChurnSegmento[],
        heatmapMotivoSegmento: (row.heatmap_motivo_segmento ?? []) as HeatmapCell[],
        top10Cancelados: (row.top10_cancelados ?? []) as Top10Cancelado[],
        evolucao12m: (row.evolucao_12m ?? []) as EvolucaoMes[],
        reativacoes12m: (row.reativacoes_12m ?? []) as ReativacaoMes[],
      };
    },
  });
}
