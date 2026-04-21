import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { DashboardFilters } from '../types';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { fetchAllRows } from '@/lib/supabasePaginate';

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
  const { effectiveTenantId: tid } = useTenantFilter();
  const periodoFimStr = filters.periodoFim ? format(filters.periodoFim, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['margem-contribuicao-dashboard', filters.unidadeBaseId, filters.fornecedorId, periodoFimStr, tid],
    queryFn: async (): Promise<MargemContribuicaoData> => {
      const raw = await fetchAllRows<any>(() => {
        let q = supabase
          .from('vw_clientes_financeiro')
          .select('mensalidade, custo_operacao, data_cadastro, data_cancelamento, cancelado')
          .lte('data_cadastro', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
        if (filters.fornecedorId) q = q.eq('fornecedor_id', filters.fornecedorId);
        return q;
      });
      if (!raw || raw.length === 0) return defaultData;

      // Filtra clientes ativos no fim do período.
      // Regra canônica: ativo = cancelado !== true OU (cancelado=true E data_cancelamento > periodoFim).
      const data = raw.filter(c => {
        if (c.cancelado !== true) return true;
        if (!c.data_cancelamento) return false;
        return new Date(c.data_cancelamento) > new Date(periodoFimStr);
      });

      let receita_mrr = 0;
      let cogs_total = 0;

      data.forEach(c => {
        const m = Number(c.mensalidade) || 0;
        const cogs = Number(c.custo_operacao) || 0;

        receita_mrr += m;
        cogs_total += cogs;
      });

      const clientes_ativos = data.length;
      const mc_total = receita_mrr - cogs_total;
      const mc_percent_ponderada = receita_mrr > 0 ? mc_total / receita_mrr : 0;
      const mc_media_por_cliente = clientes_ativos > 0 ? mc_total / clientes_ativos : 0;

      // Debug: validate calculations
      if (import.meta.env.DEV) {
        console.group('[MC Debug] Margem de Contribuição');
        console.table({
          'Receita (MRR)': round2(receita_mrr),
          'COGS': round2(cogs_total),
          'MC Total (R$)': round2(mc_total),
          'MC% Ponderada': `${round2(mc_percent_ponderada * 100)}%`,
          'Clientes Ativos': clientes_ativos,
          'MC Média/Cliente (R$)': round2(mc_media_por_cliente),
        });
        console.groupEnd();
      }

      // Clamp mc_percent to avoid absurd values
      const clampedPercent = Math.max(-1, Math.min(1, mc_percent_ponderada));

      return {
        receita_mrr: round2(receita_mrr),
        clientes_ativos,
        cogs_total: round2(cogs_total),
        impostos_total: 0,
        fixos_total: 0,
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
