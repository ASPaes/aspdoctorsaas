/**
 * Atualização de clientes já existentes na importação (opção "Atualizar").
 *
 * O payload da importação é montado sempre com TODAS as colunas de `clientes`.
 * Coluna que não veio no arquivo vira `null` (ou um derivado como `cancelado:
 * false`). Mandar esse objeto inteiro num `.update()` apaga tudo que não estava
 * na planilha — por isso o modo `complementar` só grava o campo quando a COLUNA
 * DE ORIGEM veio preenchida no arquivo.
 */

export type DuplicataUpdateMode = 'complementar' | 'sobrescrever';

/**
 * Coluna gravada em `clientes` → colunas do arquivo que a alimentam.
 *
 * Campos derivados apontam para a origem real: `unidade_base_id` vem da coluna
 * de texto `unidade_base`; `estado_id`/`cidade_id` vêm do CEP (ViaCEP) ou, no
 * fallback, das colunas `estado`/`cidade`.
 *
 * `tenant_id` e `cnpj` ficam fora de propósito: um é do tenant, o outro é a
 * chave usada no `.eq()` da própria atualização.
 */
export const CLIENTE_UPDATE_SOURCE_COLUMNS: Record<string, string[]> = {
  razao_social: ['razao_social'],
  nome_fantasia: ['nome_fantasia'],
  email: ['email'],
  telefone_whatsapp: ['telefone_whatsapp'],
  telefone_whatsapp_contato: ['telefone_whatsapp_contato'],
  telefone_contato: ['telefone_contato'],
  data_cadastro: ['data_cadastro'],
  observacao_cliente: ['observacao_cliente'],

  cep: ['cep'],
  estado_id: ['cep', 'estado'],
  cidade_id: ['cep', 'cidade'],
  endereco: ['endereco'],
  numero: ['numero'],
  bairro: ['bairro'],
  complemento: ['complemento'],

  contato_nome: ['contato_nome'],
  contato_cpf: ['contato_cpf'],
  contato_fone: ['contato_fone'],
  contato_aniversario: ['contato_aniversario'],

  data_venda: ['data_venda'],
  data_reajuste: ['data_reajuste'],
  data_ativacao: ['data_ativacao'],
  mensalidade: ['mensalidade'],
  valor_ativacao: ['valor_ativacao'],
  dia_vencimento_mrr: ['dia_vencimento_mrr'],
  custo_operacao: ['custo_operacao'],
  imposto_percentual: ['imposto_percentual'],
  custo_fixo_percentual: ['custo_fixo_percentual'],
  observacao_negociacao: ['observacao_negociacao'],

  cancelado: ['cancelado'],
  data_cancelamento: ['data_cancelamento'],
  motivo_cancelamento_id: ['motivo_cancelamento'],
  observacao_cancelamento: ['observacao_cancelamento'],

  cert_a1_vencimento: ['cert_a1_vencimento'],
  cert_a1_ultima_venda_em: ['cert_a1_ultima_venda_em'],
  matriz_id: ['matriz_codigo_sequencial'],

  unidade_base_id: ['unidade_base'],
  area_atuacao_id: ['area_atuacao'],
  segmento_id: ['segmento'],
  produto_id: ['produto'],
  modelo_contrato_id: ['modelo_contrato'],
  forma_pagamento_mensalidade_id: ['forma_pagamento_mensalidade'],
  forma_pagamento_ativacao_id: ['forma_pagamento_ativacao'],
};

/** Nunca reescritos numa atualização: um é do tenant, o outro é a chave da linha. */
const CHAVES_PROTEGIDAS = new Set(['tenant_id', 'cnpj']);

/**
 * Monta o objeto do `.update()` de um cliente que já existe.
 *
 * - `sobrescrever`: o arquivo é a ficha completa — payload inteiro, nulos inclusive.
 * - `complementar`: só o que veio preenchido no arquivo. Campo do payload sem
 *   coluna de origem conhecida é OMITIDO (nunca apagado) — assim uma coluna nova
 *   que ninguém mapeou aqui deixa de ser complementada em vez de zerar o cadastro.
 */
export function buildClienteUpdateRow<T extends Record<string, unknown>>(
  clienteRow: T,
  values: Record<string, string>,
  mode: DuplicataUpdateMode,
): Partial<T> {
  if (mode === 'sobrescrever') return clienteRow;

  const out: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(clienteRow)) {
    if (CHAVES_PROTEGIDAS.has(campo)) continue;

    const origens = CLIENTE_UPDATE_SOURCE_COLUMNS[campo];
    if (!origens) continue;

    const veioNoArquivo = origens.some(col => (values[col] ?? '').trim() !== '');
    if (veioNoArquivo) out[campo] = valor;
  }
  return out as Partial<T>;
}
