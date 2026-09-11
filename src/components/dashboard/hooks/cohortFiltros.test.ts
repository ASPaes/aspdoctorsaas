import { describe, it, expect } from 'vitest';
import {
  COHORT_FILTROS_VAZIO,
  contarFiltrosAtivos,
  aplicarFiltrosRpc,
  cohortFiltrosKey,
  FAIXAS_MENSALIDADE,
  type CohortFiltros,
} from './cohortFiltros';

const base = (patch: Partial<CohortFiltros> = {}): CohortFiltros => ({ ...COHORT_FILTROS_VAZIO, ...patch });

describe('aplicarFiltrosRpc', () => {
  it('não escreve nenhuma chave quando não há filtro — a chamada segue idêntica à de antes da feature', () => {
    const params: Record<string, any> = { p_from_month: '2024-09-01' };
    aplicarFiltrosRpc(params, base());
    expect(params).toEqual({ p_from_month: '2024-09-01' });
  });

  it('ignora filtro ausente', () => {
    const params: Record<string, any> = {};
    aplicarFiltrosRpc(params, undefined);
    expect(params).toEqual({});
  });

  // `p_fornecedor_ids` com lista vazia zera o resultado na RPC (o filtro antigo
  // testa IS NULL, e '{}' não é NULL). Nunca mandar lista vazia é o que nos
  // protege dessa armadilha.
  it('nunca manda lista vazia para a RPC', () => {
    const params: Record<string, any> = {};
    aplicarFiltrosRpc(params, base({ segmentoIds: [], produtoIds: [7] }));
    expect(params).toEqual({ p_produto_ids: [7] });
    expect(params).not.toHaveProperty('p_segmento_ids');
  });

  it('mapeia cada filtro para o parâmetro que a RPC espera', () => {
    const params: Record<string, any> = {};
    aplicarFiltrosRpc(params, {
      segmentoIds: [1], areaAtuacaoIds: [2], estadoIds: [3], cidadeIds: [4],
      faixas: ['acima_1k'], funcionarioIds: [5], produtoIds: [6], origemVendaIds: [7],
    });
    expect(params).toEqual({
      p_segmento_ids: [1], p_area_atuacao_ids: [2], p_estado_ids: [3], p_cidade_ids: [4],
      p_faixas: ['acima_1k'], p_funcionario_ids: [5], p_produto_ids: [6], p_origem_venda_ids: [7],
    });
  });

  it('usa os códigos de faixa que a RPC compara, não os rótulos com acento', () => {
    expect(FAIXAS_MENSALIDADE.map(f => f.id)).toEqual(['ate_200', '200_500', '500_1k', 'acima_1k']);
  });
});

describe('contarFiltrosAtivos', () => {
  it('conta um por campo preenchido, não um por item', () => {
    expect(contarFiltrosAtivos(base())).toBe(0);
    expect(contarFiltrosAtivos(base({ estadoIds: [1, 2, 3] }))).toBe(1);
    expect(contarFiltrosAtivos(base({ estadoIds: [1], produtoIds: [2] }))).toBe(2);
  });
});

describe('cohortFiltrosKey', () => {
  it('devolve vazio sem filtro, para não invalidar o cache de quem já estava na tela', () => {
    expect(cohortFiltrosKey(base())).toBe('');
    expect(cohortFiltrosKey(undefined)).toBe('');
  });

  it('muda quando o filtro muda e se repete para o mesmo filtro', () => {
    const a = cohortFiltrosKey(base({ produtoIds: [5] }));
    expect(a).not.toBe('');
    expect(cohortFiltrosKey(base({ produtoIds: [5] }))).toBe(a);
    expect(cohortFiltrosKey(base({ produtoIds: [6] }))).not.toBe(a);
  });

  it('separa filtros diferentes que usam o mesmo id', () => {
    expect(cohortFiltrosKey(base({ produtoIds: [5] }))).not.toBe(cohortFiltrosKey(base({ segmentoIds: [5] })));
  });
});
