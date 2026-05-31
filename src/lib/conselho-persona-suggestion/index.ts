/**
 * Sugere até 4 personas (slugs) baseado nos indicadores e regras da aba.
 * Determinístico, sem LLM. Usado pelo botão "Sugestão do Conselho DS" no diálogo.
 */

export interface PersonaSuggestionInput {
  // Visão Geral
  quickRatio?: number;
  nrr?: number;
  grr?: number;
  ltvCac?: number;
  cacPayback?: number;
  concentracaoTop10?: number;
  churnCarteira?: number;
  ruleOf40?: number;
  crescimentoPercent?: number;
  cancelamentosQtd?: number;
}

interface Rule {
  slug: string;
  priority: number;
  matches: (i: PersonaSuggestionInput) => boolean;
}

const RULES_BY_TAB: Record<string, Rule[]> = {
  'visao-geral': [
    { slug: 'bruno-nardon', priority: 1, matches: () => true },
    { slug: 'nick-mehta', priority: 2, matches: (i) => (i.quickRatio !== undefined && i.quickRatio < 1) || (i.nrr !== undefined && i.nrr < 1) },
    { slug: 'david-skok', priority: 3, matches: (i) => (i.ltvCac !== undefined && i.ltvCac < 3) || (i.cacPayback !== undefined && i.cacPayback > 18) },
    { slug: 'alfredo-soares', priority: 4, matches: (i) => i.concentracaoTop10 !== undefined && i.concentracaoTop10 > 0.4 },
    { slug: 'tallis-gomes', priority: 5, matches: (i) => i.crescimentoPercent !== undefined && i.crescimentoPercent < 0.02 },
    { slug: 'diego-wagner', priority: 6, matches: (i) => i.churnCarteira !== undefined && i.churnCarteira > 0.03 },
    { slug: 'david-skok', priority: 7, matches: () => true },
    { slug: 'tallis-gomes', priority: 8, matches: () => true },
  ],
};

export function suggestPersonasForTab(
  input: PersonaSuggestionInput | null | undefined,
  tabKey: string,
  defaultsByTab: string[] = []
): string[] {
  const rules = RULES_BY_TAB[tabKey];
  if (!rules) return defaultsByTab.slice(0, 4);

  if (!input || Object.keys(input).length === 0) {
    return defaultsByTab.slice(0, 4);
  }

  const matched: string[] = [];
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    try {
      if (rule.matches(input) && !matched.includes(rule.slug)) {
        matched.push(rule.slug);
        if (matched.length >= 4) break;
      }
    } catch { /* ignore */ }
  }

  if (matched.length < 4) {
    for (const slug of defaultsByTab) {
      if (!matched.includes(slug)) {
        matched.push(slug);
        if (matched.length >= 4) break;
      }
    }
  }

  return matched.slice(0, 4);
}
