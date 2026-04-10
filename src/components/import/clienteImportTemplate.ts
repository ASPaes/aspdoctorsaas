/**
 * Template de importação de clientes
 *
 * Campos marcados com FK devem ser preenchidos com o NOME (texto) exato
 * cadastrado no sistema. O sistema fará a busca automática pelo nome.
 *
 * Campos com * são obrigatórios.
 */

// ── Mapeamento: nome amigável (header do CSV) → campo interno do sistema ─────
export const FRIENDLY_TO_SYSTEM: Record<string, string> = {
  'Razão Social': 'razao_social',
  'Nome Fantasia': 'nome_fantasia',
  'CNPJ': 'cnpj',
  'Email': 'email',
  'WhatsApp': 'telefone_whatsapp',
  'Unidade Base': 'unidade_base',
  'Data de Cadastro': 'data_cadastro',
  'Tipo de Pessoa': 'tipo_pessoa',
  'Área de Atuação': 'area_atuacao',
  'Segmento': 'segmento',
  'Observação do Cliente': 'observacao_cliente',
  'Telefone Contato': 'telefone_contato',
  'WhatsApp Contato': 'telefone_whatsapp_contato',
  'CEP': 'cep',
  'Estado (UF)': 'estado',
  'Cidade': 'cidade',
  'Endereço': 'endereco',
  'Número': 'numero',
  'Bairro': 'bairro',
  'Complemento': 'complemento',
  'Nome do Contato': 'contato_nome',
  'CPF do Contato': 'contato_cpf',
  'Telefone do Contato': 'contato_fone',
  'Aniversário do Contato': 'contato_aniversario',
  'Data da Venda': 'data_venda',
  'Produto': 'produto',
  'Recorrência': 'recorrencia',
  'Valor de Ativação': 'valor_ativacao',
  'Dia de Vencimento': 'dia_vencimento_mrr',
  'Mensalidade': 'mensalidade',
  'Custo Operação': 'custo_operacao',
  'Imposto (%)': 'imposto_percentual',
  'Custo Fixo (%)': 'custo_fixo_percentual',
  'Fornecedor': 'fornecedor',
  'Origem da Venda': 'origem_venda',
  'Modelo de Contrato': 'modelo_contrato',
  'Funcionário': 'funcionario',
  'Forma de Pagto Ativação': 'forma_pagamento_ativacao',
  'Forma de Pagto Mensalidade': 'forma_pagamento_mensalidade',
  'Data de Ativação': 'data_ativacao',
  'Código no Fornecedor': 'codigo_fornecedor',
  'Link Portal Fornecedor': 'link_portal_fornecedor',
  'Obs. Negociação': 'observacao_negociacao',
  'Cancelado? (sim/nao)': 'cancelado',
  'Data Cancelamento': 'data_cancelamento',
  'Motivo Cancelamento': 'motivo_cancelamento',
  'Obs. Cancelamento': 'observacao_cancelamento',
  'Vencimento Cert. A1': 'cert_a1_vencimento',
  'Última Venda Cert. A1': 'cert_a1_ultima_venda_em',
  'Código da Matriz': 'matriz_codigo_sequencial',
};

// ── Mapeamento inverso: campo interno → nome amigável ─────────────────────────
export const SYSTEM_TO_FRIENDLY: Record<string, string> =
  Object.fromEntries(Object.entries(FRIENDLY_TO_SYSTEM).map(([k, v]) => [v, k]));

// ── Campos obrigatórios ───────────────────────────────────────────────────────
export const REQUIRED_FIELDS = [
  'razao_social',
  'nome_fantasia',
  'cnpj',
  'email',
  'telefone_whatsapp',
  'unidade_base',
  'data_cadastro',
  'data_venda',
  'produto',
  'recorrencia',
  'mensalidade',
  'custo_operacao',
  'imposto_percentual',
  'custo_fixo_percentual',
];

// Labels amigáveis dos campos obrigatórios para exibição na UI
export const REQUIRED_FIELD_LABELS = REQUIRED_FIELDS.map(
  f => SYSTEM_TO_FRIENDLY[f] ?? f
);

// ── Valores válidos para recorrência ─────────────────────────────────────────
export const RECORRENCIA_VALIDA = ['mensal', 'anual', 'semestral', 'semanal'];

// ── Delimitador padrão dos templates ─────────────────────────────────────────
const DELIMITADOR = ';';

// ── Template mínimo: apenas os 14 campos obrigatórios ────────────────────────
const TEMPLATE_MINIMO_HEADERS = REQUIRED_FIELDS.map(f => SYSTEM_TO_FRIENDLY[f] ?? f);
const TEMPLATE_MINIMO_EXEMPLO = [
  'Empresa Exemplo Ltda',    // Razão Social
  'Nome Fantasia Exemplo',   // Nome Fantasia
  '12345678000199',          // CNPJ
  'contato@empresa.com',     // Email
  '(11) 99999-0000',         // WhatsApp
  'Sede',                    // Unidade Base
  '2024-01-10',              // Data de Cadastro
  '2024-01-15',              // Data da Venda
  'Plano Pro',               // Produto
  'mensal',                  // Recorrência
  '299.90',                  // Mensalidade
  '150.00',                  // Custo Operação
  '6',                       // Imposto (%)
  '5',                       // Custo Fixo (%)
];

// ── Template completo: todos os campos disponíveis ───────────────────────────
const TEMPLATE_COMPLETO_HEADERS = Object.keys(FRIENDLY_TO_SYSTEM);
const TEMPLATE_COMPLETO_EXEMPLO = TEMPLATE_COMPLETO_HEADERS.map(h => {
  const sys = FRIENDLY_TO_SYSTEM[h];
  const minIdx = TEMPLATE_MINIMO_HEADERS.indexOf(h);
  if (minIdx >= 0) return TEMPLATE_MINIMO_EXEMPLO[minIdx];
  // Exemplos para campos extras
  const exemplos: Record<string, string> = {
    tipo_pessoa: 'juridica',
    area_atuacao: 'Tecnologia',
    segmento: 'PME',
    estado: 'SP',
    cidade: 'São Paulo',
    cep: '01310-100',
    endereco: 'Av. Paulista',
    numero: '1000',
    bairro: 'Bela Vista',
    complemento: 'Sala 42',
    contato_nome: 'João Silva',
    contato_cpf: '12345678901',
    contato_fone: '(11) 98888-0000',
    data_ativacao: '2024-02-01',
    dia_vencimento_mrr: '10',
    valor_ativacao: '499.90',
    fornecedor: 'Fornecedor XYZ',
    origem_venda: 'Indicação',
    funcionario: 'Ana Souza',
    forma_pagamento_mensalidade: 'Boleto',
    cancelado: 'nao',
  };
  return exemplos[sys] ?? '';
});

// ── Gera conteúdo CSV do template mínimo ─────────────────────────────────────
export function gerarTemplateMinimoCsv(): string {
  return [
    TEMPLATE_MINIMO_HEADERS.join(DELIMITADOR),
    TEMPLATE_MINIMO_EXEMPLO.join(DELIMITADOR),
  ].join('\n');
}

// ── Gera conteúdo CSV do template completo ───────────────────────────────────
export function gerarTemplateCompletoCsv(): string {
  return [
    TEMPLATE_COMPLETO_HEADERS.join(DELIMITADOR),
    TEMPLATE_COMPLETO_EXEMPLO.join(DELIMITADOR),
  ].join('\n');
}

// ── Download do template mínimo ──────────────────────────────────────────────
export function downloadTemplateMinimoCsv() {
  const bom = '\uFEFF';
  const blob = new Blob([bom + gerarTemplateMinimoCsv()], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const hoje = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `template_minimo_clientes_${hoje}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Download do template completo ────────────────────────────────────────────
export function downloadTemplateCompletoCsv() {
  const bom = '\uFEFF';
  const blob = new Blob([bom + gerarTemplateCompletoCsv()], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const hoje = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `template_completo_clientes_${hoje}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Aliases para compatibilidade ──────────────────────────────────────────────
export const downloadTemplateCsv = downloadTemplateMinimoCsv;

// Array com todos os nomes internos (snake_case) na ordem do template completo
export const CLIENTE_IMPORT_HEADERS = Object.values(FRIENDLY_TO_SYSTEM);

// ── Campos FK: coluna CSV → tabela Supabase ───────────────────────────────────
export const FK_FIELDS: {
  csvColumn: string;
  label: string;
  table: string;
  searchField: string;
  dbField: string;
  tenantScoped: boolean;
  description: string;
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

// ── Labels amigáveis para exibição na UI ─────────────────────────────────────
export const HEADER_LABELS: Record<string, string> = {
  // Dados do Cliente
  razao_social: 'Razão Social',
  nome_fantasia: 'Nome Fantasia',
  cnpj: 'CNPJ (somente números)',
  email: 'E-mail',
  telefone_whatsapp: 'Tel. WhatsApp',
  unidade_base: 'Unidade Base',
  data_cadastro: 'Data de Cadastro',
  tipo_pessoa: 'Tipo de Pessoa (juridica/fisica)',
  area_atuacao: 'Área de Atuação',
  segmento: 'Segmento',
  observacao_cliente: 'Observação do Cliente',
  telefone_contato: 'Telefone Contato',
  telefone_whatsapp_contato: 'WhatsApp do Contato',
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
  cert_a1_ultima_venda_em: 'Última Venda Cert. A1',
  matriz_codigo_sequencial: 'Código da Matriz',
};

// ── Descrições de cada campo para exibir ao usuário no modal ─────────────────
export const FIELD_DESCRIPTIONS: Record<string, { section: string; why: string }> = {
  razao_social:               { section: 'Cliente', why: 'Nome jurídico da empresa. Obrigatório para identificação legal do cliente.' },
  nome_fantasia:              { section: 'Cliente', why: 'Nome comercial pelo qual a empresa é conhecida. Usado em comunicações e relatórios.' },
  cnpj:                       { section: 'Cliente', why: 'Identificador único da empresa. Evita duplicatas e é base para consultas automáticas de dados.' },
  email:                      { section: 'Cliente', why: 'Canal principal de comunicação. Usado em notificações automáticas e relatórios.' },
  telefone_whatsapp:          { section: 'Cliente', why: 'Número vinculado ao WhatsApp financeiro. Habilita o atendimento via chat no sistema.' },
  unidade_base:               { section: 'Cliente', why: 'Define qual unidade da sua empresa atende este cliente. Essencial para segmentação de relatórios.' },
  data_cadastro:              { section: 'Cliente', why: 'Data em que o cliente foi cadastrado. Obrigatória para calcular tempo de vida, cohort e relatórios históricos corretos.' },
  tipo_pessoa:                { section: 'Cliente', why: 'Define se é pessoa jurídica (CNPJ 14 dígitos) ou física (CPF 11 dígitos). Não obrigatório — o sistema detecta automaticamente pelo número de dígitos do campo CNPJ/CPF.' },
  area_atuacao:               { section: 'Cliente', why: 'Setor de mercado do cliente. Permite análises de MRR e churn por vertical.' },
  segmento:                   { section: 'Cliente', why: 'Classificação do porte ou tipo do cliente. Usado em análises de expansão e retenção.' },
  observacao_cliente:         { section: 'Cliente', why: 'Informações adicionais relevantes sobre o cliente.' },
  telefone_contato:           { section: 'Cliente', why: 'Telefone fixo ou alternativo do cliente para contato direto.' },
  telefone_whatsapp_contato:  { section: 'Cliente', why: 'WhatsApp do contato principal, diferente do WhatsApp financeiro. Usado para comunicações operacionais.' },
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
  cert_a1_ultima_venda_em:    { section: 'Certificado A1', why: 'Data da última venda do certificado digital. Usado para calcular ciclo de renovação e projetar receita futura.' },
  matriz_codigo_sequencial:   { section: 'Cliente', why: 'Código sequencial da empresa matriz. Vincula filiais à sua empresa-mãe para relatórios consolidados. Preencha com o número do Cód. Seq. da matriz (ex: 42).' },
};
