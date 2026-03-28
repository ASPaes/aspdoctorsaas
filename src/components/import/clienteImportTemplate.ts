// Colunas do template — ordem exata
// Campos de FK devem ser preenchidos com o NOME (texto), não com o ID numérico.
// O sistema fará a busca automática pelo nome na tabela correspondente.
export const CLIENTE_IMPORT_HEADERS = [
  // ── Dados Cadastrais ──
  'cnpj',                         // obrigatório — formato: 00.000.000/0000-00 ou só dígitos
  'razao_social',                  // obrigatório se nome_fantasia vazio
  'nome_fantasia',                 // obrigatório se razao_social vazio
  'email',                         // obrigatório
  'telefone_whatsapp',             // obrigatório — formato: (DD) NNNNN-NNNN
  'telefone_whatsapp_contato',     // opcional
  'telefone_contato',              // opcional
  'data_cadastro',                 // opcional — formato: YYYY-MM-DD
  'unidade_base',                  // opcional — nome da unidade base (ex: "Sede")
  'area_atuacao',                  // opcional — nome da área (ex: "Tecnologia")
  'segmento',                      // opcional — nome do segmento (ex: "Pequenas Empresas")
  'observacao_cliente',            // opcional

  // ── Endereço ──
  'cep',                           // opcional — formato: 00000-000
  'estado',                        // opcional — sigla (ex: SP, RJ, MG)
  'cidade',                        // opcional — nome da cidade (ex: "São Paulo")
  'endereco',                      // opcional
  'numero',                        // opcional
  'bairro',                        // opcional

  // ── Contato Principal ──
  'contato_nome',                  // opcional
  'contato_cpf',                   // opcional — formato: 000.000.000-00
  'contato_fone',                  // opcional — formato: (DD) NNNNN-NNNN
  'contato_aniversario',           // opcional — formato: YYYY-MM-DD

  // ── Contrato / Venda ──
  'data_venda',                    // obrigatório — formato: YYYY-MM-DD
  'data_ativacao',                 // opcional — formato: YYYY-MM-DD
  'funcionario',                   // obrigatório — nome do consultor (ex: "João Silva")
  'produto',                       // obrigatório — nome do produto (ex: "Plano Pro")
  'fornecedor',                    // obrigatório — nome do fornecedor (ex: "Fornecedor XYZ")
  'origem_venda',                  // obrigatório — nome da origem (ex: "Indicação")
  'modelo_contrato',               // obrigatório — nome do modelo (ex: "Padrão")
  'recorrencia',                   // obrigatório — valores: mensal | anual | semestral | semanal
  'codigo_fornecedor',             // opcional
  'link_portal_fornecedor',        // opcional

  // ── Financeiro ──
  'mensalidade',                   // obrigatório — número decimal (ex: 299.90)
  'valor_ativacao',                // obrigatório — número decimal (ex: 499.90)
  'forma_pagamento_mensalidade',   // obrigatório — nome (ex: "Boleto")
  'forma_pagamento_ativacao',      // obrigatório — nome (ex: "Cartão de Crédito")
  'custo_operacao',                // obrigatório — número decimal
  'imposto_percentual',            // obrigatório — número de 0 a 100 (ex: 6)
  'custo_fixo_percentual',         // obrigatório — número de 0 a 100 (ex: 5)
  'observacao_negociacao',         // opcional
];

export const CLIENTE_IMPORT_EXAMPLE_ROW = [
  '12.345.678/0001-99',
  'Empresa Exemplo Ltda',
  'Exemplo',
  'contato@empresa.com',
  '(11) 99999-0000',
  '(11) 98888-0000',
  '(11) 3333-0000',
  '2024-01-10',
  'Sede',
  'Tecnologia',
  'Pequenas Empresas',
  'Cliente indicado por parceiro',
  '01310-100',
  'SP',
  'São Paulo',
  'Av. Paulista',
  '1000',
  'Bela Vista',
  'João Silva',
  '123.456.789-00',
  '(11) 97777-0000',
  '1990-05-20',
  '2024-01-15',
  '2024-02-01',
  'Ana Souza',
  'Plano Pro',
  'Fornecedor XYZ',
  'Indicação',
  'Padrão',
  'mensal',
  'FORN-001',
  'https://portal.fornecedor.com',
  '299.90',
  '499.90',
  'Boleto',
  'Cartão de Crédito',
  '150.00',
  '6',
  '5',
  'Cliente com desconto especial',
];

export function gerarTemplateCsv(): string {
  return [
    CLIENTE_IMPORT_HEADERS.join(','),
    CLIENTE_IMPORT_EXAMPLE_ROW.join(','),
  ].join('\n');
}

export function downloadTemplateCsv() {
  const bom = '\uFEFF'; // BOM UTF-8 para abrir corretamente no Excel
  const conteudo = bom + gerarTemplateCsv();
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'template_importacao_clientes.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// Campos FK: coluna do CSV → tabela Supabase + campo de busca
export const FK_FIELDS: {
  csvColumn: string;
  label: string;
  table: string;
  searchField: string;
  dbField: string;
  tenantScoped: boolean;
}[] = [
  { csvColumn: 'unidade_base',               label: 'Unidade Base',             table: 'unidades_base',      searchField: 'nome', dbField: 'unidade_base_id',               tenantScoped: true },
  { csvColumn: 'area_atuacao',               label: 'Área de Atuação',          table: 'areas_atuacao',      searchField: 'nome', dbField: 'area_atuacao_id',               tenantScoped: true },
  { csvColumn: 'segmento',                   label: 'Segmento',                 table: 'segmentos',          searchField: 'nome', dbField: 'segmento_id',                   tenantScoped: true },
  { csvColumn: 'funcionario',                label: 'Funcionário (Consultor)',   table: 'funcionarios',       searchField: 'nome', dbField: 'funcionario_id',                tenantScoped: true },
  { csvColumn: 'produto',                    label: 'Produto',                  table: 'produtos',           searchField: 'nome', dbField: 'produto_id',                    tenantScoped: true },
  { csvColumn: 'fornecedor',                 label: 'Fornecedor',               table: 'fornecedores',       searchField: 'nome', dbField: 'fornecedor_id',                 tenantScoped: true },
  { csvColumn: 'origem_venda',               label: 'Origem da Venda',          table: 'origens_venda',      searchField: 'nome', dbField: 'origem_venda_id',               tenantScoped: true },
  { csvColumn: 'modelo_contrato',            label: 'Modelo de Contrato',       table: 'modelos_contrato',   searchField: 'nome', dbField: 'modelo_contrato_id',            tenantScoped: true },
  { csvColumn: 'forma_pagamento_mensalidade',label: 'Forma Pgto Mensalidade',   table: 'formas_pagamento',   searchField: 'nome', dbField: 'forma_pagamento_mensalidade_id', tenantScoped: true },
  { csvColumn: 'forma_pagamento_ativacao',   label: 'Forma Pgto Ativação',      table: 'formas_pagamento',   searchField: 'nome', dbField: 'forma_pagamento_ativacao_id',   tenantScoped: true },
];

// Campos obrigatórios para validação linha a linha
export const REQUIRED_FIELDS = [
  'cnpj',
  'email',
  'telefone_whatsapp',
  'data_venda',
  'funcionario',
  'produto',
  'fornecedor',
  'origem_venda',
  'modelo_contrato',
  'recorrencia',
  'mensalidade',
  'valor_ativacao',
  'forma_pagamento_mensalidade',
  'forma_pagamento_ativacao',
  'custo_operacao',
  'imposto_percentual',
  'custo_fixo_percentual',
];

export const RECORRENCIA_VALIDA = ['mensal', 'anual', 'semestral', 'semanal'];
