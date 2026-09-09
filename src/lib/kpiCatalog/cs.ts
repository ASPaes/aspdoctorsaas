import type { CatalogEntry } from "./types";

/** Levantado em 09/09/2026 em src/components/dashboard/tabs/CSTab.tsx e
 *  src/components/cs/CSDashboard.tsx. Fonte única: `useCSDashboardData`
 *  (provider `cs.dashboard`).
 *
 *  CUSTO DO HOOK, medido para a decisão de carga preguiçosa da F3:
 *  `useCSDashboardData` faz 4 consultas — 3 paginadas com `fetchAllRows`
 *  (`cs_tickets`, `clientes`, `fornecedores`) e 1 direta (`funcionarios`) —
 *  e deriva todo o resto em memória. Fica entre o Atendimento (1 RPC) e o
 *  Financeiro (~20 varreduras), mais perto do primeiro. A carga preguiçosa
 *  por seção resolve; não precisa de mitigação própria.
 *
 *  A CSTab usa um card próprio (`KPICard`, com `title=` em vez de `label=`),
 *  não o `KPICardEnhanced`. No painel tudo é desenhado com o
 *  `KPICardEnhanced` — os rótulos abaixo são os títulos como estão na tela.
 *
 *  Vários cards somam duas listas na hora de exibir (Vencendo SLA = ação +
 *  conclusão). Pela §5.0 da spec o painel refaz a soma; o `path` aponta a
 *  primeira parcela.
 *
 *  Os 12 gráficos (7 na CSTab, 5 no CSDashboard) estão escritos dentro das
 *  telas: entram `pending`, para ganhar componente próprio do painel.
 */
export const cs: CatalogEntry[] = [
  // ---------- Tickets ----------
  {
    id: "cs.tickets_abertos",
    area: "cs",
    kind: "card",
    label: "Tickets Abertos",
    helpKey: "cs_tickets_abertos",
    format: "integer",
    source: { provider: "cs.dashboard", path: "ticketsAbertos" },
  },
  {
    id: "cs.tickets_fechados",
    area: "cs",
    kind: "card",
    label: "Tickets Concluídos",
    helpKey: "cs_tickets_fechados",
    format: "integer",
    source: { provider: "cs.dashboard", path: "ticketsFechados" },
  },
  /** Soma vencendoSlaAcao + vencendoSlaConclusao no componente. */
  {
    id: "cs.vencendo_sla",
    area: "cs",
    kind: "card",
    label: "Vencendo SLA",
    helpKey: "cs_vencendo_sla",
    format: "integer",
    source: { provider: "cs.dashboard", path: "vencendoSlaAcao" },
  },
  {
    id: "cs.vencidos_sla",
    area: "cs",
    kind: "card",
    label: "Vencidos SLA",
    helpKey: "cs_vencidos_sla",
    format: "integer",
    source: { provider: "cs.dashboard", path: "vencidosSlaAcao" },
  },
  {
    id: "cs.reaberturas",
    area: "cs",
    kind: "card",
    label: "Reaberturas",
    format: "integer",
    source: { provider: "cs.dashboard", path: "reaberturas" },
  },
  {
    id: "cs.percent_higiene",
    area: "cs",
    kind: "card",
    label: "% Higiene",
    helpKey: "cs_percent_higiene",
    format: "percent",
    source: { provider: "cs.dashboard", path: "percentHigiene" },
  },
  {
    id: "cs.tempo_ate_acao",
    area: "cs",
    kind: "card",
    label: "Tempo até a 1ª ação",
    format: "duration",
    source: { provider: "cs.dashboard", path: "tempoAteAcaoMediana" },
  },
  {
    id: "cs.tempo_ate_conclusao",
    area: "cs",
    kind: "card",
    label: "Tempo até a conclusão",
    format: "duration",
    source: { provider: "cs.dashboard", path: "tempoAteConclusaoMediana" },
  },
  {
    id: "cs.backlog_por_status",
    area: "cs",
    kind: "chart",
    label: "Tickets por situação",
    format: "integer",
    source: { provider: "cs.dashboard", path: "backlogPorStatus" },
    pending: true,
  },
  {
    id: "cs.backlog_por_prioridade",
    area: "cs",
    kind: "chart",
    label: "Tickets por prioridade",
    format: "integer",
    source: { provider: "cs.dashboard", path: "backlogPorPrioridade" },
    pending: true,
  },

  // ---------- Risco ----------
  {
    id: "cs.clientes_em_risco",
    area: "cs",
    kind: "card",
    label: "Clientes em Risco",
    helpKey: "cs_clientes_em_risco",
    format: "integer",
    source: { provider: "cs.dashboard", path: "clientesEmRisco" },
  },
  {
    id: "cs.mrr_em_risco",
    area: "cs",
    kind: "card",
    label: "MRR em Risco",
    helpKey: "cs_mrr_em_risco",
    format: "currency",
    source: { provider: "cs.dashboard", path: "mrrEmRisco" },
  },
  {
    id: "cs.mrr_recuperado",
    area: "cs",
    kind: "card",
    label: "MRR Recuperado",
    helpKey: "cs_mrr_recuperado",
    format: "currency",
    source: { provider: "cs.dashboard", path: "mrrRecuperado" },
  },
  {
    id: "cs.risco_com_plano",
    area: "cs",
    kind: "card",
    label: "% de risco com plano de ação",
    format: "percent",
    source: { provider: "cs.dashboard", path: "percentRiscoComPlano" },
  },
  {
    id: "cs.resultado_risco",
    area: "cs",
    kind: "chart",
    label: "Desfecho dos clientes em risco",
    format: "integer",
    source: { provider: "cs.dashboard", path: "resultadoRisco" },
    pending: true,
  },

  // ---------- Cobertura de relacionamento 90d ----------
  {
    id: "cs.cobertura_ativos",
    area: "cs",
    kind: "card",
    label: "Clientes Ativos",
    helpKey: "clientes_ativos",
    format: "integer",
    source: { provider: "cs.dashboard", path: "cobertura90d.totalAtivos" },
  },
  {
    id: "cs.cobertura_90d",
    area: "cs",
    kind: "card",
    label: "% Cobertura 90D",
    helpKey: "cs_cobertura_90d",
    format: "percent",
    source: { provider: "cs.dashboard", path: "cobertura90d.percentCoberto" },
  },
  {
    id: "cs.descobertos",
    area: "cs",
    kind: "card",
    label: "Descobertos",
    helpKey: "cs_descobertos",
    format: "integer",
    source: { provider: "cs.dashboard", path: "cobertura90d.descobertos" },
  },

  // ---------- Indicações ----------
  {
    id: "cs.indicacoes_ganhas",
    area: "cs",
    kind: "card",
    label: "Indicações ganhas",
    format: "integer",
    source: { provider: "cs.dashboard", path: "indicacoesGanhas" },
  },
  {
    id: "cs.indicacoes_perdidas",
    area: "cs",
    kind: "card",
    label: "Indicações perdidas",
    format: "integer",
    source: { provider: "cs.dashboard", path: "indicacoesPerdidas" },
  },
  {
    id: "cs.indicacoes_conversao",
    area: "cs",
    kind: "card",
    label: "Conversão das indicações",
    format: "percent",
    source: { provider: "cs.dashboard", path: "indicacoesConversaoPercent" },
  },
  {
    id: "cs.pipeline_indicacao",
    area: "cs",
    kind: "chart",
    label: "Funil de indicações",
    format: "integer",
    source: { provider: "cs.dashboard", path: "pipelineIndicacao" },
    pending: true,
  },

  // ---------- Oportunidades ----------
  {
    id: "cs.oportunidades_abertas",
    area: "cs",
    kind: "card",
    label: "Oportunidades abertas",
    format: "integer",
    source: { provider: "cs.dashboard", path: "oportunidadesAbertas" },
  },
  {
    id: "cs.oportunidades_ganhas",
    area: "cs",
    kind: "card",
    label: "Oportunidades ganhas",
    format: "integer",
    source: { provider: "cs.dashboard", path: "oportunidadesGanhas" },
  },
  {
    id: "cs.oportunidades_conversao",
    area: "cs",
    kind: "card",
    label: "Conversão das oportunidades",
    format: "percent",
    source: { provider: "cs.dashboard", path: "oportunidadesConversaoPercent" },
  },
  {
    id: "cs.oportunidades_mrr_previsto",
    area: "cs",
    kind: "card",
    label: "MRR previsto em oportunidades",
    format: "currency",
    source: { provider: "cs.dashboard", path: "oportunidadesValorPrevistoMrr" },
  },
  {
    id: "cs.oportunidades_mrr_ganho",
    area: "cs",
    kind: "card",
    label: "MRR ganho em oportunidades",
    format: "currency",
    source: { provider: "cs.dashboard", path: "oportunidadesValorGanhoMrr" },
  },
];
