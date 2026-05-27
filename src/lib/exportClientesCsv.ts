import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { useLookups } from "@/hooks/useLookups";

type UseLookupsReturn = ReturnType<typeof useLookups>;

// CSV columns in exact required order
const CLIENTE_COLUMNS = [
  "Cód. Seq", "Razão Social", "Nome Fantasia", "CNPJ", "Tipo de Pessoa", "Email",
  "WhatsApp", "Telefone Contato", "WhatsApp Contato", "Unidade Base",
  "Data de Cadastro", "Área de Atuação", "Segmento", "Observação do Cliente",
  "CEP", "Estado (UF)", "Cidade", "Endereço", "Número", "Bairro", "Complemento",
  "Nome do Contato", "CPF do Contato", "Telefone do Contato", "Aniversário do Contato",
  "Imposto (%)", "Custo Fixo (%)", "Cancelado? (sim/nao)", "Data Cancelamento",
  "Motivo Cancelamento", "Obs. Cancelamento", "Vencimento Cert. A1",
  "Última Venda Cert. A1", "Código da Matriz",
];

const PRODUTO_COLUMNS = [
  "Prod_Ativo (sim/nao)", "Prod_Produto", "Prod_Fornecedor", "Prod_Mensalidade (R$)",
  "Prod_Custo Operação (R$)", "Prod_Valor de Ativação (R$)", "Prod_Recorrência",
  "Prod_Data da Venda", "Prod_Data de Ativação", "Prod_Data de Cancelamento",
  "Prod_Data Próximo Reajuste", "Prod_Dia Vencimento", "Prod_Prazo (meses)",
  "Prod_Data Fim", "Prod_Origem da Venda", "Prod_Funcionário", "Prod_Modelo de Contrato",
  "Prod_Forma Pagto Ativação", "Prod_Forma Pagto Mensalidade",
  "Prod_Código no Fornecedor", "Prod_Link Portal Fornecedor", "Prod_Observações Contratuais",
];

const EMPTY_PRODUTO_ROW = PRODUTO_COLUMNS.map(() => "");

function csvEscape(value: any): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtDate(v: any): string {
  if (!v) return "";
  const s = String(v);
  // Already YYYY-MM-DD or has time portion
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fmtNum(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

function fmtBool(v: any): string {
  if (v === null || v === undefined) return "";
  return v ? "sim" : "nao";
}

function buildMap<T extends Record<string, any>>(
  rows: T[] | undefined,
  keyField: string,
  valueField: string,
): Map<any, string> {
  const m = new Map<any, string>();
  if (!rows) return m;
  for (const r of rows) {
    m.set(r[keyField], String(r[valueField] ?? ""));
  }
  return m;
}

const resolve = (map: Map<any, string>, id: any): string => {
  if (id === null || id === undefined) return "";
  return map.get(id) ?? map.get(Number(id)) ?? map.get(String(id)) ?? "";
};

export async function exportClientesCsv({
  filteredClienteIds,
  tenantId,
  lookups,
}: {
  filteredClienteIds: string[];
  tenantId: string;
  lookups: UseLookupsReturn;
}): Promise<{ totalLinhas: number; totalClientes: number }> {
  const BATCH = 500;

  // a) fetch clientes
  const clientes: any[] = [];
  for (let i = 0; i < filteredClienteIds.length; i += BATCH) {
    const batch = filteredClienteIds.slice(i, i + BATCH);
    const rows = await fetchAllRows<any>(() => {
      let q = (supabase.from("clientes" as any) as any).select("*").in("id", batch);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    });
    clientes.push(...rows);
  }

  // b) fetch cliente_produtos
  const clienteProdutos: any[] = [];
  for (let i = 0; i < filteredClienteIds.length; i += BATCH) {
    const batch = filteredClienteIds.slice(i, i + BATCH);
    const rows = await fetchAllRows<any>(() => {
      let q = (supabase.from("cliente_produtos" as any) as any).select("*").in("cliente_id", batch);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    });
    clienteProdutos.push(...rows);
  }

  // c) formas de pagamento
  const { data: formasPagtoData } = await (supabase.from("formas_pagamento" as any) as any)
    .select("id, nome")
    .eq("tenant_id", tenantId);

  // d) lookup maps
  const mProduto = buildMap(lookups.produtos.data as any[], "id", "nome");
  const mFornecedor = buildMap(lookups.fornecedores.data as any[], "id", "nome");
  const mUnidade = buildMap(lookups.unidadesBase.data as any[], "id", "nome");
  const mArea = buildMap(lookups.areasAtuacao.data as any[], "id", "nome");
  const mSegmento = buildMap(lookups.segmentos.data as any[], "id", "nome");
  const mFuncionario = buildMap(lookups.funcionarios.data as any[], "id", "nome");
  const mOrigem = buildMap(lookups.origensVenda.data as any[], "id", "nome");
  const mModelo = buildMap(lookups.modelosContrato.data as any[], "id", "nome");
  const mMotivo = buildMap(lookups.motivosCancelamento.data as any[], "id", "descricao");
  const mEstado = buildMap(lookups.estados.data as any[], "id", "sigla");
  const mCidade = buildMap(lookups.cidades.data as any[], "id", "nome");
  const mForma = buildMap(formasPagtoData as any[], "id", "nome");

  // Group products by cliente_id
  const produtosByCliente = new Map<string, any[]>();
  for (const cp of clienteProdutos) {
    const arr = produtosByCliente.get(cp.cliente_id) ?? [];
    arr.push(cp);
    produtosByCliente.set(cp.cliente_id, arr);
  }

  const clienteRow = (c: any): string[] => [
    fmtNum(c.codigo_sequencial),
    c.razao_social ?? "",
    c.nome_fantasia ?? "",
    c.cnpj ?? "",
    c.tipo_pessoa ?? "",
    c.email ?? "",
    c.telefone_whatsapp ?? "",
    c.telefone_contato ?? "",
    c.telefone_whatsapp_contato ?? "",
    resolve(mUnidade, c.unidade_base_id),
    fmtDate(c.data_cadastro),
    resolve(mArea, c.area_atuacao_id),
    resolve(mSegmento, c.segmento_id),
    c.observacao_cliente ?? "",
    c.cep ?? "",
    resolve(mEstado, c.estado_id),
    resolve(mCidade, c.cidade_id),
    c.endereco ?? "",
    c.numero ?? "",
    c.bairro ?? "",
    c.complemento ?? "",
    c.contato_nome ?? "",
    c.contato_cpf ?? "",
    c.contato_fone ?? "",
    fmtDate(c.contato_aniversario),
    fmtNum(c.imposto_percentual),
    fmtNum(c.custo_fixo_percentual),
    fmtBool(c.cancelado),
    fmtDate(c.data_cancelamento),
    resolve(mMotivo, c.motivo_cancelamento_id),
    c.observacao_cancelamento ?? "",
    fmtDate(c.cert_a1_vencimento),
    fmtDate(c.cert_a1_ultima_venda_em),
    fmtNum(c.matriz_codigo_sequencial),
  ];

  const produtoRow = (p: any): string[] => [
    fmtBool(p.ativo),
    resolve(mProduto, p.produto_id),
    resolve(mFornecedor, p.fornecedor_id),
    fmtNum(p.vlr_mensal),
    fmtNum(p.vlr_custo),
    fmtNum(p.vlr_ativacao),
    p.recorrencia ?? "",
    fmtDate(p.data_venda),
    fmtDate(p.data_ativacao),
    fmtDate(p.data_cancelamento),
    fmtDate(p.data_proximo_reajuste),
    fmtNum(p.dia_vencimento),
    fmtNum(p.prazo_meses),
    fmtDate(p.data_fim),
    resolve(mOrigem, p.origem_venda_id),
    resolve(mFuncionario, p.funcionario_id),
    resolve(mModelo, p.modelo_contrato_id),
    resolve(mForma, p.forma_pagamento_ativacao_id),
    resolve(mForma, p.forma_pagamento_mensalidade_id),
    p.codigo_fornecedor ?? "",
    p.link_portal_fornecedor ?? "",
    p.observacoes_contratuais ?? "",
  ];

  // Build rows
  const header = [...CLIENTE_COLUMNS, ...PRODUTO_COLUMNS];
  const lines: string[] = [header.map(csvEscape).join(";")];

  for (const c of clientes) {
    const cRow = clienteRow(c);
    const prods = produtosByCliente.get(c.id) ?? [];
    if (prods.length === 0) {
      lines.push([...cRow, ...EMPTY_PRODUTO_ROW].map(csvEscape).join(";"));
    } else {
      for (const p of prods) {
        lines.push([...cRow, ...produtoRow(p)].map(csvEscape).join(";"));
      }
    }
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clientes_export_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { totalLinhas: lines.length - 1, totalClientes: clientes.length };
}
