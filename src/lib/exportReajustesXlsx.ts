import * as XLSX from "xlsx";
import { format, parseISO } from "date-fns";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round2(n);
}

function dateOnlyCell(v: any): Date | undefined {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const [y, mo, da] = s.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, da));
}

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
      dateOnlyCell(r.periodo_inicio) ?? "",
      dateOnlyCell(r.periodo_fim) ?? "",
      numCell(r.percentual_padrao) ?? "",
      r.qtd_contratos ?? "",
      numCell(r.vlr_mensal_total_antes) ?? "",
      numCell(r.vlr_reajuste_total) ?? "",
      numCell(r.vlr_mensal_total_depois) ?? "",
      r.status ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

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

  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && cell.t === "d") {
        cell.z = "dd/mm/yyyy";
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reajustes");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `reajustes_export_${today}.xlsx`);
}
