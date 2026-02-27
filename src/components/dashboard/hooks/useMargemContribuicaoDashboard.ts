import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DashboardFilters } from '../types';

export interface MargemContribuicaoData {
  receita_mrr: number;
  clientes_ativos: number;
  cogs_total: number;
  impostos_total: number;
  fixos_total: number;
  mc_total: number;
  mc_percent_ponderada: number;
  mc_media_por_cliente: number;
}

const defaultData: MargemContribuicaoData = {
  receita_mrr: 0,
  clientes_ativos: 0,
  cogs_total: 0,
  impostos_total: 0,
  fixos_total: 0,
  mc_total: 0,
  mc_percent_ponderada: 0,
  mc_media_por_cliente: 0,
};

export function useMargemContribuicaoDashboard(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['margem-contribuicao-dashboard', filters.unidadeBaseId, filters.fornecedorId],
    queryFn: async (): Promise<MargemContribuicaoData> => {
      let query = supabase
        .from('vw_clientes_financeiro')
        .select('mensalidade, custo_operacao, imposto_percentual, custo_fixo_percentual')
        .eq('cancelado', false);

      if (filters.unidadeBaseId) query = query.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) query = query.eq('fornecedor_id', filters.fornecedorId);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return defaultData;

      let receita_mrr = 0;
      let cogs_total = 0;
      let impostos_total = 0;
      let fixos_total = 0;

      data.forEach(c => {
        const m = Number(c.mensalidade) || 0;
        const cogs = Number(c.custo_operacao) || 0;
        const impPct = Number(c.imposto_percentual) || 0;
        const fixPct = Number(c.custo_fixo_percentual) || 0;

        receita_mrr += m;
        cogs_total += cogs;
        impostos_total += m * impPct;
        fixos_total += m * fixPct;
      });

      const clientes_ativos = data.length;
      const mc_total = receita_mrr - cogs_total - impostos_total - fixos_total;
      const mc_percent_ponderada = receita_mrr > 0 ? mc_total / receita_mrr : 0;
      const mc_media_por_cliente = clientes_ativos > 0 ? mc_total / clientes_ativos : 0;

      // Clamp mc_percent to avoid absurd values
      const clampedPercent = Math.max(-1, Math.min(1, mc_percent_ponderada));

      return {
        receita_mrr: round2(receita_mrr),
        clientes_ativos,
        cogs_total: round2(cogs_total),
        impostos_total: round2(impostos_total),
        fixos_total: round2(fixos_total),
        mc_total: round2(mc_total),
        mc_percent_ponderada: isFinite(clampedPercent) ? round2(clampedPercent) : 0,
        mc_media_por_cliente: isFinite(mc_media_por_cliente) ? round2(mc_media_por_cliente) : 0,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
