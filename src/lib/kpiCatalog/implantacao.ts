import type { CatalogEntry } from "./types";

/** Levantado em 09/09/2026 em src/pages/onboarding/: OnboardingDashboardPage,
 *  SituacaoAgoraBand, TempoDeEntregaSection e OnboardingSlaOverview.
 *
 *  FILTROS REAIS DA ÁREA, conferidos em `dashFilters.ts` e
 *  `useOnboardingDashFilters.ts`: pipeline, responsável, participante e tipo
 *  de demanda — mais período e a unidade global. A spec supunha "jornada";
 *  está errado, jornada não é filtro.
 *
 *  Os números não vêm de um hook único: a página busca as jornadas e passa
 *  por funções puras de `dashMetrics.ts` (`contarSituacao`, `agregarTreinos`,
 *  `mediaTempo`). O provider `implantacao.dash` da F3 tem que devolver o
 *  resultado dessas funções — que é justamente o que a página já monta.
 *
 *  Nenhum verbete no kpiHelp cobre esta área: os cards de Implantação usam
 *  `KpiCard` próprio, sem `helpKey`. Todos os itens abaixo entram sem texto
 *  de ajuda e vão aparecer na lista "sem texto de ajuda" do relatório.
 */
export const implantacao: CatalogEntry[] = [
  // ---------- Situação agora ----------
  {
    id: "imp.jornadas_em_aberto",
    area: "implantacao",
    kind: "card",
    label: "Jornadas em aberto",
    format: "integer",
    source: { provider: "implantacao.dash", path: "situacao.emAberto" },
  },
  {
    id: "imp.jornadas_concluidas",
    area: "implantacao",
    kind: "card",
    label: "Jornadas concluídas",
    format: "integer",
    source: { provider: "implantacao.dash", path: "situacao.concluidas" },
  },
  {
    id: "imp.jornadas_canceladas",
    area: "implantacao",
    kind: "card",
    label: "Jornadas canceladas",
    format: "integer",
    source: { provider: "implantacao.dash", path: "situacao.canceladas" },
  },
  {
    id: "imp.jornadas_paradas",
    area: "implantacao",
    kind: "card",
    label: "Jornadas paradas",
    format: "integer",
    source: { provider: "implantacao.dash", path: "situacao.paradas" },
  },
  {
    id: "imp.jornadas_nao_iniciadas",
    area: "implantacao",
    kind: "card",
    label: "Jornadas não iniciadas",
    format: "integer",
    source: { provider: "implantacao.dash", path: "situacao.naoIniciadas" },
  },

  // ---------- Tempo de entrega ----------
  {
    id: "imp.tempo_total",
    area: "implantacao",
    kind: "card",
    label: "Tempo total",
    format: "duration",
    source: { provider: "implantacao.dash", path: "tempos.total" },
  },
  {
    id: "imp.tempo_onboarding",
    area: "implantacao",
    kind: "card",
    label: "Tempo de onboarding",
    format: "duration",
    source: { provider: "implantacao.dash", path: "tempos.onboarding" },
  },
  {
    id: "imp.tempo_implantacao",
    area: "implantacao",
    kind: "card",
    label: "Tempo de implantação",
    format: "duration",
    source: { provider: "implantacao.dash", path: "tempos.implantacao" },
  },
  {
    id: "imp.primeiro_contato",
    area: "implantacao",
    kind: "card",
    label: "1º contato com o cliente",
    format: "duration",
    source: { provider: "implantacao.dash", path: "tempos.primeiroContato" },
  },

  // ---------- SLA ----------
  {
    id: "imp.sla_no_prazo_bruto",
    area: "implantacao",
    kind: "card",
    label: "No prazo · bruto",
    format: "percent",
    source: { provider: "implantacao.dash", path: "sla.pctC" },
  },
  /** A régua que o owner usa: desconta o tempo parado e conta só expediente. */
  {
    id: "imp.sla_no_prazo_efetivo",
    area: "implantacao",
    kind: "card",
    label: "No prazo · efetivo",
    format: "percent",
    source: { provider: "implantacao.dash", path: "sla.pctE" },
  },
  {
    id: "imp.sla_tempo_parado",
    area: "implantacao",
    kind: "card",
    label: "Tempo parado",
    format: "duration",
    source: { provider: "implantacao.dash", path: "sla.parado" },
  },
  {
    id: "imp.sla_ciclo_efetivo",
    area: "implantacao",
    kind: "card",
    label: "Ciclo médio · efetivo",
    format: "duration",
    source: { provider: "implantacao.dash", path: "sla.cicloE" },
  },

  // ---------- Treinos ----------
  {
    id: "imp.treinos_realizados",
    area: "implantacao",
    kind: "card",
    label: "Treinos realizados",
    format: "integer",
    source: { provider: "implantacao.dash", path: "treinos.realizado" },
  },
  {
    id: "imp.treinos_pct_realizado",
    area: "implantacao",
    kind: "card",
    label: "% Realizado",
    format: "percent",
    source: { provider: "implantacao.dash", path: "treinos.realizadoPct" },
  },
  {
    id: "imp.treinos_faltas",
    area: "implantacao",
    kind: "card",
    label: "Faltas",
    format: "integer",
    source: { provider: "implantacao.dash", path: "treinos.faltas" },
  },
  {
    id: "imp.treinos_no_show",
    area: "implantacao",
    kind: "card",
    label: "Taxa de no-show",
    format: "percent",
    source: { provider: "implantacao.dash", path: "treinos.noShowRate" },
  },
  {
    id: "imp.treinos_retreinamento",
    area: "implantacao",
    kind: "card",
    label: "% Retreinamento",
    format: "percent",
    source: { provider: "implantacao.dash", path: "treinos.retreinosPct" },
  },
  {
    id: "imp.treinos_proprietario",
    area: "implantacao",
    kind: "card",
    label: "Proprietário presente",
    format: "percent",
    source: { provider: "implantacao.dash", path: "treinos.propPct" },
  },
  {
    id: "imp.pdv_finalizados",
    area: "implantacao",
    kind: "card",
    label: "Total PDV finalizados",
    format: "integer",
    source: { provider: "implantacao.dash", path: "treinos.pdvFinalizados" },
  },

  // ---------- Retornos ----------
  {
    id: "imp.retornos_total",
    area: "implantacao",
    kind: "card",
    label: "Total de retornos",
    format: "integer",
    source: { provider: "implantacao.dash", path: "retornos.total" },
  },
  {
    id: "imp.retornos_vendedor",
    area: "implantacao",
    kind: "card",
    label: "Atribuíveis ao vendedor",
    format: "integer",
    source: { provider: "implantacao.dash", path: "retornos.atribuiveisVendedor" },
  },
  {
    id: "imp.retornos_em_aberto",
    area: "implantacao",
    kind: "card",
    label: "Retornos em aberto",
    format: "integer",
    source: { provider: "implantacao.dash", path: "retornos.emAberto" },
  },

  // ---------- Gráficos ----------
  {
    id: "imp.jornadas_por_etapa",
    area: "implantacao",
    kind: "chart",
    label: "Jornadas por etapa",
    format: "integer",
    source: { provider: "implantacao.dash", path: "porEtapa" },
    pending: true,
  },
  {
    id: "imp.sla_por_etapa",
    area: "implantacao",
    kind: "chart",
    label: "Cumprimento de SLA por etapa",
    format: "percent",
    source: { provider: "implantacao.dash", path: "sla.porEtapa" },
    pending: true,
  },
  {
    id: "imp.por_responsavel",
    area: "implantacao",
    kind: "chart",
    label: "Jornadas por responsável",
    format: "integer",
    source: { provider: "implantacao.dash", path: "porResponsavel" },
    pending: true,
  },
];
