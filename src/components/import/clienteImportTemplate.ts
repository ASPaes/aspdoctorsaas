/**
 * Template de importação de clientes
 *
 * Campos marcados com FK devem ser preenchidos com o NOME (texto) exato
 * cadastrado no sistema. O sistema fará a busca automática pelo nome.
 *
 * Campos com * são obrigatórios.
 */

// ── Ordem exata das colunas do template CSV ──────────────────────────────────
export const CLIENTE_IMPORT_HEADERS = [

  // ── SEÇÃO 1: Dados do Cliente ─────────────────────────────────────────────
  'razao_social',               // * Razão Social da empresa
  'nome_fantasia',              // * Nome Fantasia (apelido comercial)
  'cnpj',                       // * CNPJ — somente números, sem . / -  (ex: 12345678000199)
  'email',                      // * E-mail principal do cliente
  'telefone_whatsapp',          // * WhatsApp Financeiro — formato: (DD) NNNNN-NNNN
  'unidade_base',               // * Unidade Base — nome da unidade (FK: unidades_base)
  'data_cadastro',              // * Data de Cadastro — formato: YYYY-MM-DD (obrigatório)
  'tipo_pessoa',                //   Tipo de pessoa: juridica | fisica (padrão: juridica)
  'area_atuacao',               //   Área de Atuação — nome da área (FK: areas_atuacao)
  'segmento',                   //   Segmento de mercado (FK: segmentos)
  'observacao_cliente',         //   Observações gerais sobre o cliente

  // ── SEÇÃO 2: Endereço ─────────────────────────────────────────────────────
  'cep',                        //   CEP — formato: 00000-000
  'estado',                     //   Estado — sigla (ex: SP, RJ, MG)
  'cidade',                     //   Cidade — nome completo
  'endereco',                   //   Logradouro (rua, av, etc.)
  'numero',                     //   Número do endereço
  'bairro',                     //   Bairro
  'complemento',                //   Complemento do endereço (sala, andar, bloco...)

  // ── SEÇÃO 3: Contato Principal ────────────────────────────────────────────
  'contato_nome',               //   Nome do contato principal
  'contato_cpf',                //   CPF do contato — formato: 000.000.000-00
  'contato_fone',               //   Telefone do contato — formato: (DD) NNNNN-NNNN
  'contato_aniversario',        //   Data de aniversário — formato: YYYY-MM-DD

  // ── SEÇÃO 4: Produto / Contrato ───────────────────────────────────────────
  'data_venda',                 // * Data da Venda — formato: YYYY-MM-DD
  'produto',                    // * Produto contratado (FK: produtos)
  'recorrencia',                // * Recorrência — valores: mensal | anual | semestral | semanal
  'valor_ativacao',             // * Valor de Ativação — número decimal (ex: 499.90)
  'dia_vencimento_mrr',         //   Dia do mês para vencimento da mensalidade (ex: 5, 10, 15)
  'mensalidade',                // * Mensalidade/MRR — número decimal (ex: 299.90)
  'custo_operacao',             // * Custo Operação (custo com fornecedor) — número decimal
  'imposto_percentual',         // * Imposto — número de 0 a 100 (ex: 6 = 6%)
  'custo_fixo_percentual',      // * Custo Fixo — número de 0 a 100 (ex: 5 = 5%)
  'fornecedor',                 //   Fornecedor (FK: fornecedores)
  'origem_venda',               //   Origem da Venda (FK: origens_venda)
  'modelo_contrato',            //   Modelo de Contrato (FK: modelos_contrato)
  'funcionario',                //   Funcionário/Consultor responsável (FK: funcionarios)
  'forma_pagamento_ativacao',   //   Forma de Pagamento da Ativação (FK: formas_pagamento)
  'forma_pagamento_mensalidade',//   Forma de Pagamento da Mensalidade (FK: formas_pagamento)
  'data_ativacao',              //   Data de Ativação — formato: YYYY-MM-DD
  'codigo_fornecedor',          //   Código do cliente no sistema do fornecedor
  'link_portal_fornecedor',     //   Link de acesso ao portal do fornecedor
  'observacao_negociacao',      //   Observações sobre a negociação/contrato

  // ── SEÇÃO 5: Cancelamento (para importar histórico de churn) ─────────────
  'cancelado',                  //   Cliente cancelado? — valores: sim | nao (padrão: nao)
  'data_cancelamento',          //   Data do cancelamento — formato: YYYY-MM-DD
  'motivo_cancelamento',        //   Motivo do cancelamento (FK: motivos_cancelamento)
  'observacao_cancelamento',    //   Observações sobre o cancelamento

  // ── SEÇÃO 6: Certificado Digital A1 (para calcular renovações e churn) ───
  'cert_a1_vencimento',         //   Data de vencimento do Certificado A1 — formato: YYYY-MM-DD
  'cert_a1_ultima_venda_em',    //   Data da última venda do Cert A1 — formato: YYYY-MM-DD
  'matriz_codigo_sequencial',   //   Código sequencial da empresa Matriz (número inteiro, ex: 42)
];

// ── Linha de exemplo para o template ─────────────────────────────────────────
export const CLIENTE_IMPORT_EXAMPLE_ROW = [
  // Dados do Cliente
  'Empresa Exemplo Ltda',
  'Exemplo',
  '12345678000199',
  'contato@empresa.com',
  '(11) 99999-0000',
  'Sede',
  '2024-01-10',
  'juridica',
  'Tecnologia',
  'Pequenas Empresas',
  'Cliente indicado por parceiro',
  '(11) 3333-0000',
  '(11) 98888-0000',
  // Endereço
  '01310-100',
  'SP',
  'São Paulo',
  'Av. Paulista',
  '1000',
  'Bela Vista',
  'Sala 42',
  // Contato Principal
  'João Silva',
  '123.456.789-00',
  '(11) 97777-0000',
  '1990-05-20',
  // Produto / Contrato
  '2024-01-15',
  'Plano Pro',
  'mensal',
  '499.90',
  '10',
  '299.90',
  '150.00',
  '6',
  '5',
  'Fornecedor XYZ',
  'Indicação',
  'Padrão',
  'Ana Souza',
  'Cartão de Crédito',
  'Boleto',
  '2024-02-01',
  'FORN-001',
  'https://portal.fornecedor.com',
  'Cliente com desconto especial',
  // Cancelamento
  'nao',
  '',
  '',
  '',
  // Certificado A1
  '',
];

// ── Gera conteúdo CSV do template ─────────────────────────────────────────────
export function gerarTemplateCsv(): string {
  return [
    CLIENTE_IMPORT_HEADERS.join(','),
    CLIENTE_IMPORT_EXAMPLE_ROW.join(','),
  ].join('\n');
}

// ── Download do template ──────────────────────────────────────────────────────
export function downloadTemplateCsv() {
  const bom = '\uFEFF'; // BOM UTF-8 — garante abertura correta no Excel
  const conteudo = bom + gerarTemplateCsv();
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'template_importacao_clientes.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// ── Campos FK: coluna CSV → tabela Supabase ───────────────────────────────────
export const FK_FIELDS: {
  csvColumn: string;
  label: string;
  table: string;
  searchField: string;
  dbField: string;
  tenantScoped: boolean;
  description: string; // explicação do campo para o usuário
}[] = [
  {
    csvColumn: 'unidade_base',
    label: 'Unidade Base',
    table: 'unidades_base',
    searchField: 'nome',
    dbField: 'unidade_base_id',
    tenantScoped: true,
    description: 'Unidade da empresa responsável por este cliente. Usada para segmentar relatórios por filial ou regional.',
  },
  {
    csvColumn: 'area_atuacao',
    label: 'Área de Atuação',
    table: 'areas_atuacao',
    searchField: 'nome',
    dbField: 'area_atuacao_id',
    tenantScoped: true,
    description: 'Setor de mercado em que o cliente atua. Permite filtrar e analisar clientes por segmento de negócio.',
  },
  {
    csvColumn: 'segmento',
    label: 'Segmento',
    table: 'segmentos',
    searchField: 'nome',
    dbField: 'segmento_id',
    tenantScoped: true,
    description: 'Classificação comercial do cliente (ex: PME, Enterprise). Essencial para análises de MRR por segmento.',
  },
  {
    csvColumn: 'produto',
    label: 'Produto',
    table: 'produtos',
    searchField: 'nome',
    dbField: 'produto_id',
    tenantScoped: true,
    description: 'Produto ou plano contratado pelo cliente. Define o que está sendo entregue e calculado no MRR.',
  },
  {
    csvColumn: 'fornecedor',
    label: 'Fornecedor',
    table: 'fornecedores',
    searchField: 'nome',
    dbField: 'fornecedor_id',
    tenantScoped: true,
    description: 'Fornecedor que entrega o serviço ao cliente. Usado no cálculo de custo de operação e margem.',
  },
  {
    csvColumn: 'origem_venda',
    label: 'Origem da Venda',
    table: 'origens_venda',
    searchField: 'nome',
    dbField: 'origem_venda_id',
    tenantScoped: true,
    description: 'Canal pelo qual a venda foi gerada (ex: Indicação, Google, Cold Call). Fundamental para calcular o CAC por canal.',
  },
  {
    csvColumn: 'modelo_contrato',
    label: 'Modelo de Contrato',
    table: 'modelos_contrato',
    searchField: 'nome',
    dbField: 'modelo_contrato_id',
    tenantScoped: true,
    description: 'Tipo de contrato firmado com o cliente. Permite identificar padrões de churn por modelo contratual.',
  },
  {
    csvColumn: 'funcionario',
    label: 'Funcionário (Consultor)',
    table: 'funcionarios',
    searchField: 'nome',
    dbField: 'funcionario_id',
    tenantScoped: true,
    description: 'Consultor ou vendedor responsável pela venda. Usado nos relatórios de performance por consultor.',
  },
  {
    csvColumn: 'forma_pagamento_ativacao',
    label: 'Forma de Pagto Ativação',
    table: 'formas_pagamento',
    searchField: 'nome',
    dbField: 'forma_pagamento_ativacao_id',
    tenantScoped: true,
    description: 'Como o cliente pagou a ativação (ex: Boleto, Pix, Cartão). Importante para conciliação financeira.',
  },
  {
    csvColumn: 'forma_pagamento_mensalidade',
    label: 'Forma de Pagto Mensalidade',
    table: 'formas_pagamento',
    searchField: 'nome',
    dbField: 'forma_pagamento_mensalidade_id',
    tenantScoped: true,
    description: 'Como o cliente paga a mensalidade recorrente. Afeta previsão de inadimplência e fluxo de caixa.',
  },
  {
    csvColumn: 'motivo_cancelamento',
    label: 'Motivo de Cancelamento',
    table: 'motivos_cancelamento',
    searchField: 'descricao',
    dbField: 'motivo_cancelamento_id',
    tenantScoped: true,
    description: 'Razão pela qual o cliente cancelou. Essencial para análise de churn e ações de retenção.',
  },
];

// ── Campos obrigatórios ───────────────────────────────────────────────────────
export const REQUIRED_FIELDS = [
  'razao_social',
  'nome_fantasia',
  'cnpj',
  'email',
  'telefone_whatsapp',
  'unidade_base',
  'data_venda',
  'produto',
  'recorrencia',
  'valor_ativacao',
  'mensalidade',
  'custo_operacao',
  'imposto_percentual',
  'custo_fixo_percentual',
];

// ── Valores válidos para recorrência ─────────────────────────────────────────
export const RECORRENCIA_VALIDA = ['mensal', 'anual', 'semestral', 'semanal'];

// ── Labels amigáveis para exibição na UI ─────────────────────────────────────
export const HEADER_LABELS: Record<string, string> = {
  // Dados do Cliente
  razao_social: 'Razão Social',
  nome_fantasia: 'Nome Fantasia',
  cnpj: 'CNPJ (somente números)',
  email: 'E-mail',
  telefone_whatsapp: 'Tel. WhatsApp',
  unidade_base: 'Unidade Base',
  tipo_pessoa: 'Tipo de Pessoa (juridica/fisica)',
  area_atuacao: 'Área de Atuação',
  segmento: 'Segmento',
  observacao_cliente: 'Observação do Cliente',
  // Endereço
  cep: 'CEP',
  estado: 'Estado (UF)',
  cidade: 'Cidade',
  endereco: 'Endereço',
  numero: 'Número',
  bairro: 'Bairro',
  complemento: 'Complemento',
  // Contato
  contato_nome: 'Nome do Contato',
  contato_cpf: 'CPF do Contato',
  contato_fone: 'Fone do Contato',
  contato_aniversario: 'Data de Aniversário',
  // Produto / Contrato
  data_venda: 'Data da Venda',
  produto: 'Produto',
  recorrencia: 'Recorrência',
  valor_ativacao: 'Valor de Ativação',
  dia_vencimento_mrr: 'Dia Vencimento MRR',
  mensalidade: 'Mensalidade / MRR',
  custo_operacao: 'Custo Operação',
  imposto_percentual: 'Imposto (%)',
  custo_fixo_percentual: 'Custo Fixo (%)',
  fornecedor: 'Fornecedor',
  origem_venda: 'Origem da Venda',
  modelo_contrato: 'Modelo de Contrato',
  funcionario: 'Funcionário (Consultor)',
  forma_pagamento_ativacao: 'Forma Pgto Ativação',
  forma_pagamento_mensalidade: 'Forma Pgto Mensalidade',
  data_ativacao: 'Data de Ativação',
  codigo_fornecedor: 'Código no Fornecedor',
  link_portal_fornecedor: 'Link Portal Fornecedor',
  observacao_negociacao: 'Obs. da Negociação',
  // Cancelamento
  cancelado: 'Cancelado? (sim/nao)',
  data_cancelamento: 'Data de Cancelamento',
  motivo_cancelamento: 'Motivo de Cancelamento',
  observacao_cancelamento: 'Obs. do Cancelamento',
  // Certificado A1
  cert_a1_vencimento: 'Vencimento Cert. A1',
};

// ── Descrições de cada campo para exibir ao usuário no modal ─────────────────
export const FIELD_DESCRIPTIONS: Record<string, { section: string; why: string }> = {
  razao_social:               { section: 'Cliente', why: 'Nome jurídico da empresa. Obrigatório para identificação legal do cliente.' },
  nome_fantasia:              { section: 'Cliente', why: 'Nome comercial pelo qual a empresa é conhecida. Usado em comunicações e relatórios.' },
  cnpj:                       { section: 'Cliente', why: 'Identificador único da empresa. Evita duplicatas e é base para consultas automáticas de dados.' },
  email:                      { section: 'Cliente', why: 'Canal principal de comunicação. Usado em notificações automáticas e relatórios.' },
  telefone_whatsapp:          { section: 'Cliente', why: 'Número vinculado ao WhatsApp financeiro. Habilita o atendimento via chat no sistema.' },
  unidade_base:               { section: 'Cliente', why: 'Define qual unidade da sua empresa atende este cliente. Essencial para segmentação de relatórios.' },
  tipo_pessoa:                { section: 'Cliente', why: 'Define se é pessoa jurídica (CNPJ 14 dígitos) ou física (CPF 11 dígitos). Não obrigatório — o sistema detecta automaticamente pelo número de dígitos do campo CNPJ/CPF.' },
  area_atuacao:               { section: 'Cliente', why: 'Setor de mercado do cliente. Permite análises de MRR e churn por vertical.' },
  segmento:                   { section: 'Cliente', why: 'Classificação do porte ou tipo do cliente. Usado em análises de expansão e retenção.' },
  observacao_cliente:         { section: 'Cliente', why: 'Informações adicionais relevantes sobre o cliente.' },
  cep:                        { section: 'Endereço', why: 'Localização do cliente. Útil para análises geográficas e emissão de documentos.' },
  estado:                     { section: 'Endereço', why: 'Estado do cliente. Sigla de 2 letras (ex: SP).' },
  cidade:                     { section: 'Endereço', why: 'Cidade do cliente para análises regionais.' },
  endereco:                   { section: 'Endereço', why: 'Logradouro completo para correspondências e contratos.' },
  numero:                     { section: 'Endereço', why: 'Número do endereço.' },
  bairro:                     { section: 'Endereço', why: 'Bairro para complementar o endereço.' },
  complemento:                { section: 'Endereço', why: 'Complemento do endereço como sala, andar ou bloco.' },
  contato_nome:               { section: 'Contato', why: 'Pessoa responsável pelo relacionamento. Usado nos atendimentos e comunicações.' },
  contato_cpf:                { section: 'Contato', why: 'CPF do contato principal para documentação e contratos.' },
  contato_fone:               { section: 'Contato', why: 'Telefone do contato para atendimento.' },
  contato_aniversario:        { section: 'Contato', why: 'Data de aniversário do contato para ações de relacionamento.' },
  data_venda:                 { section: 'Produto/Contrato', why: 'Marca o início do ciclo de vida do cliente no sistema. Usado para calcular LTV, cohort e MRR.' },
  produto:                    { section: 'Produto/Contrato', why: 'O que foi vendido ao cliente. Base para análise de MRR por produto.' },
  recorrencia:                { section: 'Produto/Contrato', why: 'Periodicidade do pagamento. Define o ciclo de cobrança e o cálculo de MRR anualizado.' },
  valor_ativacao:             { section: 'Produto/Contrato', why: 'Receita única da ativação. Compõe o cálculo de receita total e CAC.' },
  dia_vencimento_mrr:         { section: 'Produto/Contrato', why: 'Dia do mês em que vence a mensalidade recorrente (ex: 5, 10, 15). Usado para controle de cobrança.' },
  mensalidade:                { section: 'Produto/Contrato', why: 'MRR do cliente. É a principal métrica de crescimento recorrente do negócio.' },
  custo_operacao:             { section: 'Produto/Contrato', why: 'Custo direto com o fornecedor. Necessário para calcular a margem de contribuição (MC%).' },
  imposto_percentual:         { section: 'Produto/Contrato', why: 'Percentual de impostos sobre o faturamento. Impacta no cálculo da MC% líquida.' },
  custo_fixo_percentual:      { section: 'Produto/Contrato', why: 'Rateio de custo fixo alocado a este cliente. Usado no cálculo de rentabilidade real.' },
  fornecedor:                 { section: 'Produto/Contrato', why: 'Quem entrega o serviço. Permite análise de custo e dependência por fornecedor.' },
  origem_venda:               { section: 'Produto/Contrato', why: 'Canal que gerou a venda. Fundamental para calcular o CAC por canal e ROI de marketing.' },
  modelo_contrato:            { section: 'Produto/Contrato', why: 'Tipo de contrato firmado. Permite identificar padrões de churn por modelo.' },
  funcionario:                { section: 'Produto/Contrato', why: 'Consultor responsável. Usado em rankings e comissões por vendedor.' },
  forma_pagamento_ativacao:   { section: 'Produto/Contrato', why: 'Método de pagamento da ativação para conciliação financeira.' },
  forma_pagamento_mensalidade:{ section: 'Produto/Contrato', why: 'Método de pagamento recorrente. Afeta previsão de inadimplência.' },
  data_ativacao:              { section: 'Produto/Contrato', why: 'Quando o serviço foi ativado. Determina o início real da entrega.' },
  codigo_fornecedor:          { section: 'Produto/Contrato', why: 'Identificador do cliente no sistema do fornecedor. Facilita suporte e consultas.' },
  link_portal_fornecedor:     { section: 'Produto/Contrato', why: 'Acesso direto ao painel do cliente no fornecedor. Agiliza o atendimento.' },
  observacao_negociacao:      { section: 'Produto/Contrato', why: 'Condições especiais da negociação para referência futura.' },
  cancelado:                  { section: 'Cancelamento', why: 'Indica se o cliente já foi cancelado. Necessário para calcular o churn histórico corretamente.' },
  data_cancelamento:          { section: 'Cancelamento', why: 'Quando o cliente cancelou. Define o período de churn no cálculo de cohort.' },
  motivo_cancelamento:        { section: 'Cancelamento', why: 'Por que o cliente saiu. Dado crítico para ações de retenção e melhoria do produto.' },
  observacao_cancelamento:    { section: 'Cancelamento', why: 'Contexto adicional sobre o cancelamento.' },
  cert_a1_vencimento:         { section: 'Certificado A1', why: 'Data de vencimento do certificado digital. Permite alertas de renovação e evita churn por vencimento.' },
};
