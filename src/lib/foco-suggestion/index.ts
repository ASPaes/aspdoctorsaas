/**
 * Sugestão determinística de "foco do mês" baseada em indicadores reais.
 * Não chama LLM. Retorna a 1ª regra que case (priorizada por severidade financeira).
 *
 * Usado por: ConselhoDSConfigDialog (botão "Sugerir foco")
 */

export type TabKey = 'visao-geral' | 'crescimento' | 'cancelamentos' | 'vendas' | 'distribuicao' | 'cs' | 'cohort';

export interface FocoSuggestInput {
  // Visão Geral
  mrr?: number;
  nrr?: number;
  grr?: number;
  quickRatio?: number;
  cacPayback?: number;
  ltvCac?: number;
  ruleOf40?: number;
  concentracaoTop10?: number;
  churnCarteira?: number;
  cancelamentosQtd?: number;
  crescimentoPercent?: number;
  newMrr?: number;
  mrrCancelado?: number;
  downsellMrr?: number;
  upsellMrr?: number;
  crossSellMrr?: number;
}

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtPts = (v: number, digits = 1) => v.toFixed(digits);
const fmtX = (v: number) => `${v.toFixed(2)}x`;
const fmtMeses = (v: number) => `${v.toFixed(1)}m`;
const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);

interface Rule {
  id: string;
  condition: (i: FocoSuggestInput) => boolean;
  build: (i: FocoSuggestInput) => string;
  priority: number; // menor = mais prioritário
}

// ────────────────────────────────────────────────────────────
// Regras para Visão Geral (financeiro)
// ────────────────────────────────────────────────────────────
const RULES_VISAO_GERAL: Rule[] = [
  {
    id: 'quick-ratio-crit',
    priority: 1,
    condition: (i) => typeof i.quickRatio === 'number' && i.quickRatio < 1,
    build: (i) => {
      const lost = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      const gained = (i.newMrr ?? 0) + (i.upsellMrr ?? 0) + (i.crossSellMrr ?? 0);
      return `Estancar a contração de receita. Quick Ratio em ${fmtX(i.quickRatio!)} (meta ≥ 4x): entrou ${fmtBRL(gained)} e saiu ${fmtBRL(lost)} no período. Foco em reduzir churn e downsell antes de acelerar aquisição.`;
    },
  },
  {
    id: 'nrr-baixo',
    priority: 2,
    condition: (i) => typeof i.nrr === 'number' && i.nrr < 1,
    build: (i) =>
      `Ativar motor de expansão. NRR em ${fmtPct(i.nrr!)} (meta ≥ 110%) significa que a base ativa está encolhendo em receita. Foco em upsell, cross-sell e reativação dentro da carteira atual.`,
  },
  {
    id: 'ltv-cac-baixo',
    priority: 3,
    condition: (i) => typeof i.ltvCac === 'number' && i.ltvCac > 0 && i.ltvCac < 3,
    build: (i) =>
      `Melhorar a rentabilidade por cliente. LTV/CAC em ${fmtX(i.ltvCac!)} (meta ≥ 3x) — cada cliente devolve pouco em relação ao custo de aquisição. Foco em reduzir CAC OU aumentar ticket/retenção.`,
  },
  {
    id: 'cac-payback-alto',
    priority: 4,
    condition: (i) => typeof i.cacPayback === 'number' && i.cacPayback > 18,
    build: (i) =>
      `Reduzir o tempo de retorno do CAC. Hoje em ${fmtMeses(i.cacPayback!)} (meta ≤ 12m) — muito caixa preso por cliente novo. Foco em aumentar ARPA na venda ou acelerar onboarding até ativação.`,
  },
  {
    id: 'concentracao-alta',
    priority: 5,
    condition: (i) => typeof i.concentracaoTop10 === 'number' && i.concentracaoTop10 > 0.4,
    build: (i) =>
      `Diversificar a base de receita. Os 10 maiores clientes representam ${fmtPct(i.concentracaoTop10!)} do MRR (ideal < 30%). Risco alto de dependência — foco em ampliar volume de contas médias.`,
  },
  {
    id: 'churn-alto',
    priority: 6,
    condition: (i) => typeof i.churnCarteira === 'number' && i.churnCarteira > 0.03,
    build: (i) =>
      `Investigar causa-raiz dos cancelamentos. Churn de carteira em ${fmtPct(i.churnCarteira!)} no período (meta ≤ 2%). Auditar contratos cancelados e identificar padrão comum (preço, produto, atendimento).`,
  },
  {
    id: 'rule-of-40-baixo',
    priority: 7,
    condition: (i) => typeof i.ruleOf40 === 'number' && i.ruleOf40 < 20,
    build: (i) =>
      `Equilibrar crescimento e eficiência. Rule of 40 em ${fmtPts(i.ruleOf40!)} pontos (meta ≥ 40). Ou cresce mais, ou margem precisa subir — escolher uma das duas frentes para este mês.`,
  },
  {
    id: 'crescimento-estagnado',
    priority: 8,
    condition: (i) => typeof i.crescimentoPercent === 'number' && i.crescimentoPercent < 0.02,
    build: (i) =>
      `Acelerar aquisição. Crescimento de ${fmtPct(i.crescimentoPercent!)} no período está abaixo do mínimo saudável (2-3% MoM). Foco em ativar canais de prospecção e revisar conversão do funil.`,
  },
  // fallback positivo
  {
    id: 'saudavel',
    priority: 99,
    condition: () => true,
    build: () =>
      `Manter o ritmo saudável e identificar a próxima alavanca de crescimento. Indicadores em zona segura — foco em consolidar ganhos e preparar a próxima fase (novo segmento, novo produto, novo canal).`,
  },
];

const RULES_BY_TAB: Record<string, Rule[]> = {
  'visao-geral': RULES_VISAO_GERAL,
  // futuras abas plugam aqui
};

/**
 * Sugere texto pra "foco do mês" baseado nos indicadores e na aba.
 * Retorna null se não houver dados suficientes pra sugerir.
 */
export function suggestFocoMes(input: FocoSuggestInput | null | undefined, tabKey: string): string | null {
  if (!input) return null;
  const rules = RULES_BY_TAB[tabKey];
  if (!rules) return null;

  const matched = rules
    .filter((r) => {
      try { return r.condition(input); } catch { return false; }
    })
    .sort((a, b) => a.priority - b.priority);

  const winner = matched[0];
  if (!winner) return null;
  try {
    return winner.build(input);
  } catch {
    return null;
  }
}
