import * as XLSX from "xlsx";
import { dataCell, hojeISO } from "@/lib/xlsxExport";
import type { NovoClienteListItem } from "@/components/dashboard/types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: number): number {
  return Number.isFinite(v) ? round2(v) : 0;
}

/** Índice da coluna "Data Venda" no cabeçalho abaixo. */
const COL_DATA = 2;

export function exportNovosClientesXlsx(items: NovoClienteListItem[]): void {
  const header = [
    "Razão Social",
    "Nome Fantasia",
    "Data Venda",
    "Vendedor",
    "Origem",
    "Vlr Ativação (R$)",
    "Vlr MRR (R$)",
  ];

  const aoa: any[][] = [header];

  for (const c of items) {
    aoa.push([
      c.razaoSocial ?? "",
      c.nomeFantasia ?? "",
      dataCell(c.dataVenda),
      c.vendedor ?? "",
      c.origem ?? "",
      numCell(c.valorAtivacao),
      numCell(c.mensalidade),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 40 }, // Razão Social
    { wch: 30 }, // Nome Fantasia
    { wch: 12 }, // Data Venda
    { wch: 20 }, // Vendedor
    { wch: 24 }, // Origem
    { wch: 16 }, // Vlr Ativação
    { wch: 16 }, // Vlr MRR
  ];

  // A data é um serial numérico, então o formato vai POR COLUNA. Varrer por
  // `cell.t === "n"` carimbaria de data as colunas de valor também.
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: COL_DATA })];
    if (cell) cell.z = "dd/mm/yyyy";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Novos Clientes");

  XLSX.writeFile(wb, `novos_clientes_${hojeISO()}.xlsx`);
}
