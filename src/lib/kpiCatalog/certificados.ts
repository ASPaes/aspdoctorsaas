import type { CatalogEntry } from "./types";

/** Levantado em 09/09/2026. Existem DUAS telas de Certificado A1, com campos
 *  diferentes:
 *
 *  1. O bloco dentro da aba Visão Geral do Dashboard, alimentado por
 *     `useCertA1Data` — 6 campos, todos com verbete no kpiHelp. É este que o
 *     catálogo usa (provider `certificados.a1`).
 *  2. A tela própria `CertA1Dashboard.tsx`, com outro conjunto
 *     (`perdidoQtd`, `vencendo30`, `vencidos20`, `semData`) e NENHUM
 *     `helpKey`. Ficou fora: replicar o segundo conjunto exigiria decidir
 *     qual das duas réguas vale, e as duas telas continuam intocadas (§5.0).
 *     Decisão pendente do owner.
 *
 *  Filtro da área: período. A tela própria tem o seu `DateRangePicker`; o
 *  bloco do Dashboard segue o período global da página.
 */
export const certificados: CatalogEntry[] = [
  {
    id: "cert.vendas_periodo",
    area: "certificados",
    kind: "card",
    label: "Vendas no Período",
    helpKey: "cert_vendas_periodo",
    format: "integer",
    source: { provider: "certificados.a1", path: "vendasQtd" },
  },
  {
    id: "cert.faturamento",
    area: "certificados",
    kind: "card",
    label: "Faturamento A1",
    helpKey: "cert_faturamento_a1",
    format: "currency",
    source: { provider: "certificados.a1", path: "faturamento" },
  },
  {
    id: "cert.perdido_terceiro",
    area: "certificados",
    kind: "card",
    label: "Perdido p/ Terceiro",
    helpKey: "cert_perdido_terceiro",
    format: "integer",
    source: { provider: "certificados.a1", path: "perdidoTerceiroQtd" },
  },
  /** As três de oportunidade são calculadas SEMPRE a partir de hoje, não do
   *  período do filtro — é assim na tela de origem, e o subtítulo lá diz
   *  "Baseado em hoje". O painel tem que repetir esse aviso. */
  {
    id: "cert.oportunidades_janela",
    area: "certificados",
    kind: "card",
    label: "Oportunidades (Janela)",
    helpKey: "cert_oportunidades_janela",
    format: "integer",
    source: { provider: "certificados.a1", path: "oportunidadesJanela" },
  },
  {
    id: "cert.vencendo_30d",
    area: "certificados",
    kind: "card",
    label: "Vencendo em 30 dias",
    helpKey: "cert_vencendo_30d",
    format: "integer",
    source: { provider: "certificados.a1", path: "oportunidadesVencendo" },
  },
  {
    id: "cert.vencidos_20d",
    area: "certificados",
    kind: "card",
    label: "Vencidos até 20 dias",
    helpKey: "cert_vencidos_20d",
    format: "integer",
    source: { provider: "certificados.a1", path: "oportunidadesVencidas" },
  },
];
