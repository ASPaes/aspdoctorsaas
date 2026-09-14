import { describe, it, expect } from "vitest";
import { calcularPermanencia, type JourneyPermanencia, type TreinoPermanencia } from "./permanencia";

const HOJE = new Date(2026, 8, 13); // 13/09/2026, hora local

/** Jornada concluída mínima. `entrega` é a data de go-live (yyyy-MM-dd). */
function jc(
  journeyId: string,
  clienteId: string,
  entrega: string,
  responsavel: string | null = "u1",
): JourneyPermanencia {
  return {
    journey_id: journeyId,
    situacao: "concluido",
    cliente_id: clienteId,
    go_live_real: entrega,
    concluido_em: `${entrega}T15:00:00.000Z`,
    responsavel_user_id: responsavel,
  };
}

function entrada(
  journeys: JourneyPermanencia[],
  cancelamentoPorCliente: Record<string, string | null> = {},
) {
  return {
    journeys,
    cancelamentoPorCliente,
    periodosResponsavel: {},
    treinos: [] as TreinoPermanencia[],
    tipoTreinoId: null as string | null,
    hoje: HOJE,
    mesesJanela: 12 as const,
  };
}

describe("calcularPermanencia — entrada na coorte", () => {
  it("cliente com duas jornadas concluídas entra uma vez, pela mais antiga", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-07-16"), jc("j2", "c1", "2026-08-20")]),
    );
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0].entrega).toBe("2026-07-16");
    expect(r.clientes[0].coorte).toBe("2026-07");
    expect(r.clientes[0].journeyId).toBe("j1");
  });

  it("ignora jornada que não está concluída e jornada sem cliente", () => {
    const emAndamento: JourneyPermanencia = { ...jc("j9", "c9", "2026-07-16"), situacao: "em_andamento" };
    const semCliente: JourneyPermanencia = { ...jc("j8", "x", "2026-07-16"), cliente_id: null };
    const r = calcularPermanencia(entrada([emAndamento, semCliente, jc("j1", "c1", "2026-07-16")]));
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c1"]);
  });

  it("sem go_live_real, a entrega é o dia local de concluido_em", () => {
    const sem: JourneyPermanencia = { ...jc("j1", "c1", "2026-07-16"), go_live_real: null };
    const r = calcularPermanencia(entrada([sem]));
    expect(r.clientes[0].entrega).toBe("2026-07-16");
  });

  it("duas jornadas do mesmo cliente com a MESMA entrega desempatam por journey_id, não pela ordem do array", () => {
    const jA = jc("jA", "c1", "2026-07-16", "impl-a");
    const jB = jc("jB", "c1", "2026-07-16", "impl-b");
    const r1 = calcularPermanencia(entrada([jA, jB]));
    const r2 = calcularPermanencia(entrada([jB, jA]));
    expect(r1.clientes[0].journeyId).toBe("jA");
    expect(r1.clientes[0].implantadorId).toBe("impl-a");
    expect(r2.clientes[0].journeyId).toBe(r1.clientes[0].journeyId);
    expect(r2.clientes[0].implantadorId).toBe(r1.clientes[0].implantadorId);
  });
});

describe("calcularPermanencia — matriz de retenção", () => {
  it("célula imatura é null, nunca 100%", () => {
    // Entrega há 24 dias: M0 está maduro, M1 em diante não.
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-08-20")]));
    const coorte = r.coortes.find((c) => c.mes === "2026-08")!;
    expect(coorte.tamanho).toBe(1);
    expect(coorte.celulas[0]).toBe(100);
    expect(coorte.celulas[1]).toBeNull();
    expect(coorte.celulas[6]).toBeNull();
  });

  it("saída em D+45 ainda está na base em M1 e some em M2", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-01-10")], { c1: "2026-02-24" }), // 45 dias
    );
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.celulas[0]).toBe(100);
    expect(coorte.celulas[1]).toBe(100);
    expect(coorte.celulas[2]).toBe(0);
    expect(r.clientes[0].dias).toBe(45);
  });

  it("saída exatamente no limite do marco conta naquele marco", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-01-10")], { c1: "2026-02-10" }), // exatamente +1 mês
    );
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.celulas[1]).toBe(0);
  });

  it("coorte sem nenhuma saída dá 100% nas colunas maduras", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10"), jc("j2", "c2", "2026-01-20")]));
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.tamanho).toBe(2);
    expect(coorte.celulas[6]).toBe(100);
  });

  it("cancelamento anterior à entrega sai do denominador e vira inconsistente", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-08-05"), jc("j2", "c2", "2026-08-05")], { c1: "2025-09-15" }),
    );
    expect(r.inconsistentes.map((c) => c.clienteId)).toEqual(["c1"]);
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c2"]);
    expect(r.coortes.find((c) => c.mes === "2026-08")!.tamanho).toBe(1);
  });

  it("cliente sem data_cancelamento permaneceu (inclusive o que reativou)", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10")], { c1: null }));
    expect(r.clientes[0].saida).toBeNull();
    expect(r.clientes[0].dias).toBeNull();
    expect(r.coortes.find((c) => c.mes === "2026-01")!.celulas[6]).toBe(100);
  });

  it("mesesJanela recorta as coortes antigas", () => {
    const r = calcularPermanencia({
      ...entrada([
        jc("j1", "c1", "2025-01-10"),
        jc("j2", "c2", "2026-07-10"),
        jc("j3", "c3", "2026-08-10"),
      ]),
      mesesJanela: 3 as const,
    });
    expect(r.coortes.map((c) => c.mes)).toEqual(["2026-07", "2026-08"]);
  });
});

describe("calcularPermanencia — faixas de dias", () => {
  it("distribui as saídas nas quatro faixas e ignora saída depois de 180 dias", () => {
    const r = calcularPermanencia(
      entrada(
        [
          jc("j1", "c1", "2026-01-10"),
          jc("j2", "c2", "2026-01-10"),
          jc("j3", "c3", "2026-01-10"),
          jc("j4", "c4", "2026-01-10"),
          jc("j5", "c5", "2026-01-10"),
        ],
        {
          c1: "2026-01-30", // 20 dias
          c2: "2026-02-24", // 45 dias
          c3: "2026-03-31", // 80 dias
          c4: "2026-06-09", // 150 dias
          c5: "2026-09-10", // 243 dias — o marco já passou, não é saída precoce
        },
      ),
    );
    const porRotulo = Object.fromEntries(r.faixas.map((f) => [f.rotulo, f.clientes.length]));
    expect(porRotulo).toEqual({ "0–30 dias": 1, "31–60 dias": 1, "61–90 dias": 1, "91–180 dias": 1 });
  });

  it("cliente que permanece não entra em faixa nenhuma", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10")]));
    expect(r.faixas.every((f) => f.clientes.length === 0)).toBe(true);
  });
});

describe("calcularPermanencia — por implantador", () => {
  it("credita quem era responsável na conclusão, não o dono de hoje", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-de-hoje")]),
      periodosResponsavel: {
        j1: [
          { userId: "quem-entregou", de: "2026-01-01T00:00:00Z", ate: "2026-01-20T00:00:00Z" },
          { userId: "dono-de-hoje", de: "2026-01-21T00:00:00Z", ate: null },
        ],
      },
    });
    expect(r.clientes[0].implantadorId).toBe("quem-entregou");
    expect(r.porImplantador.map((l) => l.userId)).toEqual(["quem-entregou"]);
  });

  it("jornada sem histórico cai no responsável atual da view", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10", "u7")]));
    expect(r.clientes[0].implantadorId).toBe("u7");
  });

  it("soma entregues, saídas e dias médios por implantador", () => {
    const r = calcularPermanencia(
      entrada(
        [jc("j1", "c1", "2026-01-10", "u1"), jc("j2", "c2", "2026-01-10", "u1"), jc("j3", "c3", "2026-01-10", "u2")],
        { c1: "2026-01-30", c2: "2026-02-19" }, // 20 e 40 dias
      ),
    );
    const u1 = r.porImplantador.find((l) => l.userId === "u1")!;
    expect(u1.entregues).toBe(2);
    expect(u1.saidas).toBe(2);
    expect(u1.diasMedio).toBe(30);
    expect(u1.pctM6).toBe(0);
    const u2 = r.porImplantador.find((l) => l.userId === "u2")!;
    expect(u2.saidas).toBe(0);
    expect(u2.diasMedio).toBeNull();
    expect(u2.pctM6).toBe(100);
  });

  it("pctM6 é null quando nenhuma entrega do implantador chegou ao marco", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-08-20", "u1")]));
    expect(r.porImplantador[0].pctM6).toBeNull();
    expect(r.porImplantador[0].entregues).toBe(1);
  });

  it("filtroImplantador recorta a MEDIDA: cliente creditado a quem não passa no filtro sai da coorte inteira", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "u1"), jc("j2", "c2", "2026-01-10", "u2")]),
      filtroImplantador: (userId) => userId === "u1",
    });
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c1"]);
    expect(r.coortes.find((c) => c.mes === "2026-01")!.tamanho).toBe(1);
    expect(r.porImplantador.map((l) => l.userId)).toEqual(["u1"]);
  });
});

/** Treino não cancelado, com condutor. */
function tr(
  id: string,
  journeyId: string,
  conduzidoPor: string | null,
  agendadoPara: string | null,
  tipoId: string | null = "tipo-pdv",
  canceladoEm: string | null = null,
): TreinoPermanencia {
  return {
    id,
    journey_id: journeyId,
    training_type_id: tipoId,
    tipo_nome: tipoId === "tipo-pdv" ? "Treinamento PDV" : "Estoque",
    conduzido_por: conduzidoPor,
    agendado_para: agendadoPara,
    cancelado_em: canceladoEm,
  };
}

describe("calcularPermanencia — crédito pelo treino", () => {
  it("credita o condutor do treino, não o responsável da jornada", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [tr("t1", "j1", "quem-treinou", "2026-01-08T13:00:00.000Z")],
    });
    expect(r.clientes[0].implantadorId).toBe("quem-treinou");
    expect(r.clientes[0].origem).toBe("treino");
  });

  it("com dois treinos de condutores diferentes, vale o de menor agendado_para", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [
        tr("t2", "j1", "segundo", "2026-01-09T13:00:00.000Z"),
        tr("t1", "j1", "primeiro", "2026-01-05T13:00:00.000Z"),
      ],
    });
    expect(r.clientes[0].implantadorId).toBe("primeiro");
  });

  it("treino cancelado não credita — cai no responsável da jornada", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [tr("t1", "j1", "quem-treinou", "2026-01-08T13:00:00.000Z", "tipo-pdv", "2026-01-09T10:00:00.000Z")],
    });
    expect(r.clientes[0].implantadorId).toBe("dono-da-jornada");
    expect(r.clientes[0].origem).toBe("jornada");
  });

  it("jornada sem treino cai no responsável da conclusão, marcada como fallback", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]));
    expect(r.clientes[0].implantadorId).toBe("dono-da-jornada");
    expect(r.clientes[0].origem).toBe("jornada");
  });

  it("com filtro de tipo, quem não tem aquele treino SAI da coorte (sem fallback)", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "u1"), jc("j2", "c2", "2026-01-10", "u2")]),
      treinos: [
        tr("t1", "j1", "condutor-pdv", "2026-01-08T13:00:00.000Z", "tipo-pdv"),
        tr("t2", "j2", "condutor-estoque", "2026-01-08T13:00:00.000Z", "tipo-estoque"),
      ],
      tipoTreinoId: "tipo-pdv",
    });
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c1"]);
    expect(r.clientes[0].implantadorId).toBe("condutor-pdv");
  });

  it("com filtro de tipo, o crédito é do condutor DAQUELE tipo", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "u1")]),
      treinos: [
        tr("t1", "j1", "condutor-estoque", "2026-01-05T13:00:00.000Z", "tipo-estoque"),
        tr("t2", "j1", "condutor-pdv", "2026-01-09T13:00:00.000Z", "tipo-pdv"),
      ],
      tipoTreinoId: "tipo-pdv",
    });
    expect(r.clientes[0].implantadorId).toBe("condutor-pdv");
  });

  it("treino agendado antes mas sem conduzido_por cede a vez ao próximo treino elegível (§4.5)", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [
        tr("t1", "j1", null, "2026-01-05T13:00:00.000Z"),
        tr("t2", "j1", "quem-treinou", "2026-01-09T13:00:00.000Z"),
      ],
    });
    expect(r.clientes[0].implantadorId).toBe("quem-treinou");
    expect(r.clientes[0].origem).toBe("treino");
  });
});

describe("calcularPermanencia — fuso da janela de responsável na entrega", () => {
  it("posse que começa às 09h do dia da entrega (hora local) é encontrada pela janela", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-antigo")]),
      periodosResponsavel: {
        j1: [{ userId: "dono-antigo", de: "2026-01-01T00:00:00", ate: "2026-01-10T08:59:59" }, { userId: "quem-assumiu-de-manha", de: "2026-01-10T09:00:00", ate: null }],
      },
    });
    expect(r.clientes[0].implantadorId).toBe("quem-assumiu-de-manha");
  });
});
