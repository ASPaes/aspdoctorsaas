export type Severity = 'ok' | 'warn' | 'crit';
export type ActionPriority = 'critical' | 'high' | 'strategic';
export type DiagnosticoTab = 'visao-geral' | 'crescimento' | 'cancelamentos' | 'vendas' | 'distribuicao' | 'cs' | 'cohort';

export interface DiagCause {
  id: string;
  text: string;
  severity: Severity;
}

export interface DiagAction {
  id: string;
  text: string;
  priority: ActionPriority;
  timeframe: string;
}

export interface Diagnostico {
  severity: Severity;
  alertCount: number;
  headline: string;
  causes: DiagCause[];
  actions: DiagAction[];
  generatedAt: string;
}

/**
 * Input para o engine de diagnóstico.
 * Todos os campos opcionais — a engine ignora regras cuja métrica não foi fornecida.
 */
export interface DiagnosticoInput {
  // Receita / volume
  mrr?: number;
  newMrr?: number;
  mrrCancelado?: number;
  downsellMrr?: number;
  reativacaoMrr?: number;
  upsellMrr?: number;
  crossSellMrr?: number;
  // Retenção (valores decimais: 0.78 = 78%)
  nrr?: number;
  grr?: number;
  quickRatio?: number;
  churnCarteira?: number;
  // Unit economics
  cacPayback?: number;       // meses
  ltvCac?: number;           // multiplicador
  ruleOf40?: number;         // pontos
  mcPercentPonderada?: number; // decimal
  // Carteira
  tenureMedio?: number;      // meses
  concentracaoTop10?: number; // decimal
  clientesAtivos?: number;
  cancelamentosQtd?: number;

  // Crescimento V2 — Velocity / Efficiency
  burnMultiple?: number;        // ratio (1.4 = 1.4x)
  magicNumber?: number;         // ratio (0.82 = 0.82x)
  expansionRate?: number;       // decimal mensal (0.023 = 2.3%)
  growthRateMoM?: number;       // decimal (0.057 = 5.7%)
  arrGrowthYoY?: number;        // decimal (0.183 = 18.3%)
  netLogoGrowth?: number;       // absoluto (+12)
  logoGrowthRate?: number;      // decimal (0.018 = 1.8%)
  growthPersistence?: number;   // ratio (0.9 = mantendo, >1 = acelerando)

  // Cancelamentos V2 — derivados do useCancelamentosExtras
  earlyChurnRate?: number;          // decimal (0.18 = 18%)
  motivoConcentradoPct?: number;    // decimal — % do MRR perdido concentrado no motivo top 1
  segmentoChurnMax?: number;        // decimal — maior churn_rate entre segmentos com base relevante (≥5 clientes)
  tendenciaSubindoFator?: number;   // ratio recente_6m / anterior_6m do motivo que mais cresceu (1.3 = +30%)
  winbackTotal12m?: number;         // qtd reativações nos últimos 12 meses
  mortalidadeQtdPct?: number;       // decimal — % do volume de cancelamentos categorizados como mortality
  origemMaxChurn?: number;          // decimal — maior churn rate entre origens com ≥3 cancelamentos no período (0.07 = 7%)
}

/**
 * Regra declarativa do engine.
 * Se `match(input)` retorna true, a causa é incluída.
 */
export interface DiagnosticoRule {
  id: string;
  tab: DiagnosticoTab;
  severity: Severity;
  priority: number;            // maior = mais relevante (ordena causas)
  match: (input: DiagnosticoInput) => boolean;
  buildCause: (input: DiagnosticoInput) => string;
  // ids de actions associadas (resolvidos em actions.ts)
  actionIds: string[];
}

export interface ActionTemplate {
  id: string;
  text: string;
  priority: ActionPriority;
  timeframe: string;
}
