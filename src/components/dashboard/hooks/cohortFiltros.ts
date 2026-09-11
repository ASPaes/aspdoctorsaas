/**
 * Filtros da aba Cohort — fonte única do tipo, dos rótulos e da tradução para
 * os parâmetros das RPCs (`fn_cohort_revenue`, `fn_cohort_saldo_forecast`).
 *
 * Regra das RPCs: parâmetro ausente, NULL ou array vazio = sem filtro. Por isso
 * `toRpcParams` só escreve a chave quando há item selecionado — assim a chamada
 * sem filtro continua byte a byte igual à de antes desta feature.
 *
 * Vendedor, produto e origem vêm de `cliente_produtos` (fonte de verdade), não
 * das colunas homônimas de `clientes`, que são legado.
 */

/** Faixas de mensalidade. Os códigos são os mesmos que a RPC compara — não
 *  traduzir por rótulo, que tem acento e travessão. */
export const FAIXAS_MENSALIDADE = [
  { id: 'ate_200', nome: 'Até R$ 200' },
  { id: '200_500', nome: 'R$ 200 – 500' },
  { id: '500_1k', nome: 'R$ 500 – 1k' },
  { id: 'acima_1k', nome: 'Acima de R$ 1k' },
] as const;

export type FaixaMensalidade = (typeof FAIXAS_MENSALIDADE)[number]['id'];

export interface CohortFiltros {
  segmentoIds: number[];
  areaAtuacaoIds: number[];
  estadoIds: number[];
  cidadeIds: number[];
  faixas: FaixaMensalidade[];
  funcionarioIds: number[];
  produtoIds: number[];
  origemVendaIds: number[];
}

export const COHORT_FILTROS_VAZIO: CohortFiltros = {
  segmentoIds: [],
  areaAtuacaoIds: [],
  estadoIds: [],
  cidadeIds: [],
  faixas: [],
  funcionarioIds: [],
  produtoIds: [],
  origemVendaIds: [],
};

/** Quantos filtros estão ativos — alimenta o badge da barra. */
export function contarFiltrosAtivos(f?: CohortFiltros): number {
  if (!f) return 0;
  return Object.values(f).filter(v => Array.isArray(v) && v.length > 0).length;
}

/** Escreve os parâmetros da RPC. Só entra chave de filtro com seleção. */
export function aplicarFiltrosRpc(rpcParams: Record<string, any>, f?: CohortFiltros): void {
  if (!f) return;
  if (f.segmentoIds.length) rpcParams.p_segmento_ids = f.segmentoIds;
  if (f.areaAtuacaoIds.length) rpcParams.p_area_atuacao_ids = f.areaAtuacaoIds;
  if (f.estadoIds.length) rpcParams.p_estado_ids = f.estadoIds;
  if (f.cidadeIds.length) rpcParams.p_cidade_ids = f.cidadeIds;
  if (f.faixas.length) rpcParams.p_faixas = f.faixas;
  if (f.funcionarioIds.length) rpcParams.p_funcionario_ids = f.funcionarioIds;
  if (f.produtoIds.length) rpcParams.p_produto_ids = f.produtoIds;
  if (f.origemVendaIds.length) rpcParams.p_origem_venda_ids = f.origemVendaIds;
}

/** Pedaço estável de queryKey. Sem filtro devolve '' — não invalida cache antigo. */
export function cohortFiltrosKey(f?: CohortFiltros): string {
  if (!f || contarFiltrosAtivos(f) === 0) return '';
  return JSON.stringify([
    f.segmentoIds, f.areaAtuacaoIds, f.estadoIds, f.cidadeIds,
    f.faixas, f.funcionarioIds, f.produtoIds, f.origemVendaIds,
  ]);
}
