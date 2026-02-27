import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters } from '../types';

const LTV_CAP = 120;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface MonthlyUnitEconomics {
  month: string;
  monthFull: string;
  yearMonth: string;
  // Raw
  base_inicio: number;
  cancelados: number;
  ativos_fim: number;
  novos_clientes: number;
  mrr_snapshot: number;
  mc_total: number;
  mc_percent: number | null;
  arpa: number | null;
  // Ativação (separada)
  ativacao_media: number | null;
  ativacao_total: number;
  // Churn
  churn_M: number | null;
  // LTV meses
  ltv_M: number | null;
  ltv_3M: number | null;
  ltv_6M: number | null;
  // LTV R$ (recorrente com margem)
  ltv_rec_margem_M: number | null;
  ltv_rec_margem_3M: number | null;
  ltv_rec_margem_6M: number | null;
  // CAC
  cac_burn_M: number;
  cac_por_logo_M: number | null;
  // LTV/CAC recorrente (usa CAC por logo)
  ltv_cac_rec_M: number | null;
  ltv_cac_rec_3M: number | null;
  ltv_cac_rec_6M: number | null;
  // CAC Payback
  cac_payback_M: number | null;
}

export interface UnitEconomicsResult {
  series: MonthlyUnitEconomics[];
  current: MonthlyUnitEconomics | null;
}

export function useUnitEconomicsSeries(filters: DashboardFilters, rangeMonths = 12) {
  // Use the period end date as reference point (instead of always "now")
  const refDate = filters.periodoFim || new Date();
  const refDateStr = format(refDate, 'yyyy-MM-dd');

  return useQuery<UnitEconomicsResult>({
    queryKey: ['unit-economics-saas', filters.unidadeBaseId, filters.fornecedorId, rangeMonths, refDateStr],
    queryFn: async () => {
      const now = refDate;
      const totalMonthsNeeded = rangeMonths + 5; // warmup for 6M window

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

      // === QUERY A: All clients ===
      const { data: allClientes } = await supabase
        .from('clientes')
        .select('id, mensalidade, data_venda, data_cancelamento, cancelado, custo_operacao, imposto_percentual, custo_fixo_percentual, unidade_base_id, fornecedor_id, valor_ativacao');

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

      // Raw per-month
      interface RawMonth {
        base_inicio: number;
        cancelados: number;
        ativos_fim: number;
        novos_clientes: number;
        mrr_snapshot: number;
        mc_total: number;
        cac_burn: number;
        ativacao_total: number;
        ativacao_count: number;
        yearMonth: string;
      }

      const rawMonths: RawMonth[] = [];

      allMonthRefs.forEach(m => {
        const startDate = m.startDate;
        const endDate = m.endDate;
        const endStr = m.end;

        // base_inicio: active on 1st day
        const baseInicio = clients.filter(c => {
          if (!c.data_venda) return false;
          if (new Date(c.data_venda) > startDate) return false;
          if (c.data_cancelamento && new Date(c.data_cancelamento) <= startDate) return false;
          return true;
        });

        // cancelados within month
        const cancelados = clients.filter(c => {
          if (!c.data_cancelamento) return false;
          const dc = new Date(c.data_cancelamento);
          return dc >= startDate && dc <= endDate;
        });

        // novos clientes: data_venda within month
        const novos = clients.filter(c => {
          if (!c.data_venda) return false;
          const dv = new Date(c.data_venda);
          return dv >= startDate && dv <= endDate;
        });

        // ativos_fim: active at end of month
        const ativosFim = clients.filter(c => {
          if (!c.data_venda) return false;
          if (new Date(c.data_venda) > endDate) return false;
          if (c.data_cancelamento && new Date(c.data_cancelamento) <= endDate) return false;
          return true;
        });

        const mrrSnapshot = ativosFim.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0);

        // MC total
        let mcTotal = 0;
        ativosFim.forEach(c => {
          const mens = Number(c.mensalidade) || 0;
          const cogs = Number(c.custo_operacao) || 0;
          const imp = mens * (Number(c.imposto_percentual) || 0);
          const fix = mens * (Number(c.custo_fixo_percentual) || 0);
          mcTotal += mens - cogs - imp - fix;
        });

        // Ativação dos novos (separada do ARPA)
        let ativTotal = 0;
        let ativCount = 0;
        novos.forEach(c => {
          const va = Number(c.valor_ativacao) || 0;
          if (va > 0) {
            ativTotal += va;
            ativCount++;
          }
        });

        // CAC burn
        let cacBurn = 0;
        despesas.forEach(d => {
          const mesInicial = d.mes_inicial;
          const mesFinal = d.mes_final;
          if (mesInicial && mesInicial <= endStr) {
            if (!mesFinal || mesFinal >= m.start) {
              cacBurn += Number(d.valor_alocado) || 0;
            }
          }
        });

        rawMonths.push({
          base_inicio: baseInicio.length,
          cancelados: cancelados.length,
          ativos_fim: ativosFim.length,
          novos_clientes: novos.length,
          mrr_snapshot: mrrSnapshot,
          mc_total: mcTotal,
          cac_burn: cacBurn,
          ativacao_total: ativTotal,
          ativacao_count: ativCount,
          yearMonth: m.yearMonth,
        });
      });

      // Derived metrics
      const warmup = totalMonthsNeeded - rangeMonths;
      const series: MonthlyUnitEconomics[] = [];

      for (let i = warmup; i < totalMonthsNeeded; i++) {
        const ref = allMonthRefs[i];
        const raw = rawMonths[i];

        // Churn M
        const churnM = raw.base_inicio > 0 ? raw.cancelados / raw.base_inicio : null;

        // LTV M (meses)
        let ltvM: number | null = null;
        if (churnM === null) ltvM = null;
        else if (churnM === 0) ltvM = LTV_CAP;
        else ltvM = round2(1 / churnM);

        // ARPA (sem ativação)
        const arpa = raw.ativos_fim > 0 ? round2(raw.mrr_snapshot / raw.ativos_fim) : null;

        // MC% ponderada
        const mcPercent = raw.mrr_snapshot > 0 ? round2(raw.mc_total / raw.mrr_snapshot) : null;

        // LTV recorrente (margem) = ARPA × MC% × LTV_meses
        let ltvRecMargemM: number | null = null;
        if (arpa !== null && mcPercent !== null && ltvM !== null) {
          ltvRecMargemM = round2(arpa * mcPercent * ltvM);
        }

        // CAC por logo
        const cacPorLogoM = raw.novos_clientes > 0 ? round2(raw.cac_burn / raw.novos_clientes) : null;

        // LTV/CAC recorrente (usa CAC por logo)
        let ltvCacRecM: number | null = null;
        if (ltvRecMargemM !== null && cacPorLogoM !== null && cacPorLogoM > 0) {
          ltvCacRecM = round2(ltvRecMargemM / cacPorLogoM);
        }

        // Ativação média
        const ativacaoMedia = raw.novos_clientes > 0 ? round2(raw.ativacao_total / raw.novos_clientes) : null;

        // CAC Payback: CAC por logo / (ARPA × MC%)
        let cacPaybackM: number | null = null;
        if (cacPorLogoM !== null && arpa !== null && mcPercent !== null && arpa * mcPercent > 0) {
          cacPaybackM = round2(cacPorLogoM / (arpa * mcPercent));
        }

        // Window aggregation for 3M and 6M
        const windowCalc = (windowSize: number) => {
          const start = i - windowSize + 1;
          if (start < 0) return { ltv: null as number | null, ltvRecMargem: null as number | null, ltvCacRec: null as number | null };

          let totalCancelados = 0;
          let totalBaseInicio = 0;
          let totalMrr = 0;
          let totalClientes = 0;
          let totalMc = 0;
          let totalCacBurn = 0;
          let totalNovos = 0;

          for (let j = start; j <= i; j++) {
            const r = rawMonths[j];
            totalCancelados += r.cancelados;
            totalBaseInicio += r.base_inicio;
            totalMrr += r.mrr_snapshot;
            totalClientes += r.ativos_fim;
            totalMc += r.mc_total;
            totalCacBurn += r.cac_burn;
            totalNovos += r.novos_clientes;
          }

          // Churn window
          const churnW = totalBaseInicio > 0 ? totalCancelados / totalBaseInicio : null;
          let ltvW: number | null = null;
          if (churnW === null) ltvW = null;
          else if (churnW === 0) ltvW = LTV_CAP;
          else ltvW = round2(1 / churnW);

          // ARPA and MC% window
          const arpaW = totalClientes > 0 ? totalMrr / totalClientes : null;
          const mcPctW = totalMrr > 0 ? totalMc / totalMrr : null;

          // LTV recorrente margem window
          let ltvRecMargemW: number | null = null;
          if (ltvW !== null && arpaW !== null && mcPctW !== null) {
            ltvRecMargemW = round2(arpaW * mcPctW * ltvW);
          }

          // CAC por logo window
          const cacPorLogoW = totalNovos > 0 ? totalCacBurn / totalNovos : null;

          // LTV/CAC recorrente window
          let ltvCacRecW: number | null = null;
          if (ltvRecMargemW !== null && cacPorLogoW !== null && cacPorLogoW > 0) {
            ltvCacRecW = round2(ltvRecMargemW / cacPorLogoW);
          }

          return { ltv: ltvW, ltvRecMargem: ltvRecMargemW, ltvCacRec: ltvCacRecW };
        };

        const w3 = windowCalc(3);
        const w6 = windowCalc(6);

        series.push({
          month: ref.month,
          monthFull: ref.monthFull,
          yearMonth: ref.yearMonth,
          base_inicio: raw.base_inicio,
          cancelados: raw.cancelados,
          ativos_fim: raw.ativos_fim,
          novos_clientes: raw.novos_clientes,
          mrr_snapshot: round2(raw.mrr_snapshot),
          mc_total: round2(raw.mc_total),
          mc_percent: mcPercent,
          arpa,
          ativacao_media: ativacaoMedia,
          ativacao_total: round2(raw.ativacao_total),
          churn_M: churnM !== null ? round2(churnM) : null,
          ltv_M: ltvM,
          ltv_3M: w3.ltv,
          ltv_6M: w6.ltv,
          ltv_rec_margem_M: ltvRecMargemM,
          ltv_rec_margem_3M: w3.ltvRecMargem,
          ltv_rec_margem_6M: w6.ltvRecMargem,
          cac_burn_M: round2(raw.cac_burn),
          cac_por_logo_M: cacPorLogoM,
          ltv_cac_rec_M: ltvCacRecM,
          ltv_cac_rec_3M: w3.ltvCacRec,
          ltv_cac_rec_6M: w6.ltvCacRec,
          cac_payback_M: cacPaybackM,
        });
      }

      const current = series.length > 0 ? series[series.length - 1] : null;
      return { series, current };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
