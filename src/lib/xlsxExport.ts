import * as XLSX from "xlsx";

/**
 * Base comum de exportação para Excel.
 *
 * Existiam 5 helpers `export*Xlsx.ts` repetindo o mesmo miolo (montar a matriz,
 * definir larguras, cortar o nome da aba, disparar o download). Este arquivo
 * concentra esse miolo para que uma listagem nova precise descrever só as
 * colunas e as linhas. Os helpers antigos continuam como estão; migrar cada um
 * é um passo separado.
 */

export interface ColunaPlanilha {
  /** Texto do cabeçalho. Espelha o rótulo da coluna na tela. */
  header: string;
  /** Largura em caracteres. Sem isso o Excel abre tudo com 8 e corta o texto. */
  wch?: number;
  /** Formato numérico do Excel, ex. "dd/mm/yyyy" ou "#,##0.00". */
  z?: string;
}

export type CelulaPlanilha = string | number | Date | null | undefined;

/** Tira acento e pontuação para compor nome de arquivo previsível. */
export function slugArquivo(s: string, fallback = "export"): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || fallback
  );
}

/**
 * Data de hoje em 'YYYY-MM-DD' pelo fuso do navegador. `toISOString()` daria o
 * dia seguinte depois das 21h em America/Sao_Paulo, e o arquivo sairia datado
 * de amanhã.
 */
export function hojeISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Converte 'YYYY-MM-DD' no NÚMERO DE SÉRIE de data do Excel, não num `Date`.
 *
 * Passar `Date` para o xlsx 0.18.5 não funciona em America/Sao_Paulo. Ele
 * corrige o valor pela diferença entre o fuso de hoje (-03:00) e o do marco
 * zero de 1899 (o meridiano local do Rio, -03:06:28), e o serial sai alguns
 * segundos ABAIXO do inteiro. O Excel trunca a fração e mostra o dia anterior.
 * Medido em 21/09/2026: 05/01/2026 saía 04/01/2026 — com o `Date` montado em
 * UTC e também em hora local. Montar em UTC não salva.
 *
 * O inteiro calculado à mão é imune a fuso. A conta bate com o Excel a partir
 * de 01/03/1900 (serial 61); antes disso o Excel carrega o 29/02/1900 que nunca
 * existiu, e nenhum dado do sistema chega lá.
 */
export function dataCell(v: string | null | undefined): number | "" {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return "";
  return Math.round(
    (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000,
  );
}

/** Monta a planilha e dispara o download. Uma aba só. */
export function baixarPlanilha(params: {
  colunas: ColunaPlanilha[];
  linhas: CelulaPlanilha[][];
  /** Nome da aba. O Excel aceita 31 caracteres e recusa : \ / ? * [ ] */
  aba: string;
  /** Nome do arquivo, com a extensão .xlsx */
  arquivo: string;
}): void {
  const { colunas, linhas, aba, arquivo } = params;

  const aoa: CelulaPlanilha[][] = [colunas.map((c) => c.header), ...linhas];
  const ws = XLSX.utils.aoa_to_sheet(aoa as any[][], { cellDates: true });

  ws["!cols"] = colunas.map((c) => ({ wch: c.wch ?? 18 }));

  const formatadas = colunas
    .map((c, i) => ({ i, z: c.z }))
    .filter((c): c is { i: number; z: string } => !!c.z);

  if (formatadas.length && ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = 1; R <= range.e.r; R++) {
      for (const { i, z } of formatadas) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: i })];
        if (cell) cell.z = z;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba.replace(/[:\/?*[\]]/g, " ").slice(0, 31));
  XLSX.writeFile(wb, arquivo);
}
