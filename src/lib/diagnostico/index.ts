import type { DiagnosticoInput, DiagnosticoTab, Diagnostico, Severity, DiagCause, DiagAction } from './types';
import { RULES } from './rules';
import { ACTIONS } from './actions';
import { buildHeadline } from './headlines';

const severityRank: Record<Severity, number> = { indeterminado: -1, ok: 0, warn: 1, crit: 2 };

/**
 * Computa o diagnóstico executivo a partir das métricas + aba.
 * Retorna severidade geral, headline impactante, top 3 causas e top 3 ações.
 */
export function computeDiagnostico(
  input: DiagnosticoInput,
  tab: DiagnosticoTab = 'visao-geral',
): Diagnostico {
  const tabRules = RULES.filter((r) => r.tab === tab);
  const matchedRules = tabRules
    .filter((r) => r.match(input))
    .sort((a, b) => {
      const sev = severityRank[b.severity] - severityRank[a.severity];
      if (sev !== 0) return sev;
      return b.priority - a.priority;
    });

  const causes: DiagCause[] = matchedRules.slice(0, 3).map((r) => ({
    id: r.id,
    text: r.buildCause(input),
    severity: r.severity,
  }));

  // Aba SEM nenhuma regra cadastrada → 'indeterminado' (NÃO assumir saudável).
  // Aba com regras mas nenhuma disparou → 'ok'. Senão, a maior severidade das causas.
  const severity: Severity = tabRules.length === 0
    ? 'indeterminado'
      : causes.length === 0
      ? (input.comparativoIndeterminado === true ? 'indeterminado' : 'ok')
      : causes.reduce<Severity>((acc, c) => (severityRank[c.severity] > severityRank[acc] ? c.severity : acc), 'ok');

  const alertCount = matchedRules.filter((r) => r.severity === 'crit').length;

  // Coletar ids de ações na ordem de relevância das causas, deduplicar, pegar top 3
  const actionIdQueue: string[] = [];
  for (const rule of matchedRules) {
    for (const aid of rule.actionIds) {
      if (!actionIdQueue.includes(aid)) actionIdQueue.push(aid);
    }
  }
  const actions: DiagAction[] = actionIdQueue
    .slice(0, 3)
    .map((aid) => ACTIONS[aid])
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const headline = buildHeadline(input, severity, tab);

  return {
    severity,
    alertCount,
    headline,
    causes,
    actions,
    generatedAt: new Date().toISOString(),
  };
}

export type { Diagnostico, DiagnosticoInput, DiagnosticoTab, Severity, DiagCause, DiagAction, ActionPriority } from './types';
