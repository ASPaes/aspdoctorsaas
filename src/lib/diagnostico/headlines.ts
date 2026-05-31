import type { DiagnosticoInput, Severity } from './types';

/**
 * Seleciona a melhor headline para o estado atual.
 * Prioridade: padrões de problema agudo > padrões mistos > padrões saudáveis.
 */
export function buildHeadline(input: DiagnosticoInput, severity: Severity): string {
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
