import { useMemo } from "react";

interface EspelhoInput {
  mensalidade: number | null;
  custo_operacao: number | null;
  imposto_percentual: number | null;   // display value (e.g. 8 for 8%)
  custo_fixo_percentual: number | null; // display value (e.g. 35 for 35%)
  deltaMrr?: number;
  deltaCusto?: number;
}

export interface EspelhoResult {
  mrrEfetivo: number;
  custoEfetivo: number;
  valor_apos_cogs: number;
  impostos_rs: number;
  margem_contribuicao: number;
  margem_contribuicao_percent: number | null;
  fixos_rs: number;
  lucro_real: number;
  lucro_real_percent: number | null;
  markup_cogs_percent: number | null;
  fator_preco_x: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function safePct(num: number, den: number): number | null {
  if (den === 0 || !isFinite(num / den)) return null;
  return round2((num / den) * 100);
}

export function useEspelhoFinanceiro(input: EspelhoInput): EspelhoResult {
  return useMemo(() => {
    const mBase = input.mensalidade ?? 0;
    const cBase = input.custo_operacao ?? 0;
    const m = round2(mBase + (input.deltaMrr ?? 0));   // MRR Atual
    const c = round2(cBase + (input.deltaCusto ?? 0));  // COGS Atual
    const imp = (input.imposto_percentual ?? 0) / 100;
    const fix = (input.custo_fixo_percentual ?? 0) / 100;

    // 1. Receita após COGS
    const valor_apos_cogs = round2(m - c);

    // 2. Impostos
    const impostos_rs = round2(m * imp);

    // 3. Margem de Contribuição = MRR - COGS - Impostos
    const margem_contribuicao = round2(m - c - impostos_rs);
    const margem_contribuicao_percent = safePct(margem_contribuicao, m);

    // 4. Custos Fixos alocados
    const fixos_rs = round2(m * fix);

    // 5. Lucro Real = MC - Custos Fixos
    const lucro_real = round2(margem_contribuicao - fixos_rs);
    const lucro_real_percent = safePct(lucro_real, m);

    // Indicadores auxiliares
    const markup_cogs_percent = c > 0 ? round2(((m / c) - 1) * 100) : null;
    const fator_preco_x = c > 0 ? round2(m / c) : null;

    return {
      mrrEfetivo: m,
      custoEfetivo: c,
      valor_apos_cogs,
      impostos_rs,
      margem_contribuicao,
      margem_contribuicao_percent,
      fixos_rs,
      lucro_real,
      lucro_real_percent,
      markup_cogs_percent,
      fator_preco_x,
    };
  }, [input.mensalidade, input.custo_operacao, input.imposto_percentual, input.custo_fixo_percentual, input.deltaMrr, input.deltaCusto]);
}
