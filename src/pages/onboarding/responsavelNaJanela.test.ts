import { describe, it, expect } from "vitest";
import {
  responsaveisNaJanela, criarResolvedorResponsavel, criarRecorteResponsavel, type PeriodoResponsavel,
} from "./responsavelNaJanela";

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

describe("criarRecorteResponsavel", () => {
  it("sem filtro, toda janela passa", () => {
    const vale = criarRecorteResponsavel({ j1: periodos }, []);
    expect(vale("j1", "2026-09-01T13:00:00Z", "2026-09-02T09:00:00Z")).toBe(true);
  });

  it("o caso Natural Aires: a janela é de quem fez, não de quem assumiu depois", () => {
    // Amanda recebe e faz o contato; Fabianne assume 3 dias depois.
    const natural: PeriodoResponsavel[] = [
      { userId: "amanda", de: "2026-09-08T18:43:00Z", ate: "2026-09-11T14:19:00Z" },
      { userId: "fabianne", de: "2026-09-11T14:19:00Z", ate: null },
    ];
    const soFabianne = criarRecorteResponsavel({ j: natural }, ["fabianne"]);
    // 1º contato: distribuição -> 1ª mensagem, ainda na mão da Amanda.
    expect(soFabianne("j", "2026-09-08T18:43:00Z", "2026-09-08T20:33:00Z")).toBe(false);
    // Tempo total: a janela é a jornada inteira e alcança a Fabianne.
    expect(soFabianne("j", "2026-09-08T18:43:00Z", null)).toBe(true);
  });

  it("janela que atravessa a troca vale para os dois", () => {
    expect(criarRecorteResponsavel({ j1: periodos }, ["fabianne"])("j1", "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z")).toBe(true);
    expect(criarRecorteResponsavel({ j1: periodos }, ["igor"])("j1", "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z")).toBe(true);
  });

  it("jornada sem histórico passa — ela só chegou aqui porque o dono atual bateu", () => {
    expect(criarRecorteResponsavel({}, ["fabianne"])("j-sem-historico", "2026-09-01T13:00:00Z", null)).toBe(true);
  });
});
