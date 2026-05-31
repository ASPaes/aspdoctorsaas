import type { DiagnosticoRule } from './types';

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtPP = (v: number) => `${v.toFixed(2)}pp`;
const fmtX = (v: number) => `${v.toFixed(2)}x`;

export const RULES: DiagnosticoRule[] = [
  // ═══════════ VISÃO GERAL ═══════════

  // R1 — Quick Ratio crítico (perde mais que entra)
  {
    id: 'vg_quick_ratio_critical',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 100,
    match: (i) => i.quickRatio !== undefined && i.quickRatio < 1,
    buildCause: (i) => {
      const entrada = (i.newMrr ?? 0) + (i.upsellMrr ?? 0) + (i.crossSellMrr ?? 0) + (i.reativacaoMrr ?? 0);
      const saida = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      const ratio = saida > 0 && entrada > 0 ? (saida / entrada).toFixed(0) : '∞';
      return `Quick Ratio = ${fmtX(i.quickRatio!)} — a cada R$ 1 que entra, R$ ${ratio} saem (meta ≥ 4x)`;
    },
    actionIds: ['audit_cancellations', 'upsell_playbook', 'funnel_optimization'],
  },

  // R2 — NRR crítico
  {
    id: 'vg_nrr_critical',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 95,
    match: (i) => i.nrr !== undefined && i.nrr < 0.9,
    buildCause: (i) => `NRR = ${fmtPct(i.nrr!)} — receita encolhe mesmo com expansão (meta ≥ 110%)`,
    actionIds: ['retention_playbook', 'upsell_playbook', 'nps_survey'],
  },

  // R3 — GRR crítico
  {
    id: 'vg_grr_critical',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 90,
    match: (i) => i.grr !== undefined && i.grr < 0.75,
    buildCause: (i) => `GRR = ${fmtPct(i.grr!)} — perda estrutural da base (meta ≥ 90%)`,
    actionIds: ['audit_cancellations', 'health_score_immediate', 'nps_survey'],
  },

  // R4 — Motor de expansão parado (NRR − GRR baixo)
  {
    id: 'vg_expansion_stalled',
    tab: 'visao-geral',
    severity: 'warn',
    priority: 85,
    match: (i) => i.nrr !== undefined && i.grr !== undefined && (i.nrr - i.grr) < 0.05,
    buildCause: (i) => `NRR − GRR = ${fmtPP((i.nrr! - i.grr!) * 100)} — motor de expansão parado (meta ≥ 10pp)`,
    actionIds: ['upsell_playbook', 'pricing_review'],
  },

  // R5 — Rule of 40 crítico
  {
    id: 'vg_rule_of_40_critical',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 80,
    match: (i) => i.ruleOf40 !== undefined && i.ruleOf40 < 20,
    buildCause: (i) => `Rule of 40 = ${i.ruleOf40!.toFixed(1)} (meta ≥ 40) — saúde geral comprometida`,
    actionIds: ['cogs_renegotiation', 'pricing_review', 'upsell_playbook'],
  },

  // R6 — New MRR muito menor que perdas
  {
    id: 'vg_new_vs_loss',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 75,
    match: (i) => {
      const newMrr = i.newMrr ?? 0;
      const lost = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      return lost > 0 && newMrr / lost < 0.3;
    },
    buildCause: (i) => {
      const newMrr = i.newMrr ?? 0;
      const lost = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      const pct = lost > 0 ? Math.round((newMrr / lost) * 100) : 0;
      return `New MRR (${fmtBRL(newMrr)}) é só ${pct}% do MRR perdido (${fmtBRL(lost)})`;
    },
    actionIds: ['funnel_optimization', 'audit_cancellations'],
  },

  // R7 — CAC Payback longo
  {
    id: 'vg_cac_payback_long',
    tab: 'visao-geral',
    severity: 'warn',
    priority: 60,
    match: (i) => i.cacPayback !== undefined && i.cacPayback > 18,
    buildCause: (i) => `CAC Payback = ${i.cacPayback!.toFixed(0)} meses — capital preso por tempo demais (meta ≤ 12m)`,
    actionIds: ['pricing_review', 'cogs_renegotiation', 'funnel_optimization'],
  },

  // R8 — LTV/CAC abaixo de 3
  {
    id: 'vg_ltv_cac_low',
    tab: 'visao-geral',
    severity: 'warn',
    priority: 55,
    match: (i) => i.ltvCac !== undefined && i.ltvCac < 3,
    buildCause: (i) => `LTV/CAC = ${fmtX(i.ltvCac!)} — unit economics frágil (meta ≥ 3x)`,
    actionIds: ['retention_playbook', 'pricing_review'],
  },

  // R9 — Concentração Top 10 alta
  {
    id: 'vg_top10_concentration',
    tab: 'visao-geral',
    severity: 'warn',
    priority: 50,
    match: (i) => i.concentracaoTop10 !== undefined && i.concentracaoTop10 > 0.5,
    buildCause: (i) => `Concentração Top 10 = ${fmtPct(i.concentracaoTop10!)} — risco de carteira (ideal < 30%)`,
    actionIds: ['diversify_portfolio', 'cs_team_structure'],
  },

  // R10 — Churn carteira alto
  {
    id: 'vg_churn_carteira_high',
    tab: 'visao-geral',
    severity: 'crit',
    priority: 70,
    match: (i) => i.churnCarteira !== undefined && i.churnCarteira > 0.05,
    buildCause: (i) => `Churn de carteira = ${fmtPct(i.churnCarteira!)} (meta < 2% ao mês)`,
    actionIds: ['audit_cancellations', 'health_score_immediate', 'onboarding_overhaul'],
  },
];
