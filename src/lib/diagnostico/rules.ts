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

  // ═══════════ CRESCIMENTO ═══════════

  // C1 — Net New MRR negativo (crítico)
  {
    id: 'cr_net_new_negative',
    tab: 'crescimento',
    severity: 'crit',
    priority: 100,
    match: (i) => {
      const entrada = (i.newMrr ?? 0) + (i.upsellMrr ?? 0) + (i.crossSellMrr ?? 0) + (i.reativacaoMrr ?? 0);
      const saida = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      return saida > entrada && entrada >= 0;
    },
    buildCause: (i) => {
      const entrada = (i.newMrr ?? 0) + (i.upsellMrr ?? 0) + (i.crossSellMrr ?? 0) + (i.reativacaoMrr ?? 0);
      const saida = (i.mrrCancelado ?? 0) + (i.downsellMrr ?? 0);
      return `Net New MRR negativo — entrada ${fmtBRL(entrada)} vs saída ${fmtBRL(saida)} (você está encolhendo)`;
    },
    actionIds: ['audit_cancellations', 'funnel_optimization', 'retention_playbook'],
  },

  // C2 — Net Logo Growth negativo (perde base)
  {
    id: 'cr_logo_growth_negative',
    tab: 'crescimento',
    severity: 'crit',
    priority: 95,
    match: (i) => i.netLogoGrowth !== undefined && i.netLogoGrowth < 0,
    buildCause: (i) => `Net Logo Growth = ${i.netLogoGrowth!} — base de clientes encolheu no período`,
    actionIds: ['audit_cancellations', 'funnel_optimization', 'onboarding_overhaul'],
  },

  // C3 — Burn Multiple crítico (eficiência ruim)
  {
    id: 'cr_burn_multiple_critical',
    tab: 'crescimento',
    severity: 'crit',
    priority: 90,
    match: (i) => i.burnMultiple !== undefined && i.burnMultiple > 2,
    buildCause: (i) => `Burn Multiple = ${fmtX(i.burnMultiple!)} — gasta R$ ${i.burnMultiple!.toFixed(2)} em CAC para gerar R$ 1 de Net New (meta < 1x)`,
    actionIds: ['freeze_cac_spend', 'sales_efficiency_audit', 'pricing_review'],
  },

  // C4 — Growth Persistence baixo (desaceleração forte)
  {
    id: 'cr_growth_decelerating_strong',
    tab: 'crescimento',
    severity: 'crit',
    priority: 85,
    match: (i) => i.growthPersistence !== undefined && i.growthPersistence < 0.5,
    buildCause: (i) => `Growth Persistence = ${fmtX(i.growthPersistence!)} — crescimento desacelerou fortemente vs ano anterior`,
    actionIds: ['growth_strategy_review', 'funnel_optimization', 'expansion_program_launch'],
  },

  // C5 — ARR Growth YoY baixo
  {
    id: 'cr_arr_growth_low',
    tab: 'crescimento',
    severity: 'warn',
    priority: 70,
    match: (i) => i.arrGrowthYoY !== undefined && i.arrGrowthYoY < 0.15,
    buildCause: (i) => `ARR Growth YoY = ${fmtPct(i.arrGrowthYoY!)} (meta ≥ 30% para B2B SaaS estabelecida)`,
    actionIds: ['growth_strategy_review', 'sales_efficiency_audit', 'expansion_program_launch'],
  },

  // C6 — Expansion Rate baixa (dependente de aquisição)
  {
    id: 'cr_expansion_starved',
    tab: 'crescimento',
    severity: 'warn',
    priority: 65,
    match: (i) => i.expansionRate !== undefined && i.expansionRate < 0.02,
    buildCause: (i) => `Expansion Rate = ${fmtPct(i.expansionRate!)} — só ${fmtPct(i.expansionRate!)} do growth vem da base existente (meta ≥ 5%)`,
    actionIds: ['expansion_program_launch', 'upsell_playbook', 'pricing_review'],
  },

  // C7 — Magic Number baixo (vendas ineficientes)
  {
    id: 'cr_magic_number_low',
    tab: 'crescimento',
    severity: 'warn',
    priority: 60,
    match: (i) => i.magicNumber !== undefined && i.magicNumber < 0.5,
    buildCause: (i) => `Magic Number = ${fmtX(i.magicNumber!)} — máquina de vendas não devolve o investimento em CAC (meta ≥ 1x)`,
    actionIds: ['sales_efficiency_audit', 'funnel_optimization', 'pricing_review'],
  },

  // C8 — Logo Growth Rate baixo (base estagnada)
  {
    id: 'cr_logo_growth_slow',
    tab: 'crescimento',
    severity: 'warn',
    priority: 55,
    match: (i) => i.logoGrowthRate !== undefined && i.logoGrowthRate >= 0 && i.logoGrowthRate < 0.01,
    buildCause: (i) => `Logo Growth Rate = ${fmtPct(i.logoGrowthRate!)} / mês — base cresce muito devagar (meta ≥ 2%)`,
    actionIds: ['funnel_optimization', 'sales_efficiency_audit'],
  },

  // C9 — GRR abaixo do ideal pra crescimento
  {
    id: 'cr_grr_below_growth_target',
    tab: 'crescimento',
    severity: 'warn',
    priority: 50,
    match: (i) => i.grr !== undefined && i.grr >= 0.75 && i.grr < 0.95,
    buildCause: (i) => `GRR = ${fmtPct(i.grr!)} — vazamento estrutural reduz Net New (meta ≥ 95% pra crescer sem fricção)`,
    actionIds: ['audit_cancellations', 'health_score_immediate', 'retention_playbook'],
  },

  // ═══════════ CANCELAMENTOS ═══════════

  // CAN1 — Motivo concentrado (1 motivo > 25% do MRR perdido)
  {
    id: 'canc_motivo_concentrado_crit',
    tab: 'cancelamentos',
    severity: 'crit',
    priority: 100,
    match: (i) => i.motivoConcentradoPct !== undefined && i.motivoConcentradoPct > 0.25,
    buildCause: (i) => `Motivo top concentra ${fmtPct(i.motivoConcentradoPct!)} do MRR perdido — risco binário (resolver 1 problema resolve a maior parte da sangria)`,
    actionIds: ['motivo_root_cause_analysis', 'audit_cancellations', 'retention_playbook'],
  },

  // CAN2 — Segmento crítico (algum segmento churn > 50%)
  {
    id: 'canc_segmento_critico',
    tab: 'cancelamentos',
    severity: 'crit',
    priority: 95,
    match: (i) => i.segmentoChurnMax !== undefined && i.segmentoChurnMax > 0.5,
    buildCause: (i) => `Há segmento com churn rate de ${fmtPct(i.segmentoChurnMax!)} — incêndio focal exige investigação antes de expandir nesse vertical`,
    actionIds: ['segment_drill_down', 'audit_cancellations', 'cs_team_structure'],
  },

  // CAN3 — Tendência subindo crítica (motivo cresceu >1.3× em 6m)
  {
    id: 'canc_tendencia_subindo_crit',
    tab: 'cancelamentos',
    severity: 'crit',
    priority: 90,
    match: (i) => i.tendenciaSubindoFator !== undefined && i.tendenciaSubindoFator > 1.3,
    buildCause: (i) => `Motivo de cancelamento cresceu ${fmtX(i.tendenciaSubindoFator!)} nos últimos 6m vs 6m anteriores — sinal novo, problema emergente`,
    actionIds: ['motivo_root_cause_analysis', 'audit_cancellations', 'nps_survey'],
  },

  // CAN4 — Early Churn elevado (> 20% dos cancelados)
  {
    id: 'canc_early_churn_alto',
    tab: 'cancelamentos',
    severity: 'warn',
    priority: 75,
    match: (i) => i.earlyChurnRate !== undefined && i.earlyChurnRate > 0.2,
    buildCause: (i) => `Early Churn = ${fmtPct(i.earlyChurnRate!)} dos cancelamentos saem em ≤90d — falha estrutural de onboarding ou ICP errado`,
    actionIds: ['early_churn_taskforce', 'onboarding_overhaul', 'segment_drill_down'],
  },

  // CAN5 — Mortalidade alta (> 20% do volume)
  {
    id: 'canc_mortalidade_alta_warn',
    tab: 'cancelamentos',
    severity: 'warn',
    priority: 70,
    match: (i) => i.mortalidadeQtdPct !== undefined && i.mortalidadeQtdPct > 0.2,
    buildCause: (i) => `${fmtPct(i.mortalidadeQtdPct!)} dos cancelamentos são "mortality" (cliente fechou/desuso) — sinal de baixa adoção do produto, não só preço`,
    actionIds: ['mortality_outreach_review', 'nps_survey', 'health_score_immediate'],
  },

  // CAN6 — Win-back zero em base madura (tenant com ≥100 clientes)
  {
    id: 'canc_winback_zero_warn',
    tab: 'cancelamentos',
    severity: 'warn',
    priority: 60,
    match: (i) =>
      i.winbackTotal12m !== undefined && i.winbackTotal12m === 0 &&
      i.clientesAtivos !== undefined && i.clientesAtivos >= 100,
    buildCause: () => `Zero reativações nos últimos 12 meses — sem processo ativo de win-back, cada cliente que sai vira receita perdida permanente`,
    actionIds: ['winback_campaign_launch', 'retention_playbook', 'mortality_outreach_review'],
  },

  // CAN7 — Origem de aquisição com churn perigoso
  {
    id: 'canc_origem_high_churn_crit',
    tab: 'cancelamentos',
    severity: 'crit',
    priority: 88,
    match: (i) => i.origemMaxChurn !== undefined && i.origemMaxChurn >= 0.05,
    buildCause: (i) => `Existe canal de aquisição com churn rate de ${fmtPct(i.origemMaxChurn!)} no período — cliente vem por essa origem e cancela muito acima da média`,
    actionIds: ['segment_drill_down', 'motivo_root_cause_analysis', 'audit_cancellations'],
  },
];
