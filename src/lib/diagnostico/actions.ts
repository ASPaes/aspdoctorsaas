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
};
