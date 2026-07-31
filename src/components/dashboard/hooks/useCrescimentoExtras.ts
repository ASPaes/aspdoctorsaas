import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import {
  calcRuleOf40,
  calcGrowthRate,
  calcGrowthPersistence,
  calcExpansionRate,
  calcNetLogoGrowth,
  calcLogoGrowthRate,
  calcArpaSegmentado,
  calcBurnMultiple,
  calcMagicNumber,
  linearRegressionForecast,
} from '@/lib/dashboard-metrics';
import type { DashboardFilters, KPIMetrics } from '../types';
import type { MargemContribuicaoData } from './useMargemContribuicaoDashboard';
import type { UnitEconomicsResult } from './useUnitEconomicsSeries';

export interface CrescimentoExtras {
  // Velocity
  growthRateMoM: number | null;
  growthRateQoQ: number | null;
  growthRateYoY: number | null;
  arrGrowthYoY: number | null;
  ruleOf40: number;

  // Composition
  expansionRate: number | null;
  reativacoesQtd: number;
  reativacoesMrr: number;

  // Acquisition
  netLogoGrowth: number;
  logoGrowthRate: number | null;
  arpaNovo: number | null;
  arpaBase: number | null;
  arpaRatio: number | null;

  // Efficiency
  burnMultiple: number | null;
  magicNumber: number | null;

  // Velocity avançada
  growthPersistence: number | null;

  // Net New histórico (médias móveis simples)
  netNewHistorico: {
    atual: number;
    media3m: number | null;
    media6m: number | null;
    media12m: number | null;
  };

  // Forecast
  mrrForecast: {
    points: Array<{ x: number; y: number; label: string }>;
    r2: number;
    confidence: 'alta' | 'média' | 'baixa';
  } | null;

  // Série completa (25 pontos)
  mrrSeries24m: Array<{ dataCorte: string; mrr: number; monthLabel: string }>;

  /**
   * Ponte do período: MRR início → componentes → MRR fim, na MESMA régua do snapshot.
   * Fecha por construção — mrrInicio + netNew === mrrFim.
   *
   * Existe porque o Net New de `useDashboardData` mede com régua diferente do card de
   * MRR e a conta não fechava (sobrava R$ 8k a R$ 21k/mês). Dois motivos, os dois lá:
   * `newMrr` soma produtos ativos HOJE (cliente que entrou e depois derrubou produto
   * encolhe retroativamente no "new"), e churn parcial — cliente que FICA na base e
   * cancela um produto — não entrava em componente nenhum.
   *
   * `downsell` e `churn` vêm NEGATIVOS daqui. Os cards de breakdown esperam positivo.
   */
  bridge: {
    mrrInicio: number;
    novo: number;
    upsell: number;
    crossSell: number;
    reativacao: number;
    reajuste: number;
    downsell: number;
    churn: number;
    netNew: number;
    mrrFim: number;
  } | null;
}

const MES_PT_ABBREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function monthLabelFromIso(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return `${MES_PT_ABBREV[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

function nextMonthLabel(baseIso: string, monthsAhead: number): string {
  const d = new Date(baseIso + 'T12:00:00');
  d.setMonth(d.getMonth() + monthsAhead);
  return `${MES_PT_ABBREV[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

function r2ToConfidence(r2: number): 'alta' | 'média' | 'baixa' {
  if (r2 >= 0.85) return 'alta';
  if (r2 >= 0.6) return 'média';
  return 'baixa';
}

/**
 * Hook complementar para a aba Crescimento V2.
 *
 * Combina `metrics`, `unitEconomics.current`, `mcData` e 25 pontos mensais
 * (RPC `get_mrr_monthly_snapshots` com p_months_back=24) para calcular todos
 * os indicadores novos da aba. É aditivo — não substitui hooks existentes.
 */
export function useCrescimentoExtras(params: {
  filters: DashboardFilters;
  metrics: KPIMetrics;
  unitEconomics: UnitEconomicsResult | undefined;
  mcData: MargemContribuicaoData | undefined;
}) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { filters, metrics, unitEconomics, mcData } = params;

  const unidadeBaseId = filters.unidadeBaseId ?? null;
  // `filters.fornecedorId` (singular) só é preenchido quando há EXATAMENTE um
  // fornecedor selecionado (DashboardFilters.tsx: `ids.length === 1 ? ids[0] : null`).
  // Usar só ele fazia duas coisas erradas: com 2+ selecionados a queryKey ficava
  // idêntica à de "sem filtro" e o React Query servia o cache não-filtrado, e a RPC
  // da série recebia NULL e ignorava a seleção múltipla em silêncio.
  const fornecedorIds = filters.fornecedorIds?.length
    ? [...filters.fornecedorIds].sort((a, b) => a - b)
    : null;
  const fornecedorKey = fornecedorIds ? fornecedorIds.join(',') : '';
  const dataReferencia = filters.periodoFim
    ? new Date(filters.periodoFim).toISOString().slice(0, 10)
    : null;
  const dataInicio = filters.periodoInicio
    ? new Date(filters.periodoInicio).toISOString().slice(0, 10)
    : null;

  return useQuery({
    queryKey: ['crescimento-extras', tid, unidadeBaseId, fornecedorKey, dataInicio, dataReferencia],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CrescimentoExtras> => {
      const { data: seriesData, error: seriesError } = await supabase.rpc('get_mrr_monthly_snapshots', {
        p_tenant_id: tid,
        p_months_back: 24,
        p_unidade_base_id: unidadeBaseId,
        p_fornecedor_ids: fornecedorIds,
        p_data_referencia: dataReferencia,
      });

      if (seriesError) {
        console.error('[useCrescimentoExtras] series error:', seriesError);
      }

      // Ponte do período — mesma régua do snapshot, fecha por construção.
      // Sem periodoInicio (ex.: "todos os dados") não há período para pontear.
      let bridge: CrescimentoExtras['bridge'] = null;
      if (dataInicio && dataReferencia) {
        const { data: bridgeData, error: bridgeError } = await (supabase.rpc as any)('get_mrr_bridge', {
          p_tenant_id: tid,
          p_inicio: dataInicio,
          p_fim: dataReferencia,
          p_unidade_base_id: unidadeBaseId,
          p_fornecedor_ids: fornecedorIds,
        });
        if (bridgeError) {
          console.error('[useCrescimentoExtras] bridge error:', bridgeError);
        } else if (Array.isArray(bridgeData) && bridgeData.length > 0) {
          const b = bridgeData[0] as any;
          bridge = {
            mrrInicio: Number(b.mrr_inicio) || 0,
            novo: Number(b.novo) || 0,
            upsell: Number(b.upsell) || 0,
            crossSell: Number(b.cross_sell) || 0,
            reativacao: Number(b.reativacao) || 0,
            reajuste: Number(b.reajuste) || 0,
            downsell: Number(b.downsell) || 0,
            churn: Number(b.churn) || 0,
            netNew: Number(b.net_new) || 0,
            mrrFim: Number(b.mrr_fim) || 0,
          };
        }
      }

      const mrrSeries24m = (seriesData as any[] | null ?? []).map((row: any) => ({
        dataCorte: row.data_corte as string,
        mrr: Number(row.mrr) || 0,
        monthLabel: monthLabelFromIso(row.data_corte),
      }));

      const n = mrrSeries24m.length;
      const current = unitEconomics?.current;
      const mcPercent = mcData?.mc_percent_ponderada ?? 0;

      const mrrAtual = n > 0 ? mrrSeries24m[n - 1].mrr : metrics.mrr;
      const mrr12mAtras = n >= 13 ? mrrSeries24m[n - 13].mrr : 0;
      const mrr24mAtras = n >= 25 ? mrrSeries24m[0].mrr : 0;
      const mrr3mAtras = n >= 4 ? mrrSeries24m[n - 4].mrr : 0;
      const mrr1mAtras = n >= 2 ? mrrSeries24m[n - 2].mrr : 0;

      // ── Velocity ──
      const growthRateMoM = calcGrowthRate(mrrAtual, mrr1mAtras);
      const growthRateQoQ = calcGrowthRate(mrrAtual, mrr3mAtras);
      const growthRateYoY = calcGrowthRate(mrrAtual, mrr12mAtras);
      const arrGrowthYoY = growthRateYoY;

      const ruleOf40 = calcRuleOf40(metrics.crescimentoPercent, mcPercent);

      const growthPersistence = (n >= 25)
        ? calcGrowthPersistence(mrrAtual, mrr12mAtras, mrr24mAtras)
        : null;

      // ── Composition ──
      const expansionRate = calcExpansionRate(
        metrics.upsellMrr,
        metrics.crossSellMrr,
        metrics.reativacaoMrr,
        metrics.reajusteMrr,
        metrics.mrrInicio,
      );

      // ── Acquisition ──
      const novosClientes = current?.novos_clientes ?? metrics.novosClientes ?? 0;
      const cancelados = current?.cancelados ?? metrics.cancelamentosQtd ?? 0;
      const baseInicio = current?.base_inicio ?? metrics.clientesInicioCount ?? 0;
      const ativosFim = current?.ativos_fim ?? metrics.clientesAtivos ?? 0;

      const netLogoGrowth = calcNetLogoGrowth(novosClientes, cancelados);
      const logoGrowthRate = calcLogoGrowthRate(novosClientes, cancelados, baseInicio);

      const arpa = calcArpaSegmentado(
        metrics.newMrr,
        novosClientes,
        metrics.mrr,
        ativosFim,
      );

      // ── Efficiency ──
      const cacBurn = current?.cac_burn_M ?? 0;
      const burnMultiple = calcBurnMultiple(cacBurn, metrics.netNewMrr);
      const magicNumber = calcMagicNumber(metrics.netNewMrr, cacBurn);

      // ── Net New histórico (médias móveis) ──
      const netNewMonthly: number[] = [];
      for (let i = 1; i < mrrSeries24m.length; i++) {
        netNewMonthly.push(mrrSeries24m[i].mrr - mrrSeries24m[i - 1].mrr);
      }
      const NN = netNewMonthly.length;
      const smaWindow = (windowSize: number): number | null => {
        if (NN < windowSize) return null;
        const slice = netNewMonthly.slice(NN - windowSize, NN);
        return slice.reduce((s, v) => s + v, 0) / windowSize;
      };
      const netNewHistorico = {
        atual: NN > 0 ? netNewMonthly[NN - 1] : 0,
        media3m: smaWindow(3),
        media6m: smaWindow(6),
        media12m: smaWindow(12),
      };

      // ── Forecast MRR 90d ──
      let mrrForecast: CrescimentoExtras['mrrForecast'] = null;
      if (n >= 12) {
        const lastTwelve = mrrSeries24m.slice(n - 12).map((p) => p.mrr);
        const fc = linearRegressionForecast(lastTwelve, 3);
        if (fc.points.length === 3) {
          const baseIso = mrrSeries24m[n - 1].dataCorte;
          mrrForecast = {
            points: fc.points.map((p, i) => ({
              x: p.x,
              y: p.y,
              label: nextMonthLabel(baseIso, i + 1),
            })),
            r2: fc.r2,
            confidence: r2ToConfidence(fc.r2),
          };
        }
      }

      return {
        growthRateMoM,
        growthRateQoQ,
        growthRateYoY,
        arrGrowthYoY,
        ruleOf40,
        expansionRate,
        reativacoesQtd: metrics.reativacoesQtd ?? 0,
        reativacoesMrr: metrics.reativacaoMrr ?? 0,
        netLogoGrowth,
        logoGrowthRate,
        arpaNovo: arpa.arpaNovo,
        arpaBase: arpa.arpaBase,
        arpaRatio: arpa.ratio,
        burnMultiple,
        magicNumber,
        growthPersistence,
        mrrForecast,
        netNewHistorico,
        mrrSeries24m,
        bridge,
      };
    },
  });
}
