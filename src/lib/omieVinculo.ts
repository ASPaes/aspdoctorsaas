/**
 * Qual contrato do Omie um contrato do DoctorSaaS representa, lido da `reconciliacao_cadastro`.
 *
 * Existe porque a mesma regra estava copiada em três telas e as três estavam erradas do mesmo
 * jeito: filtravam `estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL`. A detecção só
 * preenche esses dois quando o CNPJ é 1:1 entre DS e Omie (ver
 * `20260807013000_omie_deteccao_por_conta.sql`, o LATERAL com `dsn.c=1 AND omn.c=1`). Quando o
 * mesmo CNPJ tem vários cadastros no Omie o estado é 'AMBIGUO' e o código fica NULL — e é
 * justamente esse contrato que MAIS provavelmente está vinculado, porque ambiguidade se resolve
 * na Conferência, que grava a escolha em `candidato_escolhido`.
 *
 * Resultado do erro: contrato vinculado aparecia como nunca enviado, com o botão convidando a
 * mandar de novo (VALEMAR LTDA, 27/08/2026).
 *
 * `status_usuario` NÃO entra na regra: uma tentativa de usá-lo como prova de vínculo não achou
 * nada, enquanto a Conferência — lendo a mesma tabela sem esse filtro — mostrava o dono na tela ao
 * lado. O sinal é o código preenchido.
 *
 * A verdade absoluta do de/para é `contracts_mapping`, que vive no DoctorOMIE e nenhuma rota
 * expõe ao browser hoje (`ds-omie-vinculos-listar` só devolve vendedores, categorias e produtos).
 * Isto aqui é a melhor cópia disponível no DS, e é a mesma que a Conferência usa para decidir
 * "já vinculado" — o que importa tanto quanto acertar: as telas concordarem entre si.
 */
export type LinhaVinculoOmie = {
  ds_contract_id?: string | null;
  candidato_escolhido?: number | string | null;
  codigo_contrato_omie?: number | string | null;
};

/** O código do contrato Omie desta linha, ou null. Escolha explícita vence a detecção. */
export function codigoContratoOmieDaLinha(linha: LinhaVinculoOmie | null | undefined): number | null {
  if (!linha) return null;
  const codigo = linha.candidato_escolhido ?? linha.codigo_contrato_omie;
  if (codigo == null || String(codigo) === "") return null;
  const n = Number(codigo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mapa ds_contract_id -> código do contrato Omie.
 *
 * A primeira linha COM código vence: tenant com mais de uma conta Omie pode ter o mesmo contrato
 * repetido por conta e só uma das linhas preenchida. Um `map.set` ingênuo deixaria a última
 * sobrescrever com nulo o vínculo que a anterior tinha encontrado.
 */
export function mapaVinculoOmie(linhas: LinhaVinculoOmie[] | null | undefined): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const linha of linhas ?? []) {
    const id = linha?.ds_contract_id;
    if (!id) continue;
    if (mapa.has(String(id))) continue;
    const codigo = codigoContratoOmieDaLinha(linha);
    if (codigo != null) mapa.set(String(id), codigo);
  }
  return mapa;
}
