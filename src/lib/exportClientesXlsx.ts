import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { useLookups } from "@/hooks/useLookups";

type UseLookupsReturn = ReturnType<typeof useLookups>;

const CLIENTE_COLUMNS = [
  "Cód. Seq", "Razão Social", "Nome Fantasia", "CNPJ", "Tipo de Pessoa", "Email",
  "WhatsApp", "Telefone Contato", "WhatsApp Contato", "Unidade Base",
  "Data de Cadastro", "Área de Atuação", "Segmento", "Observação do Cliente",
  "CEP", "Estado (UF)", "Cidade", "Endereço", "Número", "Bairro", "Complemento",
  "Nome do Contato", "CPF do Contato", "Telefone do Contato", "Aniversário do Contato",
  "Imposto (%)", "Custo Fixo (%)", "Cancelado? (sim/nao)", "Data Cancelamento",
  "Motivo Cancelamento", "Obs. Cancelamento", "Vencimento Cert. A1",
  "Última Venda Cert. A1", "Código da Matriz", "MRR Atual (R$)",
];

const PRODUTO_COLUMNS = [
  "Prod_Ativo (sim/nao)", "Prod_Produto", "Prod_Fornecedor",
  "Prod_Custo Operação (R$)", "Prod_Valor de Ativação (R$)", "Prod_Recorrência",
  "Prod_Data da Venda", "Prod_Data de Ativação", "Prod_Data de Cancelamento",
  "Prod_Data Próximo Reajuste", "Prod_Dia Vencimento", "Prod_Prazo (meses)",
  "Prod_Data Fim", "Prod_Origem da Venda", "Prod_Funcionário", "Prod_Modelo de Contrato",
  "Prod_Forma Pagto Ativação", "Prod_Forma Pagto Mensalidade",
  "Prod_Código no Fornecedor", "Prod_Link Portal Fornecedor", "Prod_Observações Contratuais",
];

const EMPTY_PRODUTO_ROW: any[] = PRODUTO_COLUMNS.map(() => "");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round2(n);
}

function pctCell(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round2(n * 100);
}

function dateCell(v: any): Date | undefined {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const [y, mo, da] = s.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, da));
}

function boolCell(v: any): string {
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

export async function exportClientesXlsx({
  filteredClienteIds,
  tenantId,
  lookups,
}: {
  filteredClienteIds: string[];
  tenantId: string;
  lookups: UseLookupsReturn;
}): Promise<{ totalLinhas: number; totalClientes: number }> {
  const BATCH = 500;

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

  const mensalidadeMap = new Map<string, number>();
  for (let i = 0; i < filteredClienteIds.length; i += BATCH) {
    const batch = filteredClienteIds.slice(i, i + BATCH);
    const rows = await fetchAllRows<any>(() => {
      let q = (supabase.from("vw_clientes_financeiro" as any) as any)
        .select("id, mensalidade").in("id", batch);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    });
    for (const r of rows) mensalidadeMap.set(r.id, Number(r.mensalidade ?? 0));
  }

  const deltaMap = new Map<string, number>();
  for (let i = 0; i < filteredClienteIds.length; i += BATCH) {
    const batch = filteredClienteIds.slice(i, i + BATCH);
    const rows = await fetchAllRows<any>(() => {
      let q = (supabase.from("movimentos_mrr" as any) as any)
        .select("cliente_id, valor_delta")
        .in("cliente_id", batch)
        .eq("status", "ativo")
        .is("estornado_por", null)
        .is("estorno_de", null)
        .neq("tipo", "venda_avulsa")
        .neq("tipo", "reajuste");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    });
    for (const r of rows) {
      deltaMap.set(r.cliente_id, (deltaMap.get(r.cliente_id) ?? 0) + Number(r.valor_delta ?? 0));
    }
  }

  const mrrAtual = (cid: string) => (mensalidadeMap.get(cid) ?? 0) + (deltaMap.get(cid) ?? 0);

  const { data: formasPagtoData } = await (supabase.from("formas_pagamento" as any) as any)
    .select("id, nome")
    .eq("tenant_id", tenantId);

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

  const produtosByCliente = new Map<string, any[]>();
  for (const cp of clienteProdutos) {
    const arr = produtosByCliente.get(cp.cliente_id) ?? [];
    arr.push(cp);
    produtosByCliente.set(cp.cliente_id, arr);
  }

  const clienteRow = (c: any): any[] => [
    numCell(c.codigo_sequencial),
    c.razao_social ?? "",
    c.nome_fantasia ?? "",
    c.cnpj ?? "",
    c.tipo_pessoa ?? "",
    c.email ?? "",
    c.telefone_whatsapp ?? "",
    c.telefone_contato ?? "",
    c.telefone_whatsapp_contato ?? "",
    resolve(mUnidade, c.unidade_base_id),
    dateCell(c.data_cadastro) ?? "",
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
    dateCell(c.contato_aniversario) ?? "",
    pctCell(c.imposto_percentual) ?? "",
    pctCell(c.custo_fixo_percentual) ?? "",
    boolCell(c.cancelado),
    dateCell(c.data_cancelamento) ?? "",
    resolve(mMotivo, c.motivo_cancelamento_id),
    c.observacao_cancelamento ?? "",
    dateCell(c.cert_a1_vencimento) ?? "",
    dateCell(c.cert_a1_ultima_venda_em) ?? "",
    numCell(c.matriz_codigo_sequencial) ?? "",
    numCell(mrrAtual(c.id)) ?? "",
  ];

  const produtoRow = (p: any): any[] => [
    boolCell(p.ativo),
    resolve(mProduto, p.produto_id),
    resolve(mFornecedor, p.fornecedor_id),
    numCell(p.vlr_custo) ?? "",
    numCell(p.vlr_ativacao) ?? "",
    p.recorrencia ?? "",
    dateCell(p.data_venda) ?? "",
    dateCell(p.data_ativacao) ?? "",
    dateCell(p.data_cancelamento) ?? "",
    dateCell(p.data_proximo_reajuste) ?? "",
    numCell(p.dia_vencimento) ?? "",
    numCell(p.prazo_meses) ?? "",
    dateCell(p.data_fim) ?? "",
    resolve(mOrigem, p.origem_venda_id),
    resolve(mFuncionario, p.funcionario_id),
    resolve(mModelo, p.modelo_contrato_id),
    resolve(mForma, p.forma_pagamento_ativacao_id),
    resolve(mForma, p.forma_pagamento_mensalidade_id),
    p.codigo_fornecedor ?? "",
    p.link_portal_fornecedor ?? "",
    p.observacoes_contratuais ?? "",
  ];

  const header = [...CLIENTE_COLUMNS, ...PRODUTO_COLUMNS];
  const aoa: any[][] = [header];

  for (const c of clientes) {
    const cRow = clienteRow(c);
    const prods = produtosByCliente.get(c.id) ?? [];
    if (prods.length === 0) {
      aoa.push([...cRow, ...EMPTY_PRODUTO_ROW]);
    } else {
      for (const p of prods) {
        aoa.push([...cRow, ...produtoRow(p)]);
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  ws["!cols"] = header.map((h) => {
    if (/CNPJ|CPF/i.test(h)) return { wch: 18 };
    if (/Razão Social|Nome Fantasia|Endereço|Observa/i.test(h)) return { wch: 30 };
    if (/Data|Vencimento/i.test(h)) return { wch: 12 };
    if (/Email|Link/i.test(h)) return { wch: 28 };
    if (/Mensalidade|Custo|Valor|Imposto|Fixo/i.test(h)) return { wch: 14 };
    return { wch: 16 };
  });

  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && cell.t === "d") {
        cell.z = "yyyy-mm-dd";
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `clientes_export_${today}.xlsx`);

  return { totalLinhas: aoa.length - 1, totalClientes: clientes.length };
}
