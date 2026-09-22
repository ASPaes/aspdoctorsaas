import * as XLSX from "xlsx";
import type { NovoClienteListItem } from "@/components/dashboard/types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numCell(v: number): number {
  return Number.isFinite(v) ? round2(v) : 0;
}

/** Serial do Excel do dia 1899-12-30, a origem da contagem de datas da planilha. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * `dataVenda` vem de uma coluna `date` ('YYYY-MM-DD') e vira o numero de serie do
 * Excel calculado a mao, nao um `Date`.
 *
 * Nao entregue um `Date` ao SheetJS aqui: ele converte usando o offset de fuso
 * de 1899 e, em America/Sao_Paulo, o serial sai 28 segundos ANTES da meia-noite
 * (medido: 46281,99967 para 17/09/2026). Com formato `dd/mm/yyyy` a planilha
 * mostra o dia anterior em todas as linhas.
 */
function dateSerial(v: string): number | "" {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return "";
  const dias = (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EXCEL_EPOCH) / 86400000;
  return Math.round(dias);
}

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
      dateSerial(c.dataVenda),
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

  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 1; R <= range.e.r; R++) {
    const addr = XLSX.utils.encode_cell({ r: R, c: 2 });
    const cell = ws[addr];
    // A celula e numerica (serial); o formato e o que faz o Excel exibir data.
    if (cell && cell.t === "n") cell.z = "dd/mm/yyyy";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Novos Clientes");

  // Data LOCAL: `toISOString()` e UTC e, exportando a noite em America/Sao_Paulo,
  // o arquivo sairia carimbado com o dia seguinte.
  const now = new Date();
  const hoje = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `novos_clientes_${hoje}.xlsx`);
}
