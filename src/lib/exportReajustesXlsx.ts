import * as XLSX from "xlsx";
import { format, parseISO } from "date-fns";
import { dataCell, hojeISO } from "@/lib/xlsxExport";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round2(n);
}

/** Índices de "Período Início" e "Período Fim" no cabeçalho abaixo. */
const COLS_DATA = [2, 3];

function formatLancamento(v: any): string {
  if (!v) return "";
  try {
    return format(parseISO(String(v)), "dd/MM/yyyy HH:mm");
  } catch {
    return "";
  }
}

export function exportReajustesXlsx(params: { rows: any[] }): void {
  const { rows } = params;

  const header = [
    "Data Lançamento",
    "Usuário",
    "Período Início",
    "Período Fim",
    "% Padrão",
    "Qtd Contratos",
    "MRR Antes (R$)",
    "Delta Reajuste (R$)",
    "MRR Depois (R$)",
    "Status",
  ];

  const aoa: any[][] = [header];

  for (const r of rows) {
    aoa.push([
      formatLancamento(r.data_lancamento),
      r.usuario_nome ?? "",
      dataCell(r.periodo_inicio),
      dataCell(r.periodo_fim),
      numCell(r.percentual_padrao) ?? "",
      r.qtd_contratos ?? "",
      numCell(r.vlr_mensal_total_antes) ?? "",
      numCell(r.vlr_reajuste_total) ?? "",
      numCell(r.vlr_mensal_total_depois) ?? "",
      r.status ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
  ];

  // A data é um serial numérico, então o formato vai POR COLUNA. Varrer por
  // `cell.t === "n"` carimbaria de data as colunas de valor também.
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of COLS_DATA) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell) cell.z = "dd/mm/yyyy";
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reajustes");

  // `toISOString()` e UTC: exportando a noite em America/Sao_Paulo o arquivo
  // saia carimbado com o dia seguinte.
  const today = hojeISO();
  XLSX.writeFile(wb, `reajustes_export_${today}.xlsx`);
}
