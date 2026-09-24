import { describe, it, expect } from "vitest";
import {
  responsaveisNaJanela, responsaveisRelevantesNaJanela, criarResolvedorResponsavel, criarRecorteResponsavel,
  type PeriodoResponsavel,
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

  it("troca no meio da janela aparece como handoff, com o tempo de cada um", () => {
    expect(resolver("j1", "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z")).toBe("Fabianne\u00A0(1d 23h) → Igor\u00A0(21h)");
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

describe("responsaveisRelevantesNaJanela", () => {
  /** DEM-0471: mudar de etapa e passar a jornada adiante são dois cliques seguidos. */
  it("o caso SKETCH PARAGEM: 34s de posse numa etapa de 7 dias fica fora da média", () => {
    const sketch: PeriodoResponsavel[] = [
      { userId: "fabianne", de: "2026-09-10T16:45:15Z", ate: "2026-09-10T17:24:28Z" },
      { userId: "geice", de: "2026-09-10T17:24:28Z", ate: "2026-09-17T19:59:34Z" },
    ];
    // Recolhimento Dados: entrou 34s antes de a Fabianne largar a jornada.
    expect(responsaveisRelevantesNaJanela(sketch, "2026-09-10T17:23:54Z", "2026-09-17T17:24:31Z")).toEqual(["geice"]);
    // A pergunta crua continua respondendo as duas: o histórico não foi apagado.
    expect(responsaveisNaJanela(sketch, "2026-09-10T17:23:54Z", "2026-09-17T17:24:31Z")).toEqual(["fabianne", "geice"]);
  });

  it("o caso WAVE DRINKS: 70s numa etapa de 4h43m também fica fora", () => {
    const wave: PeriodoResponsavel[] = [
      { userId: "fabianne", de: "2026-09-08T23:50:12Z", ate: "2026-09-09T12:01:11Z" },
      { userId: "geice", de: "2026-09-09T12:01:11Z", ate: "2026-09-09T19:16:22Z" },
    ];
    expect(responsaveisRelevantesNaJanela(wave, "2026-09-09T12:00:00Z", "2026-09-09T16:43:32Z")).toEqual(["geice"]);
  });

  it("troca no meio da janela continua mostrando os dois", () => {
    expect(responsaveisRelevantesNaJanela(periodos, "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z"))
      .toEqual(["fabianne", "igor"]);
  });

  it("1h numa etapa de 7 dias é trabalho: entra pelos 5 minutos, não pela fatia", () => {
    const p: PeriodoResponsavel[] = [
      { userId: "fabianne", de: "2026-09-01T12:00:00Z", ate: "2026-09-01T13:00:00Z" },
      { userId: "igor", de: "2026-09-01T13:00:00Z", ate: null },
    ];
    expect(responsaveisRelevantesNaJanela(p, "2026-09-01T12:00:00Z", "2026-09-08T12:00:00Z"))
      .toEqual(["fabianne", "igor"]);
  });

  it("3 minutos numa etapa de 20 é trabalho: entra pela fatia, não pelos 5 minutos", () => {
    const p: PeriodoResponsavel[] = [
      { userId: "fabianne", de: "2026-09-01T11:00:00Z", ate: "2026-09-01T12:03:00Z" },
      { userId: "igor", de: "2026-09-01T12:03:00Z", ate: null },
    ];
    expect(responsaveisRelevantesNaJanela(p, "2026-09-01T12:00:00Z", "2026-09-01T12:20:00Z"))
      .toEqual(["fabianne", "igor"]);
  });

  it("janela curta: todo mundo cobre fatia grande dela, ninguém é ruído", () => {
    const p: PeriodoResponsavel[] = [
      { userId: "fabianne", de: "2026-09-01T11:00:00Z", ate: "2026-09-01T12:00:02Z" },
      { userId: "igor", de: "2026-09-01T12:00:02Z", ate: null },
    ];
    expect(responsaveisRelevantesNaJanela(p, "2026-09-01T12:00:00Z", "2026-09-01T12:00:03Z"))
      .toEqual(["fabianne", "igor"]);
  });

  it("posse única abaixo do corte não some: sobra ela, nunca vazio", () => {
    // Histórico que acaba 30s depois de a etapa começar — resto do dia sem carimbo.
    const p: PeriodoResponsavel[] = [{ userId: "fabianne", de: "2026-09-01T11:00:00Z", ate: "2026-09-01T12:00:30Z" }];
    expect(responsaveisRelevantesNaJanela(p, "2026-09-01T12:00:00Z", "2026-09-02T12:00:00Z")).toEqual(["fabianne"]);
  });

  it("sem histórico devolve vazio (quem chama cai no responsável atual)", () => {
    expect(responsaveisRelevantesNaJanela([], "2026-09-01T12:00:00Z", "2026-09-02T12:00:00Z")).toEqual([]);
  });
});

describe("nome repetido no mesmo rótulo", () => {
  /** Reatribuir a jornada a quem já era o dono abre uma posse nova no histórico. */
  const reatribuida: PeriodoResponsavel[] = [
    { userId: "amanda", de: "2026-09-01T12:00:00Z", ate: "2026-09-02T12:00:00Z" },
    { userId: "amanda", de: "2026-09-02T12:00:00Z", ate: "2026-09-03T12:00:00Z" },
    { userId: "igor", de: "2026-09-03T12:00:00Z", ate: null },
  ];

  it("a mesma pessoa duas vezes seguidas vira uma", () => {
    expect(responsaveisRelevantesNaJanela(reatribuida, "2026-09-01T13:00:00Z", "2026-09-02T18:00:00Z"))
      .toEqual(["amanda"]);
  });

  it("a troca de verdade continua visível depois do vinco", () => {
    expect(responsaveisRelevantesNaJanela(reatribuida, "2026-09-01T13:00:00Z", "2026-09-04T09:00:00Z"))
      .toEqual(["amanda", "igor"]);
  });
});

describe("o rótulo do drill-down com os dois nomes (DEM-0471)", () => {
  const nomes: Record<string, string> = { fabianne: "Fabianne", geice: "Geice" };
  /** Carimbos reais da SKETCH PARAGEM: a posse trocou 34s DEPOIS de a etapa começar. */
  const sketch: PeriodoResponsavel[] = [
    { userId: "fabianne", de: "2026-09-10T16:45:15Z", ate: "2026-09-10T17:24:28Z" },
    { userId: "geice", de: "2026-09-10T17:24:28Z", ate: "2026-09-17T19:59:34Z" },
  ];
  const resolver = criarResolvedorResponsavel({ sketch }, (id) => nomes[id] ?? "—", () => "Responsável atual");

  it("o encosto de 34s aparece nomeado, e o tempo explica por que ele está ali", () => {
    expect(resolver("sketch", "2026-09-10T17:23:54Z", "2026-09-17T17:24:31Z")).toBe("Fabianne\u00A0(<1min) → Geice\u00A0(7d)");
  });

  it("sem troca de mão o tempo não aparece: ele repetiria a coluna ao lado", () => {
    expect(resolver("sketch", "2026-09-11T09:00:00Z", "2026-09-12T09:00:00Z")).toBe("Geice");
  });
});
