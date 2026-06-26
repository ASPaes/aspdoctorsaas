import * as XLSX from "xlsx";

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

export function exportMovimentosMrrXlsx(params: {
  rows: any[];
  clientesMap: Record<string, string>;
  funcMap: Record<number, string>;
  fornecedorMap: Map<number, string>;
}): void {
  const { rows, clientesMap, funcMap, fornecedorMap } = params;

  const header = [
    "Data",
    "Tipo",
    "Cliente",
    "Valor (R$)",
    "Custo Delta (R$)",
    "Funcionário",
    "Fornecedor",
    "Origem da Venda",
    "Descrição",
  ];

  const aoa: any[][] = [header];

  for (const m of rows) {
    const valor = m.tipo === "venda_avulsa" ? m.valor_venda_avulsa : m.valor_delta;
    aoa.push([
      dateCell(m.data_movimento) ?? "",
      tipoLabels[m.tipo] || m.tipo || "",
      clientesMap[m.cliente_id] ?? "",
      numCellAlways(valor) ?? "",
      numCell(m.custo_delta) ?? "",
      m.funcionario_id ? (funcMap[m.funcionario_id] ?? "") : "",
      m.fornecedor_id ? (fornecedorMap.get(m.fornecedor_id) ?? "") : "",
      m.origem_venda ?? "",
      m.descricao ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  ws["!cols"] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 30 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 40 },
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
  XLSX.utils.book_append_sheet(wb, ws, "Movimentos MRR");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `movimentos_mrr_export_${today}.xlsx`);
}
