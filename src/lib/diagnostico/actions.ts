import type { ActionTemplate } from './types';

export const ACTIONS: Record<string, ActionTemplate> = {
  // ── Críticas: esta semana ──
  audit_cancellations: {
    id: 'audit_cancellations',
    text: 'Auditar os contratos cancelados no período — identificar causa-raiz comum (preço, produto, atendimento, competitor)',
    priority: 'critical',
    timeframe: 'esta semana',
  },
  health_score_immediate: {
    id: 'health_score_immediate',
    text: 'Implementar health scoring básico nos top 20 clientes — alertas antes de cancelamento',
    priority: 'critical',
    timeframe: 'esta semana',
  },
  freeze_cac_spend: {
    id: 'freeze_cac_spend',
    text: 'Pausar investimento em aquisição até resolver eficiência — cada novo cliente queima caixa',
    priority: 'critical',
    timeframe: 'esta semana',
  },

  // ── Altas: 30 dias ──
  upsell_playbook: {
    id: 'upsell_playbook',
    text: 'Criar playbook de upsell na base ativa — mapear módulos premium e oportunidades de cross-sell por tier de cliente',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },
  funnel_optimization: {
    id: 'funnel_optimization',
    text: 'Otimizar funil de aquisição: revisar conversão por etapa, cortar canais com CPL alto',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },
  cogs_renegotiation: {
    id: 'cogs_renegotiation',
    text: 'Renegociar contratos com fornecedores principais — reduzir COGS para aumentar MC%',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },
  nps_survey: {
    id: 'nps_survey',
    text: 'Disparar pesquisa NPS trimestral para identificar detratores antes que cancelem',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },
  pricing_review: {
    id: 'pricing_review',
    text: 'Revisão de pricing: aumentar ARPA em segmentos premium ou packaging em tiers',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },

  // ── Estratégicas: 90 dias ──
  diversify_portfolio: {
    id: 'diversify_portfolio',
    text: 'Diversificar carteira — definir teto de % por cliente individual e plano de aquisição em segmentos novos',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
  loyalty_program: {
    id: 'loyalty_program',
    text: 'Programa de fidelização com benefícios escalonados por tempo de casa — aumentar tenure médio',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
  cs_team_structure: {
    id: 'cs_team_structure',
    text: 'Estruturar time de Customer Success com account managers dedicados para clientes acima de threshold',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
  onboarding_overhaul: {
    id: 'onboarding_overhaul',
    text: 'Reformular onboarding dos primeiros 90 dias — reduzir Early Churn estruturalmente',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
  retention_playbook: {
    id: 'retention_playbook',
    text: 'Playbook formal de retenção — ofertas personalizadas, win-back automation, account managers dedicados',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },

  // ── Crescimento V2 — Altas: 30 dias ──
  sales_efficiency_audit: {
    id: 'sales_efficiency_audit',
    text: 'Auditar eficiência da máquina de vendas — produtividade individual de SDRs/closers, conversão por etapa do funil, tempo médio de ciclo de venda',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },

  // ── Crescimento V2 — Estratégicas: 90 dias ──
  expansion_program_launch: {
    id: 'expansion_program_launch',
    text: 'Lançar programa estruturado de expansão na base — playbook de upsell por aniversário de contrato + cross-sell por gatilho de uso + reajuste anual indexado',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
  growth_strategy_review: {
    id: 'growth_strategy_review',
    text: 'Revisar estratégia de crescimento de longo prazo — definir ICP claro, mapear novos canais, expandir TAM para novos segmentos/geografias',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },

  // ── Cancelamentos V2 — Críticas: esta semana ──
  motivo_root_cause_analysis: {
    id: 'motivo_root_cause_analysis',
    text: 'Investigar causa raiz do motivo top — entrevistar 5 a 10 clientes cancelados nos últimos 60 dias, mapear padrões antes de propor solução',
    priority: 'critical',
    timeframe: 'esta semana',
  },
  segment_drill_down: {
    id: 'segment_drill_down',
    text: 'Drill down no segmento crítico — validar com vendas e CS se o ICP daquele vertical mudou ou se está sendo vendido pra perfil errado',
    priority: 'critical',
    timeframe: 'esta semana',
  },

  // ── Cancelamentos V2 — Altas: 30 dias ──
  winback_campaign_launch: {
    id: 'winback_campaign_launch',
    text: 'Lançar campanha de win-back nos cancelados voluntary entre 90-180 dias — começar pelos de maior ticket, oferta com desconto/melhoria condicionada',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },
  early_churn_taskforce: {
    id: 'early_churn_taskforce',
    text: 'Taskforce de Early Churn — meta de reduzir cancelamentos ≤90d em 50% no próximo trimestre via onboarding ativo + check-ins semanais',
    priority: 'high',
    timeframe: 'próximos 30 dias',
  },

  // ── Cancelamentos V2 — Estratégicas: 90 dias ──
  mortality_outreach_review: {
    id: 'mortality_outreach_review',
    text: 'Revisar comunicação com clientes inativos por 60+ dias — muitos "morrem" por desuso silencioso, não por falência. Reengajar antes do cancelamento',
    priority: 'strategic',
    timeframe: 'próximos 90 dias',
  },
};
