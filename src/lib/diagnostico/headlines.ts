import type { DiagnosticoInput, DiagnosticoTab, Severity } from './types';

/**
 * Seleciona a melhor headline para o estado atual.
 * Prioridade: padrões específicos da aba > padrões genéricos de problema > padrões saudáveis.
 */
export function buildHeadline(
  input: DiagnosticoInput,
  severity: Severity,
  tab?: DiagnosticoTab,
): string {
  // ─── Padrões específicos da aba Crescimento ───
  if (tab === 'crescimento') {
    // Crescimento dependente de aquisição (expansion fraca + R40 baixo)
    if (
      input.expansionRate !== undefined && input.expansionRate < 0.02 &&
      input.ruleOf40 !== undefined && input.ruleOf40 < 40
    ) {
      return `Crescimento sustentado, mas dependente de aquisição. Sem expansão da base, cada mês exige reposição completa via novas vendas.`;
    }
    // Máquina cara de crescimento (Burn Multiple alto OU Magic Number baixo)
    if (
      (input.burnMultiple !== undefined && input.burnMultiple > 1.5) ||
      (input.magicNumber !== undefined && input.magicNumber < 0.5)
    ) {
      return `Crescer está caro. Cada R$ de receita exige mais investimento do que devolve — eficiência marginal abaixo do saudável.`;
    }
    // Crescimento estagnado (Growth MoM + ARR YoY baixos)
    if (
      input.growthRateMoM !== undefined && input.growthRateMoM < 0.02 &&
      input.arrGrowthYoY !== undefined && input.arrGrowthYoY < 0.15
    ) {
      return `Crescimento estagnado em MoM e YoY. Falta motor — seja em aquisição, expansão ou pricing.`;
    }
    // Crescimento acelerando (Growth Persistence alta)
    if (input.growthPersistence !== undefined && input.growthPersistence >= 1) {
      return `Crescimento acelerando. A taxa de crescimento deste ciclo supera a do ciclo anterior — momentum positivo.`;
    }
  }

  // Padrão #1: Motor comercial vs hemorragia (mais grave e mais comum)
  const newMrr = input.newMrr ?? 0;
  const lost = (input.mrrCancelado ?? 0) + (input.downsellMrr ?? 0);
  if (lost > 0 && newMrr > 0 && newMrr / lost < 0.15) {
    const ratio = Math.round(lost / newMrr);
    return `O motor comercial não compensa a hemorragia da base. A cada R$ 1 que entra, R$ ${ratio} saem.`;
  }

  // Padrão #2: NRR encolhendo com expansão parada
  if (input.nrr !== undefined && input.nrr < 0.9 && input.grr !== undefined && (input.nrr - input.grr) < 0.05) {
    return `Receita encolhe sem motor de expansão. Sem upsell ou cross-sell para compensar as perdas, cada mês a base fica menor.`;
  }

  // Padrão #3: NRR > 110% (expansão saudável)
  if (input.nrr !== undefined && input.nrr >= 1.1) {
    return `A base cresce sozinha. Mesmo sem novos clientes, a expansão compensa as perdas — o motor de retenção está saudável.`;
  }

  // Padrão #4: GRR alto mas Quick Ratio baixo (retém mas não cresce)
  if (input.grr !== undefined && input.grr >= 0.9 && input.quickRatio !== undefined && input.quickRatio < 1) {
    return `Base estável, crescimento estagnado. Retenção forte mas o motor de aquisição não está entregando.`;
  }

  // Fallback por severidade
  if (severity === 'crit') {
    return 'Estado crítico — múltiplos indicadores em zona vermelha demandam ação imediata.';
  }
  if (severity === 'warn') {
    return 'Indicadores mistos — alguns sinais de atenção que merecem ação preventiva.';
  }
  return 'Indicadores em zona saudável — manter cadência operacional atual.';
}
