import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { DashboardFilters } from '../types';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { fetchAllRows } from '@/lib/supabasePaginate';
import { buildMrrRuler, MRR_MOV_TIPOS } from '@/lib/mrrRuler';

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
    queryKey: ['margem-contribuicao-dashboard', filters.unidadeBaseId, JSON.stringify(filters.fornecedorIds), periodoFimStr, tid],
    queryFn: async (): Promise<MargemContribuicaoData> => {
      // A população passa a ser a canônica — `data_venda_efetiva <= fim`, a mesma de
      // `get_mrr_bridge` e do card de MRR. Era `data_cadastro`, que é outra data: cliente
      // cadastrado antes de vender entrava cedo demais na conta da margem.
      const [raw, cpAll, movimentos] = await Promise.all([
        fetchAllRows<any>(() => {
          let q = supabase
            .from('vw_clientes_financeiro')
            .select('id, mensalidade, custo_operacao, data_venda_efetiva, data_cancelamento, cancelado')
            .lte('data_venda_efetiva', periodoFimStr);
          if (tid) q = q.eq('tenant_id', tid);
          if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
          return q;
        }),
        fetchAllRows<any>(() => {
          let q = (supabase.from('cliente_produtos' as any) as any)
            .select('cliente_id, fornecedor_id, vlr_mensal, vlr_custo, ativo, data_cancelamento');
          if (tid) q = q.eq('tenant_id', tid);
          return q;
        }),
        fetchAllRows<any>(() => {
          let q = supabase
            .from('movimentos_mrr')
            .select('cliente_id, valor_delta, data_movimento')
            .in('tipo', [...MRR_MOV_TIPOS])
            .eq('status', 'ativo')
            .is('estornado_por', null)
            .is('estorno_de', null);
          if (tid) q = q.eq('tenant_id', tid);
          return q;
        }),
      ]);
      if (!raw || raw.length === 0) return defaultData;

      const { mrrDe, custoAteData } = buildMrrRuler(cpAll as any, movimentos as any);
      const fornecedorClientIds: Set<string> | null = filters.fornecedorIds?.length
        ? new Set(
            (cpAll || [])
              .filter((cp: any) => (filters.fornecedorIds as number[]).includes(cp.fornecedor_id))
              .map((cp: any) => cp.cliente_id),
          )
        : null;

      // Filtra clientes ativos no fim do período.
      // Regra canônica: ativo = cancelado !== true OU (cancelado=true E data_cancelamento > periodoFim).
      const data = raw.filter(c => {
        if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
        if (c.cancelado !== true) return true;
        if (!c.data_cancelamento) return false;
        return new Date(c.data_cancelamento) > new Date(periodoFimStr);
      });

      let receita_mrr = 0;
      let cogs_total = 0;

      data.forEach(c => {
        receita_mrr += mrrDe(c.id, periodoFimStr);
        cogs_total += custoAteData(c.id, periodoFimStr);
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
