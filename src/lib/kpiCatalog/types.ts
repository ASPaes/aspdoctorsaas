import type { KpiUnit } from "@/lib/kpiHelp";

export type KpiArea = "atendimento" | "financeiro" | "cs" | "implantacao" | "certificados";
export type KpiKind = "card" | "chart";
/** `text` existe porque nem todo indicador é número: "Ofensor #1" mostra o
 *  nome do cliente que mais abriu chamado. */
export type KpiFormat =
  | "currency" | "percent" | "integer" | "decimal" | "duration" | "ratio" | "text";

/** Prefixo obrigatório do id, por área. Mantém o id legível e evita colisão
 *  entre áreas que têm indicador de mesmo nome (ex: "clientes ativos"). */
export const PREFIXO_AREA: Record<KpiArea, string> = {
  atendimento: "at.",
  financeiro: "fin.",
  cs: "cs.",
  implantacao: "imp.",
  certificados: "cert.",
};

/** Um provider = um bloco de dados que um hook existente já devolve pronto.
 *  A implementação vem na F3; aqui é só o contrato, para o catálogo não
 *  poder apontar para lugar nenhum. */
export const PROVIDERS = [
  "atendimento.volume",
  "atendimento.velocidade",
  /** Gráficos que buscam os próprios dados, em vez de ler um bloco pronto:
   *  VelocidadeTimeline e LatenciaHistograma têm hook próprio. Nesses o
   *  `path` é "self" — não existe campo a extrair. */
  "atendimento.velocidade_timeline",
  "atendimento.latencia",
  "atendimento.backlog",
  "atendimento.agentes",
  "atendimento.satisfacao",
  "atendimento.cobertura",
  "atendimento.ura",
  "atendimento.taxonomia",
  "atendimento.clientes",
  "atendimento.tempo_real",
  "financeiro.dashboard",
  "financeiro.visao_geral",
  "financeiro.crescimento",
  "financeiro.cancelamentos",
  "financeiro.cohort",
  "cs.dashboard",
  "implantacao.dash",
  "certificados.a1",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export interface CatalogEntry {
  /** Identificador estável. NUNCA muda: painéis salvos guardam ids. */
  id: string;
  area: KpiArea;
  kind: KpiKind;
  /** Rótulo exibido. Espelha o texto que já aparece no dashboard de origem. */
  label: string;
  /** Chave em kpiHelp para o popover "?". Ausente = indicador sem verbete. */
  helpKey?: string;
  unit?: KpiUnit;
  format: KpiFormat;
  /** De onde o valor sai: qual bloco de dados e qual campo dentro dele. */
  source: { provider: ProviderId; path: string };
  /** Só para gráfico: largura em colunas da grade de 4. */
  span?: 2 | 3 | 4;
  /** Só para gráfico: nome do componente que desenha. */
  render?: string;
  /** Só para gráfico: como transformar o dado cru em barras ou linha.
   *  `lista` = array de objetos; `mapa` = objeto {chave: número}. */
  chart?: {
    tipo: "barras" | "linha";
    fonte: "lista" | "mapa";
    /** Campo do rótulo, quando `fonte: "lista"`. */
    rotulo?: string;
    /** Campo do valor, quando `fonte: "lista"`. */
    valor?: string;
    /** Quantas barras no máximo; o resto é cortado. Default 8. */
    limite?: number;
  };
  /** Gráfico ainda escrito dentro da aba de origem. Aparece apagado no
   *  catálogo e não é selecionável. Sai na F5. */
  pending?: true;
}
