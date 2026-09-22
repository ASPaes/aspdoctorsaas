import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { dataCell, hojeISO, slugArquivo } from "./xlsxExport";

/**
 * O que estes testes seguram: a data do Excel saía um dia atrás em
 * America/Sao_Paulo, e o erro era silencioso — a planilha abre, as datas
 * parecem plausíveis, e ninguém confere linha a linha.
 *
 * A verificação é feita como o Excel faz: renderizando o valor da célula com o
 * formato da célula (`XLSX.SSF.format`). Conferir só o número não pegaria o
 * caso, porque o problema é a fração que o Excel trunca.
 */
describe("dataCell", () => {
  it("converte 'YYYY-MM-DD' no serial inteiro do Excel", () => {
    expect(dataCell("2026-01-05")).toBe(46027);
    expect(dataCell("2026-09-17")).toBe(46282);
    expect(dataCell("1900-03-01")).toBe(61);
  });

  it("devolve vazio para valor ausente ou fora do formato", () => {
    expect(dataCell(null)).toBe("");
    expect(dataCell(undefined)).toBe("");
    expect(dataCell("")).toBe("");
    expect(dataCell("17/09/2026")).toBe("");
  });

  it("ignora a parte de hora quando vem timestamp", () => {
    expect(dataCell("2026-09-17T23:30:00Z")).toBe(dataCell("2026-09-17"));
  });

  it("o Excel exibe o MESMO dia que entrou, e não o anterior", () => {
    const dias = ["2026-01-05", "2026-03-01", "2025-12-31", "2026-09-17"];
    const ws = XLSX.utils.aoa_to_sheet([["Data"], ...dias.map((d) => [dataCell(d)])]);
    for (let r = 1; r <= dias.length; r++) {
      ws[XLSX.utils.encode_cell({ r, c: 0 })].z = "dd/mm/yyyy";
    }
    // Round-trip pelo arquivo: é o caminho que o Excel percorre.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "t");
    const lido = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), {
      cellNF: true,
    }).Sheets["t"];

    const exibido = dias.map((_, i) => {
      const cell = lido[XLSX.utils.encode_cell({ r: i + 1, c: 0 })];
      return XLSX.SSF.format(cell.z as string, cell.v as number);
    });

    expect(exibido).toEqual(["05/01/2026", "01/03/2026", "31/12/2025", "17/09/2026"]);
  });

  it("um objeto Date, o jeito antigo, exibiria o dia anterior", () => {
    // Guarda de documentação: se um dia o xlsx corrigir isso, este teste falha e
    // avisa que o serial calculado à mão deixou de ser necessário.
    const ws = XLSX.utils.aoa_to_sheet([["Data"], [new Date(Date.UTC(2026, 0, 5))]], {
      cellDates: true,
    });
    const cell = ws[XLSX.utils.encode_cell({ r: 1, c: 0 })];
    expect(Number.isInteger(cell.v)).toBe(false);
    expect(XLSX.SSF.format("dd/mm/yyyy", cell.v as number)).toBe("04/01/2026");
  });
});

describe("hojeISO", () => {
  it("usa o dia local, nao o UTC", () => {
    // 21/09 às 22h em America/Sao_Paulo já é 22/09 em UTC. `toISOString()`
    // carimbaria o arquivo com o dia seguinte.
    const noite = new Date(2026, 8, 21, 22, 30);
    expect(hojeISO(noite)).toBe("2026-09-21");
  });
});

describe("slugArquivo", () => {
  it("tira acento e pontuacao", () => {
    expect(slugArquivo("Conferência · Onboarding PDV")).toBe("conferencia_onboarding_pdv");
  });

  it("cai no fallback quando nao sobra nada", () => {
    expect(slugArquivo("···", "export")).toBe("export");
  });
});
