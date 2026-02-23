import { useMemo } from "react";

interface EspelhoInput {
  mensalidade: number | null;
  custo_operacao: number | null;
  imposto_percentual: number | null;   // now receives as display value (e.g. 8 for 8%)
  custo_fixo_percentual: number | null; // now receives as display value (e.g. 35 for 35%)
}

export interface EspelhoResult {
  valor_repasse: number | null;
  impostos_rs: number | null;
  fixos_rs: number | null;
  lucro_bruto: number | null;
  margem_bruta_percent: number | null;
  markup_cogs_percent: number | null;
  fator_preco_x: number | null;
  margem_contribuicao: number | null;
  lucro_real: number | null;
}

export function useEspelhoFinanceiro(input: EspelhoInput): EspelhoResult {
  return useMemo(() => {
    const m = input.mensalidade ?? 0;
    const c = input.custo_operacao ?? 0;
    // Convert from display % (e.g. 8) to decimal (0.08)
    const imp = (input.imposto_percentual ?? 0) / 100;
    const fix = (input.custo_fixo_percentual ?? 0) / 100;

    const valor_repasse = m - c;
    const impostos_rs = m * imp;
    const fixos_rs = m * fix;
    const lucro_bruto = m - c - impostos_rs;
    const margem_bruta_percent = m > 0 ? (lucro_bruto / m) * 100 : null;
    const markup_cogs_percent = c > 0 ? ((m / c) - 1) * 100 : null;
    const fator_preco_x = c > 0 ? m / c : null;
    const margem_contribuicao = lucro_bruto - fixos_rs;
    const lucro_real = margem_contribuicao;

    return {
      valor_repasse,
      impostos_rs,
      fixos_rs,
      lucro_bruto,
      margem_bruta_percent,
      markup_cogs_percent,
      fator_preco_x,
      margem_contribuicao,
      lucro_real,
    };
  }, [input.mensalidade, input.custo_operacao, input.imposto_percentual, input.custo_fixo_percentual]);
}
