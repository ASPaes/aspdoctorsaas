import * as XLSX from "xlsx";
import { dataCell, hojeISO } from "@/lib/xlsxExport";

const tipoLabels: Record<string, string> = {
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  downsell: "Downsell",
  venda_avulsa: "Venda Avulsa",
  reactivation: "Reativação",
  reajuste: "Reajuste",
  churn: "Churn",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return round2(n);
}

function numCellAlways(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round2(n);
}

/** Índice da coluna "Data" no cabeçalho abaixo. Só ela leva formato de data. */
const COL_DATA = 0;

export interface ClienteInfo {
  razao: string;
  fantasia: string;
  /** Já formatado (00.000.000/0000-00). */
  cnpj: string;
}

export function exportMovimentosMrrXlsx(params: {
  rows: any[];
  clientesMap: Record<string, ClienteInfo>;
  funcMap: Record<number, string>;
  fornecedorMap: Map<number, string>;
}): void {
  const { rows, clientesMap, funcMap, fornecedorMap } = params;

  const header = [
    "Data",
    "Tipo",
    "Razão Social",
    "Nome Fantasia",
    "CNPJ",
    "Valor (R$)",
    "Ativação (R$)",
    "Custo Delta (R$)",
    "Funcionário",
    "Fornecedor",
    "Origem da Venda",
    "Descrição",
  ];

  const aoa: any[][] = [header];

  for (const m of rows) {
    const valor = m.tipo === "venda_avulsa" ? m.valor_venda_avulsa : m.valor_delta;
    const cli = clientesMap[m.cliente_id];
    aoa.push([
      dataCell(m.data_movimento),
      tipoLabels[m.tipo] || m.tipo || "",
      cli?.razao ?? "",
      cli?.fantasia ?? "",
      cli?.cnpj ?? "",
      numCellAlways(valor) ?? "",
      // Coluna própria: ativação é cobrança única e somá-la ao Valor faria a
      // planilha totalizar MRR com one-time.
      numCell(m.vlr_ativacao) ?? "",
      numCell(m.custo_delta) ?? "",
      m.funcionario_id ? (funcMap[m.funcionario_id] ?? "") : "",
      // fornecedor_efetivo é o que a tela filtra e o que fornecedorMap indexa;
      // fornecedor_id nem vem no select da view, então saía sempre vazio.
      m.fornecedor_efetivo ? (fornecedorMap.get(m.fornecedor_efetivo) ?? "") : "",
      m.origem_venda ?? "",
      m.descricao ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 12 },  // Data
    { wch: 14 },  // Tipo
    { wch: 34 },  // Razão Social
    { wch: 28 },  // Nome Fantasia
    { wch: 20 },  // CNPJ
    { wch: 14 },  // Valor
    { wch: 14 },  // Ativação
    { wch: 14 },  // Custo Delta
    { wch: 20 },  // Funcionário
    { wch: 20 },  // Fornecedor
    { wch: 18 },  // Origem da Venda
    { wch: 40 },  // Descrição
  ];

  // A data é um serial numérico, então o formato vai POR COLUNA. Varrer por
  // `cell.t === "n"` carimbaria de data as colunas de valor também.
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: COL_DATA })];
    if (cell) cell.z = "dd/mm/yyyy";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimentos MRR");

  // `toISOString()` e UTC: exportando a noite em America/Sao_Paulo o arquivo
  // saia carimbado com o dia seguinte.
  const today = hojeISO();
  XLSX.writeFile(wb, `movimentos_mrr_export_${today}.xlsx`);
}
