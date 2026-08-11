import { describe, it, expect } from "vitest";
import {
  pct, separarJornadas, contarSituacao, desfechoTreino, agregarTreinos,
  type JourneyLite, type TreinoLite,
} from "./dashMetrics";

/** Espelha a Digi Office em 02/08/2026: 22 em andamento, 15 não iniciadas, 8 canceladas, 4 concluídas. */
function j(
  situacao: string,
  aberta_em: string | null,
  id = Math.random().toString(),
  concluido_em: string | null = null,
): JourneyLite {
  return { journey_id: id, situacao, aberta_em, concluido_em };
}

const JULHO = { from: new Date("2026-07-01T00:00:00"), to: new Date("2026-07-31T00:00:00") };
const AGOSTO = { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-31T00:00:00") };

const digiOffice: JourneyLite[] = [
  ...Array.from({ length: 22 }, (_, i) => j("em_andamento", "2026-07-10T12:00:00Z", `a${i}`)),
  ...Array.from({ length: 15 }, (_, i) => j("nao_iniciado", "2026-07-12T12:00:00Z", `b${i}`)),
  ...Array.from({ length: 8 }, (_, i) => j("cancelado", "2026-07-14T12:00:00Z", `c${i}`)),
  ...Array.from({ length: 4 }, (_, i) => j("concluido", "2026-07-20T12:00:00Z", `d${i}`, "2026-07-25T12:00:00Z")),
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

  it("pega todas as jornadas que estavam vivas no intervalo", () => {
    expect(separarJornadas(digiOffice, JULHO).periodo.length).toBe(41);
  });

  it("jornada aberta antes do intervalo e AINDA rodando continua no período", () => {
    // O caso que motivou a regra: 37 jornadas abertas em julho seguem em aberto,
    // com SLA correndo agora. Recortar por data de abertura zerava a tela em agosto.
    const r = separarJornadas(digiOffice, AGOSTO);
    expect(r.periodo.length).toBe(37);
    expect(r.ativas.length).toBe(41);
  });

  it("jornada concluída antes do início do intervalo fica de fora", () => {
    // As 4 concluídas em 25/07 não têm mais SLA em disputa em agosto.
    const ids = separarJornadas(digiOffice, AGOSTO).periodo.map((x) => x.journey_id);
    expect(ids.some((id) => id.startsWith("d"))).toBe(false);
  });

  it("jornada aberta depois do fim do intervalo fica de fora", () => {
    const futura = [j("em_andamento", "2026-09-10T12:00:00Z")];
    expect(separarJornadas(futura, AGOSTO).periodo.length).toBe(0);
  });

  it("inclui o último dia inteiro do intervalo, não só a meia-noite", () => {
    const tarde = [j("em_andamento", "2026-07-31T23:30:00Z")];
    expect(separarJornadas(tarde, JULHO).periodo.length).toBe(1);
  });

  it("uma jornada que atravessa o intervalo inteiro entra", () => {
    const atravessa = [j("em_andamento", "2026-05-01T12:00:00Z")];
    expect(separarJornadas(atravessa, JULHO).periodo.length).toBe(1);
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

function t(p: Partial<TreinoLite> = {}): TreinoLite {
  return {
    status: "realizado",
    no_show: false,
    no_shows: 0,
    is_retreinamento: false,
    proprietario_presente: null,
    conta_como_pdv: false,
    tentativas: 0,
    ...p,
  };
}

describe("desfechoTreino", () => {
  it("mapeia previsto e agendado para em_aberto", () => {
    expect(desfechoTreino("previsto")).toBe("em_aberto");
    expect(desfechoTreino("agendado")).toBe("em_aberto");
  });

  it("trata status nulo como em_aberto", () => {
    expect(desfechoTreino(null)).toBe("em_aberto");
  });

  it("no_show é desfecho, vindo do status e não da flag", () => {
    expect(desfechoTreino("no_show")).toBe("no_show");
    expect(desfechoTreino("cancelado")).toBe("cancelado");
    expect(desfechoTreino("realizado")).toBe("realizado");
  });
});

describe("agregarTreinos", () => {
  /**
   * Gabarito medido em produção: Digi Office, julho/2026, já sem jornada cancelada.
   * 11 sessões — 9 realizadas, 0 com desfecho no-show, 1 cancelada, 1 em aberto.
   * 2 delas carregam a flag pegajosa (uma realizada na 3ª tentativa, uma reagendada).
   */
  const julhoDigiOffice: TreinoLite[] = [
    ...Array.from({ length: 7 }, () => t()),
    t({ proprietario_presente: true }),
    t({ no_show: true, tentativas: 3, proprietario_presente: true }), // realizada na 3ª
    t({ status: "cancelado" }),
    t({ status: "agendado", no_show: true, tentativas: 4 }), // reagendada, ainda em pé
  ];

  it("reproduz os desfechos da Digi Office", () => {
    const a = agregarTreinos(julhoDigiOffice);
    expect(a.realizado).toBe(9);
    expect(a.noShow).toBe(0);
    expect(a.cancelado).toBe(1);
    expect(a.emAberto).toBe(1);
    expect(a.validos).toBe(10);
  });

  it("a taxa de no-show mede treinos que faltaram, não desfecho parado em no_show", () => {
    // 2 dos 10 válidos tiveram falta. Pelo desfecho daria 0 — e a partir de 11/08 daria
    // 0 sempre, porque o no-show devolve o treino para `previsto` em vez de deixá-lo
    // parado em `no_show`.
    expect(agregarTreinos(julhoDigiOffice).noShowRate).toBe(20);
  });

  it("conta separado quem faltou ao menos uma vez", () => {
    expect(agregarTreinos(julhoDigiOffice).comFalta).toBe(2);
  });

  it("uma sessão realizada com falta não conta como falta e como realizada ao mesmo tempo", () => {
    const a = agregarTreinos([t({ no_show: true, no_shows: 1, tentativas: 3 })]);
    expect(a.realizado).toBe(1);
    expect(a.noShow).toBe(0); // desfecho continua vindo do status
    expect(a.comFalta).toBe(1);
    expect(a.faltas).toBe(1);
  });

  it("falta é contada pelo contador, não pelo status", () => {
    const a = agregarTreinos([
      t({ status: "realizado", no_shows: 2 }),  // faltou 2x e no fim aconteceu
      t({ status: "agendado", no_shows: 1 }),   // faltou 1x e já foi remarcado
      t({ status: "realizado", no_shows: 0 }),
    ]);
    expect(a.faltas).toBe(3);
    expect(a.comFalta).toBe(2);
    expect(a.noShowRate).toBe(66.7);
  });

  it("treino remarcado não apaga a falta do painel", () => {
    // O caso que a régua antiga perdia: status volta para agendado e o desfecho some.
    const a = agregarTreinos([t({ status: "agendado", no_show: true, no_shows: 1 })]);
    expect(a.faltas).toBe(1);
    expect(a.noShow).toBe(0);
  });

  it("cai na flag pegajosa quando o contador ainda não foi preenchido", () => {
    // Linhas anteriores ao backfill: no_show=true com no_shows=0.
    const a = agregarTreinos([t({ status: "no_show", no_show: true, no_shows: 0 })]);
    expect(a.faltas).toBe(1);
    expect(a.comFalta).toBe(1);
  });

  it("cancelado fica fora dos percentuais mas continua contado", () => {
    const a = agregarTreinos([t(), t({ status: "cancelado" }), t({ status: "cancelado" })]);
    expect(a.cancelado).toBe(2);
    expect(a.validos).toBe(1);
    expect(a.realizadoPct).toBe(100);
  });

  it("treino cancelado que teve falta conta como falta e como cancelado", () => {
    const a = agregarTreinos([t({ status: "cancelado", no_show: true, no_shows: 1, tentativas: 2 })]);
    expect(a.cancelado).toBe(1);
    expect(a.comFalta).toBe(1);
    expect(a.validos).toBe(0);
  });

  it("% realizado da Digi Office é 90, com o cancelado fora", () => {
    expect(agregarTreinos(julhoDigiOffice).realizadoPct).toBe(90);
  });

  it("retreinamento divide pelos válidos, não por tudo", () => {
    const a = agregarTreinos([t({ is_retreinamento: true }), t(), t({ status: "cancelado" })]);
    expect(a.retreinos).toBe(1);
    expect(a.retreinosPct).toBe(50);
  });

  it("proprietário presente divide só pelos informados", () => {
    const a = agregarTreinos(julhoDigiOffice);
    expect(a.propInformado).toBe(2);
    expect(a.propSim).toBe(2);
    expect(a.propPct).toBe(100);
  });

  it("proprietário presente devolve null quando ninguém informou", () => {
    // NULL é "não informado", não "ausente" — sem cobertura não existe percentual.
    const a = agregarTreinos([t(), t()]);
    expect(a.propInformado).toBe(0);
    expect(a.propPct).toBeNull();
  });

  it("conta o 'não' informado como cobertura, não como ausência de dado", () => {
    const a = agregarTreinos([t({ proprietario_presente: false }), t({ proprietario_presente: true })]);
    expect(a.propInformado).toBe(2);
    expect(a.propPct).toBe(50);
  });

  it("soma todas as faltas do mesmo treino", () => {
    const a = agregarTreinos([
      t({ status: "previsto", no_show: true, no_shows: 3 }),
      t({ no_show: true, no_shows: 1 }),
    ]);
    expect(a.faltas).toBe(4);
    expect(a.comFalta).toBe(2);
  });

  it("PDV conta só sessão realizada com o tipo marcado", () => {
    const a = agregarTreinos([
      t({ conta_como_pdv: true }),
      t({ status: "agendado", conta_como_pdv: true }),
      t({ status: "cancelado", conta_como_pdv: true }),
    ]);
    expect(a.pdvFinalizados).toBe(1);
  });

  it("não quebra com lista vazia", () => {
    const a = agregarTreinos([]);
    expect(a.validos).toBe(0);
    expect(a.noShowRate).toBe(0);
    expect(a.propPct).toBeNull();
  });
});
