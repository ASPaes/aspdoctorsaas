export const CLIENTE_IMPORT_HEADERS = [
  'razao_social',
  'nome_fantasia',
  'cnpj',
  'email',
  'telefone_whatsapp',
  'telefone_contato',
  'contato_nome',
  'contato_fone',
  'cep',
  'endereco',
  'numero',
  'bairro',
  'mensalidade',
  'valor_ativacao',
  'data_venda',
  'data_ativacao',
  'observacao_cliente',
];

export const CLIENTE_IMPORT_EXAMPLE_ROW = [
  'Empresa Exemplo Ltda',
  'Exemplo',
  '12.345.678/0001-99',
  'contato@empresa.com',
  '11999990000',
  '11988880000',
  'João Silva',
  '11977770000',
  '01310-100',
  'Av. Paulista',
  '1000',
  'Bela Vista',
  '299.90',
  '499.90',
  '2024-01-15',
  '2024-02-01',
  'Cliente vindo de indicação',
];

export function gerarTemplateCsv(): string {
  return [
    CLIENTE_IMPORT_HEADERS.join(','),
    CLIENTE_IMPORT_EXAMPLE_ROW.join(','),
  ].join('\n');
}

export function downloadTemplateCsv() {
  const conteudo = gerarTemplateCsv();
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'template_importacao_clientes.csv';
  link.click();
  URL.revokeObjectURL(url);
}
