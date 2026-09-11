import { describe, it, expect } from "vitest";
import { responsaveisNaJanela, criarResolvedorResponsavel, type PeriodoResponsavel } from "./responsavelNaJanela";

/** Fabianne pega na distribuição e passa para o Igor no dia 3. */
const periodos: PeriodoResponsavel[] = [
  { userId: "fabianne", de: "2026-09-01T12:00:00Z", ate: "2026-09-03T12:00:00Z" },
  { userId: "igor", de: "2026-09-03T12:00:00Z", ate: null },
];

describe("responsaveisNaJanela", () => {
  it("janela inteira dentro de uma posse devolve só essa pessoa", () => {
    expect(responsaveisNaJanela(periodos, "2026-09-01T13:00:00Z", "2026-09-02T09:00:00Z")).toEqual(["fabianne"]);
  });

  it("janela depois da troca devolve só quem assumiu", () => {
    expect(responsaveisNaJanela(periodos, "2026-09-04T09:00:00Z", "2026-09-05T09:00:00Z")).toEqual(["igor"]);
  });

  it("janela que atravessa a troca devolve os dois, em ordem", () => {
    expect(responsaveisNaJanela(periodos, "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z")).toEqual(["fabianne", "igor"]);
  });

  it("sem fim, a janela corre até agora e alcança quem está com ela", () => {
    expect(responsaveisNaJanela(periodos, "2026-09-04T09:00:00Z", null)).toEqual(["igor"]);
  });

  it("sem início não há janela para cruzar", () => {
    expect(responsaveisNaJanela(periodos, null, "2026-09-04T09:00:00Z")).toEqual([]);
  });

  it("instante exato da distribuição pega quem recebeu, não o vazio", () => {
    expect(responsaveisNaJanela(periodos, "2026-09-01T12:00:00Z", "2026-09-01T12:00:00Z")).toEqual(["fabianne"]);
  });

  it("sem histórico devolve vazio (quem chama cai no responsável atual)", () => {
    expect(responsaveisNaJanela([], "2026-09-01T12:00:00Z", "2026-09-02T12:00:00Z")).toEqual([]);
  });
});

describe("criarResolvedorResponsavel", () => {
  const nomes: Record<string, string> = { fabianne: "Fabianne", igor: "Igor" };
  const resolver = criarResolvedorResponsavel(
    { j1: periodos },
    (id) => nomes[id] ?? "—",
    () => "Responsável atual",
  );

  it("troca no meio da janela aparece como handoff, sem esconder ninguém", () => {
    expect(resolver("j1", "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z")).toBe("Fabianne → Igor");
  });

  it("uma pessoa só sai igual a antes", () => {
    expect(resolver("j1", "2026-09-01T13:00:00Z", "2026-09-02T09:00:00Z")).toBe("Fabianne");
  });

  it("jornada sem histórico cai no responsável atual, nunca em '—'", () => {
    expect(resolver("j-sem-historico", "2026-09-01T13:00:00Z", null)).toBe("Responsável atual");
  });
});
