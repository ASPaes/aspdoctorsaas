import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters } from '../types';

const LTV_CAP = 120;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface MonthlyUnitEconomics {
  month: string;       // "MMM"
  monthFull: string;   // "MMM yyyy"
  yearMonth: string;   // "yyyy-MM"
  // Raw
  base_inicio: number;
  cancelados: number;
  ativos_fim: number;
  mrr_snapshot: number;
  mc_total: number;
  mc_percent: number | null;
  ticket_medio: number | null;
  // Churn
  churn_M: number | null;
  // LTV meses
  ltv_M: number | null;
  ltv_3M: number | null;
  ltv_6M: number | null;
  // LTV R$
  ltv_rs_M: number | null;
  ltv_rs_3M: number | null;
  ltv_rs_6M: number | null;
  // CAC
  cac_M: number;
  cac_3M: number;
  cac_6M: number;
  // LTV/CAC
  ltv_cac_M: number | null;
  ltv_cac_3M: number | null;
  ltv_cac_6M: number | null;
}

export interface UnitEconomicsResult {
  series: MonthlyUnitEconomics[];
  current: MonthlyUnitEconomics | null;
}

export function useUnitEconomicsSeries(filters: DashboardFilters, rangeMonths = 12) {
  return useQuery<UnitEconomicsResult>({
    queryKey: ['unit-economics-series', filters.unidadeBaseId, filters.fornecedorId, rangeMonths],
    queryFn: async () => {
      const now = new Date();

      // Build month references (oldest first)
      // We need extra months before the range for 6M rolling windows
      const totalMonthsNeeded = rangeMonths + 5; // 5 extra for 6M window warmup
      const allMonthRefs = Array.from({ length: totalMonthsNeeded }).map((_, i) => {
        const d = subMonths(now, totalMonthsNeeded - 1 - i);
        return {
          month: format(d, 'MMM', { locale: ptBR }),
          monthFull: format(d, 'MMM yyyy', { locale: ptBR }),
          yearMonth: format(d, 'yyyy-MM'),
          startDate: startOfMonth(d),
          endDate: endOfMonth(d),
          start: format(startOfMonth(d), 'yyyy-MM-dd'),
          end: format(endOfMonth(d), 'yyyy-MM-dd'),
        };
      });

      // === QUERY A: All clients (for monthly aggregation) ===
      const { data: allClientes } = await supabase
        .from('clientes')
        .select('id, mensalidade, data_venda, data_cancelamento, cancelado, custo_operacao, imposto_percentual, custo_fixo_percentual, unidade_base_id, fornecedor_id');

      // === QUERY B: CAC despesas ===
      const { data: cacDespesas } = await supabase
        .from('cac_despesas')
        .select('valor_alocado, mes_inicial, mes_final, unidade_base_id');

      const clients = (allClientes || []).filter(c => {
        if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
        if (filters.fornecedorId && c.fornecedor_id !== filters.fornecedorId) return false;
        return true;
      });

      const despesas = (cacDespesas || []).filter(d => {
        if (filters.unidadeBaseId) {
          return !d.unidade_base_id || d.unidade_base_id === filters.unidadeBaseId;
        }
        return true;
      });

      // Compute raw per-month data for all months (including warmup)
      const rawMonths: {
        base_inicio: number;
        cancelados: number;
        ativos_fim: number;
        mrr_snapshot: number;
        mc_total: number;
        cac_M: number;
        yearMonth: string;
      }[] = [];

      allMonthRefs.forEach(m => {
        const startDate = m.startDate;
        const endDate = m.endDate;
        const startStr = m.start;
        const endStr = m.end;

        // base_inicio: active on 1st day of month
        // active if: data_venda <= startDate AND (data_cancelamento IS NULL OR data_cancelamento > startDate)
        const baseInicio = clients.filter(c => {
          if (!c.data_venda) return false;
          if (new Date(c.data_venda) > startDate) return false;
          if (c.data_cancelamento && new Date(c.data_cancelamento) <= startDate) return false;
          return true;
        });

        // cancelados: data_cancelamento within month
        const cancelados = clients.filter(c => {
          if (!c.data_cancelamento) return false;
          const dc = new Date(c.data_cancelamento);
          return dc >= startDate && dc <= endDate;
        });

        // ativos_fim: active at end of month
        const ativosFim = clients.filter(c => {
          if (!c.data_venda) return false;
          if (new Date(c.data_venda) > endDate) return false;
          if (c.data_cancelamento && new Date(c.data_cancelamento) <= endDate) return false;
          return true;
        });

        const mrrSnapshot = ativosFim.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0);

        // MC total for active clients at end of month
        let mcTotal = 0;
        ativosFim.forEach(c => {
          const mens = Number(c.mensalidade) || 0;
          const cogs = Number(c.custo_operacao) || 0;
          const imp = mens * (Number(c.imposto_percentual) || 0);
          const fix = mens * (Number(c.custo_fixo_percentual) || 0);
          mcTotal += mens - cogs - imp - fix;
        });

        // CAC for this month (by vigência)
        const monthRef = m.start; // yyyy-MM-dd (1st day)
        let cacM = 0;
        despesas.forEach(d => {
          const mesInicial = d.mes_inicial;
          const mesFinal = d.mes_final;
          if (mesInicial && mesInicial <= endStr) {
            if (!mesFinal || mesFinal >= startStr) {
              cacM += Number(d.valor_alocado) || 0;
            }
          }
        });

        rawMonths.push({
          base_inicio: baseInicio.length,
          cancelados: cancelados.length,
          ativos_fim: ativosFim.length,
          mrr_snapshot: mrrSnapshot,
          mc_total: mcTotal,
          cac_M: cacM,
          yearMonth: m.yearMonth,
        });
      });

      // Now compute derived metrics for the display range (last `rangeMonths`)
      const warmup = totalMonthsNeeded - rangeMonths; // 5
      const series: MonthlyUnitEconomics[] = [];

      for (let i = warmup; i < totalMonthsNeeded; i++) {
        const ref = allMonthRefs[i];
        const raw = rawMonths[i];

        // Churn M
        const churnM = raw.base_inicio > 0 ? raw.cancelados / raw.base_inicio : null;

        // LTV M
        let ltvM: number | null = null;
        if (churnM === null) ltvM = null;
        else if (churnM === 0) ltvM = LTV_CAP;
        else ltvM = round2(1 / churnM);

        // Window aggregation helper
        const windowCalc = (windowSize: number) => {
          const start = i - windowSize + 1;
          if (start < 0) return { ltv: null as number | null, ltvRs: null as number | null, cac: 0, ltvCac: null as number | null };

          let totalCancelados = 0;
          let totalBaseInicio = 0;
          let totalMrr = 0;
          let totalClientes = 0;
          let totalMc = 0;
          let totalCac = 0;

          for (let j = start; j <= i; j++) {
            const r = rawMonths[j];
            totalCancelados += r.cancelados;
            totalBaseInicio += r.base_inicio;
            totalMrr += r.mrr_snapshot;
            totalClientes += r.ativos_fim;
            totalMc += r.mc_total;
            totalCac += r.cac_M;
          }

          const churnW = totalBaseInicio > 0 ? totalCancelados / totalBaseInicio : null;
          let ltvW: number | null = null;
          if (churnW === null) ltvW = null;
          else if (churnW === 0) ltvW = LTV_CAP;
          else ltvW = round2(1 / churnW);

          const ticketW = totalClientes > 0 ? totalMrr / totalClientes : null;
          const mcPctW = totalMrr > 0 ? totalMc / totalMrr : null;

          let ltvRsW: number | null = null;
          if (ltvW !== null && ticketW !== null && mcPctW !== null) {
            ltvRsW = round2(ticketW * ltvW * mcPctW);
          }

          let ltvCacW: number | null = null;
          if (ltvRsW !== null && totalCac > 0) {
            ltvCacW = round2(ltvRsW / totalCac);
          }

          return { ltv: ltvW, ltvRs: ltvRsW, cac: totalCac, ltvCac: ltvCacW };
        };

        // 1M
        const w1 = windowCalc(1);
        // 3M
        const w3 = windowCalc(3);
        // 6M
        const w6 = windowCalc(6);

        // Ticket and MC for current month (for card display)
        const ticketMedio = raw.ativos_fim > 0 ? raw.mrr_snapshot / raw.ativos_fim : null;
        const mcPercent = raw.mrr_snapshot > 0 ? raw.mc_total / raw.mrr_snapshot : null;

        // LTV R$ for 1M
        let ltvRsM: number | null = null;
        if (ltvM !== null && ticketMedio !== null && mcPercent !== null) {
          ltvRsM = round2(ticketMedio * ltvM * mcPercent);
        }

        // LTV/CAC for 1M
        let ltvCacM: number | null = null;
        if (ltvRsM !== null && raw.cac_M > 0) {
          ltvCacM = round2(ltvRsM / raw.cac_M);
        }

        series.push({
          month: ref.month,
          monthFull: ref.monthFull,
          yearMonth: ref.yearMonth,
          base_inicio: raw.base_inicio,
          cancelados: raw.cancelados,
          ativos_fim: raw.ativos_fim,
          mrr_snapshot: round2(raw.mrr_snapshot),
          mc_total: round2(raw.mc_total),
          mc_percent: mcPercent !== null ? round2(mcPercent) : null,
          ticket_medio: ticketMedio !== null ? round2(ticketMedio) : null,
          churn_M: churnM !== null ? round2(churnM) : null,
          ltv_M: ltvM,
          ltv_3M: w3.ltv,
          ltv_6M: w6.ltv,
          ltv_rs_M: ltvRsM,
          ltv_rs_3M: w3.ltvRs,
          ltv_rs_6M: w6.ltvRs,
          cac_M: round2(raw.cac_M),
          cac_3M: round2(w3.cac),
          cac_6M: round2(w6.cac),
          ltv_cac_M: ltvCacM,
          ltv_cac_3M: w3.ltvCac,
          ltv_cac_6M: w6.ltvCac,
        });
      }

      const current = series.length > 0 ? series[series.length - 1] : null;

      return { series, current };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
