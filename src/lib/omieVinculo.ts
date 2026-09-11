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
 * `status_usuario` ENTRA na regra desde 11/09/2026. Antes o sinal era só o código preenchido, e isso
 * mentia: a detecção grava `codigo_contrato_omie` assim que casa o CNPJ, antes de alguém vincular.
 * Medido contra o `contracts_mapping` do DoctorOMIE nas duas contas da Digi Office:
 *   - `vinculado` / `resolvido` com código: 173 de 173 têm de/para (93 DigiUp + amostra de 80).
 *   - `novo` com código: 0 de 43 têm de/para.
 * Os 43 apareciam como "Sincronizado com o Omie" e a fila nunca alcançava nenhum deles. Foi assim
 * que SAMIRA VARGAS e N.S. EVENTOS ficaram presos em "este contrato ainda não existe no Omie" com o
 * selo verde na tela do cliente. `resolvido` é o estado da escolha de candidato (VALEMAR), então o
 * caso que originou esta regra continua coberto.
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
  /** Precisa vir no select: sem ele nenhuma linha conta como vinculada. */
  status_usuario?: string | null;
};

// Estados em que o de/para existe no DoctorOMIE. A medição está no cabeçalho.
const STATUS_COM_VINCULO = new Set(["vinculado", "resolvido"]);

function codigoNumerico(codigo: number | string | null | undefined): number | null {
  if (codigo == null || String(codigo) === "") return null;
  const n = Number(codigo);
  return Number.isFinite(n) ? n : null;
}

/** O código do contrato Omie desta linha quando o vínculo foi GRAVADO, ou null. Escolha explícita vence a detecção. */
export function codigoContratoOmieDaLinha(linha: LinhaVinculoOmie | null | undefined): number | null {
  if (!linha || !STATUS_COM_VINCULO.has(String(linha.status_usuario ?? ""))) return null;
  return codigoNumerico(linha.candidato_escolhido ?? linha.codigo_contrato_omie);
}

/** O código que a detecção achou pelo CNPJ quando o vínculo ainda NÃO foi gravado. Só informa. */
export function codigoContratoOmieSemVinculo(linha: LinhaVinculoOmie | null | undefined): number | null {
  if (!linha || STATUS_COM_VINCULO.has(String(linha.status_usuario ?? ""))) return null;
  return codigoNumerico(linha.codigo_contrato_omie);
}

/**
 * Mapa ds_contract_id -> código Omie achado pela detecção, só para contratos SEM vínculo gravado.
 * Contrato vinculado em qualquer uma das linhas (tenant com duas contas) fica de fora.
 */
export function mapaSemVinculoOmie(linhas: LinhaVinculoOmie[] | null | undefined): Map<string, number> {
  const vinculados = mapaVinculoOmie(linhas);
  const mapa = new Map<string, number>();
  for (const linha of linhas ?? []) {
    const id = linha?.ds_contract_id;
    if (!id || vinculados.has(String(id)) || mapa.has(String(id))) continue;
    const codigo = codigoContratoOmieSemVinculo(linha);
    if (codigo != null) mapa.set(String(id), codigo);
  }
  return mapa;
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
