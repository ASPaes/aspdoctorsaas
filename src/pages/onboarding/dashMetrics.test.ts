import { describe, it, expect } from "vitest";
import { pct, separarJornadas, contarSituacao, type JourneyLite } from "./dashMetrics";

/** Espelha a Digi Office em 02/08/2026: 22 em andamento, 15 não iniciadas, 8 canceladas, 4 concluídas. */
function j(situacao: string, aberta_em: string | null, id = Math.random().toString()): JourneyLite {
  return { journey_id: id, situacao, aberta_em };
}

const JULHO = { from: new Date("2026-07-01T00:00:00"), to: new Date("2026-07-31T00:00:00") };
const AGOSTO = { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-31T00:00:00") };

const digiOffice: JourneyLite[] = [
  ...Array.from({ length: 22 }, (_, i) => j("em_andamento", "2026-07-10T12:00:00Z", `a${i}`)),
  ...Array.from({ length: 15 }, (_, i) => j("nao_iniciado", "2026-07-12T12:00:00Z", `b${i}`)),
  ...Array.from({ length: 8 }, (_, i) => j("cancelado", "2026-07-14T12:00:00Z", `c${i}`)),
  ...Array.from({ length: 4 }, (_, i) => j("concluido", "2026-07-20T12:00:00Z", `d${i}`)),
];

describe("pct", () => {
  it("devolve 0 quando o denominador é 0, em vez de NaN", () => {
    expect(pct(3, 0)).toBe(0);
  });

  it("arredonda para uma casa decimal", () => {
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("separarJornadas", () => {
  it("tira as canceladas de 'ativas'", () => {
    expect(separarJornadas(digiOffice, JULHO).ativas.length).toBe(41);
  });

  it("recorta 'periodo' por data de abertura, já sem as canceladas", () => {
    expect(separarJornadas(digiOffice, JULHO).periodo.length).toBe(41);
  });

  it("devolve periodo vazio quando nenhuma jornada foi aberta no intervalo", () => {
    // Todas as 49 foram abertas em julho; o dash abre em agosto.
    expect(separarJornadas(digiOffice, AGOSTO).periodo.length).toBe(0);
    // ...mas 'ativas' não depende do período e continua inteiro.
    expect(separarJornadas(digiOffice, AGOSTO).ativas.length).toBe(41);
  });

  it("inclui o último dia inteiro do intervalo, não só a meia-noite", () => {
    const tarde = [j("em_andamento", "2026-07-31T23:30:00Z")];
    expect(separarJornadas(tarde, JULHO).periodo.length).toBe(1);
  });

  it("descarta jornada sem data de abertura do recorte de período", () => {
    const semData = [j("em_andamento", null)];
    expect(separarJornadas(semData, JULHO).periodo.length).toBe(0);
    expect(separarJornadas(semData, JULHO).ativas.length).toBe(1);
  });
});

describe("contarSituacao", () => {
  it("soma 'parado' junto com em aberto", () => {
    const c = contarSituacao([...digiOffice, j("parado", "2026-07-15T12:00:00Z")]);
    expect(c.emAberto).toBe(38);
    expect(c.paradas).toBe(1);
  });

  it("reproduz a Digi Office: 37 em aberto, 4 concluídas, 8 canceladas", () => {
    const c = contarSituacao(digiOffice);
    expect(c.total).toBe(49);
    expect(c.emAberto).toBe(37);
    expect(c.emAndamento).toBe(22);
    expect(c.naoIniciadas).toBe(15);
    expect(c.concluidas).toBe(4);
    expect(c.canceladas).toBe(8);
    expect(c.pctCanceladas).toBe(16.3);
  });

  it("não quebra com lista vazia", () => {
    const c = contarSituacao([]);
    expect(c.total).toBe(0);
    expect(c.pctCanceladas).toBe(0);
  });

  it("ignora situação desconhecida em vez de contar como aberta", () => {
    const c = contarSituacao([j("situacao_nova_do_futuro", "2026-07-01T12:00:00Z")]);
    expect(c.total).toBe(1);
    expect(c.emAberto).toBe(0);
  });
});
