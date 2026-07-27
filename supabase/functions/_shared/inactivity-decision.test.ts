// Cenários da régua de inatividade, com foco no que quebrava: prazo que cai depois do
// fim do expediente. Todas as horas são de Brasília (o input já chega em instante absoluto).
import { describe, it, expect } from "vitest";
import { decideInactivityAction, InactivityInput } from "./inactivity-decision.ts";

// 27/07/2026, segunda. Expediente 08:00–18:00.
const h = (hhmm: string) => new Date(`2026-07-27T${hhmm}:00-03:00`);
const FIM = h("18:00");

const base = (over: Partial<InactivityInput> = {}): InactivityInput => ({
  now: h("10:00"),
  lastActivityAt: h("09:00"),
  warningSentAt: null,
  eodCloseAt: null,
  closeThresholdMin: 30,
  warnBeforeMin: 5,
  warnEnabled: true,
  insideBusinessHours: true,
  dayEndAt: FIM,
  eodEnabled: true,
  ...over,
});

describe("fluxo normal (prazo cabe dentro do expediente)", () => {
  it("não faz nada antes da hora do aviso", () => {
    const r = decideInactivityAction(base({ lastActivityAt: h("09:50"), now: h("10:00") }));
    expect(r.kind).toBe("none");
  });

  it("avisa ao atingir 25 min parado (30 − 5)", () => {
    const r = decideInactivityAction(base({ lastActivityAt: h("09:35"), now: h("10:00") }));
    expect(r.kind).toBe("warn");
  });

  it("encerra 5 min depois do aviso", () => {
    const r = decideInactivityAction(base({
      lastActivityAt: h("09:30"), warningSentAt: h("09:55"), now: h("10:00"),
    }));
    expect(r.kind).toBe("close");
  });

  it("espera a janela pós-aviso antes de encerrar", () => {
    const r = decideInactivityAction(base({
      lastActivityAt: h("09:30"), warningSentAt: h("09:58"), now: h("10:00"),
    }));
    expect(r.kind).toBe("none");
  });

  it("sem aviso configurado, encerra direto no prazo", () => {
    const r = decideInactivityAction(base({
      warnEnabled: false, lastActivityAt: h("09:29"), now: h("10:00"),
    }));
    expect(r.kind).toBe("close");
  });
});

describe("prazo que extrapola o expediente — o bug", () => {
  it("cliente para às 17:50: avisa às 17:55 e agenda o encerramento para as 18:00", () => {
    // prazo normal seria aviso 18:15 / encerramento 18:20, ambos fora do expediente
    const antes = decideInactivityAction(base({ lastActivityAt: h("17:50"), now: h("17:52") }));
    expect(antes.kind).toBe("none");

    const r = decideInactivityAction(base({ lastActivityAt: h("17:50"), now: h("17:55") }));
    expect(r.kind).toBe("eod_warn");
    expect(r.kind === "eod_warn" && r.closeAt.toISOString()).toBe(FIM.toISOString());
  });

  it("perto demais do fim: agenda o encerramento sem mandar aviso", () => {
    const r = decideInactivityAction(base({ lastActivityAt: h("17:58"), now: h("17:59") }));
    expect(r.kind).toBe("eod_schedule");
  });

  it("aviso normal já enviado e o encerramento cairia fora: agenda para o fim", () => {
    const r = decideInactivityAction(base({
      lastActivityAt: h("17:27"), warningSentAt: h("17:57"), now: h("17:58"),
    }));
    expect(r.kind).toBe("eod_schedule");
  });

  it("sem aviso configurado: agenda o encerramento para o fim do expediente", () => {
    const r = decideInactivityAction(base({
      warnEnabled: false, lastActivityAt: h("17:50"), now: h("17:55"),
    }));
    expect(r.kind).toBe("eod_schedule");
  });

  it("não reagenda o que já está agendado", () => {
    const r = decideInactivityAction(base({
      lastActivityAt: h("17:50"), warningSentAt: h("17:55"), eodCloseAt: FIM, now: h("17:57"),
    }));
    expect(r.kind).toBe("none");
  });
});

describe("encerramento agendado", () => {
  it("executa no horário mesmo com o ciclo já fora do expediente", () => {
    const r = decideInactivityAction(base({
      eodCloseAt: FIM, warningSentAt: h("17:55"), now: h("18:01"), insideBusinessHours: false,
    }));
    expect(r.kind).toBe("eod_close");
  });

  it("não antecipa o agendado", () => {
    const r = decideInactivityAction(base({
      eodCloseAt: FIM, warningSentAt: h("17:55"), now: h("17:59"),
    }));
    expect(r.kind).not.toBe("eod_close");
  });

  it("executa no dia seguinte se o ciclo tiver falhado a noite toda", () => {
    const r = decideInactivityAction(base({
      eodCloseAt: FIM, now: new Date("2026-07-28T08:00:00-03:00"), insideBusinessHours: true,
    }));
    expect(r.kind).toBe("eod_close");
  });
});

describe("recurso desligado mantém o comportamento antigo", () => {
  it("fora do expediente não faz nada", () => {
    const r = decideInactivityAction(base({
      eodEnabled: false, lastActivityAt: h("17:50"), now: h("18:30"), insideBusinessHours: false,
    }));
    expect(r).toMatchObject({ kind: "none", reason: "fora_do_expediente" });
  });

  it("dentro do expediente, prazo que extrapola não é antecipado", () => {
    const r = decideInactivityAction(base({
      eodEnabled: false, lastActivityAt: h("17:50"), now: h("17:55"),
    }));
    expect(r.kind).toBe("none");
  });

  it("no dia seguinte a régua normal age (era o único alívio do bug)", () => {
    const r = decideInactivityAction(base({
      eodEnabled: false,
      lastActivityAt: h("17:50"),
      now: new Date("2026-07-28T08:00:00-03:00"),
      insideBusinessHours: true,
      dayEndAt: new Date("2026-07-28T18:00:00-03:00"),
    }));
    expect(r.kind).toBe("warn");
  });
});

describe("dias sem expediente e tenants sem horário comercial", () => {
  it("sem fim de expediente (feriado/dia inativo) não antecipa nada", () => {
    const r = decideInactivityAction(base({
      dayEndAt: null, lastActivityAt: h("17:50"), now: h("17:55"),
    }));
    expect(r.kind).toBe("none");
  });

  it("tenant sem horário comercial age de madrugada, como sempre agiu", () => {
    const semHorario = {
      insideBusinessHours: null, dayEndAt: null, eodEnabled: false,
      lastActivityAt: h("22:00"),
    } as const;

    expect(decideInactivityAction(base({
      ...semHorario, now: new Date("2026-07-27T22:25:00-03:00"),
    })).kind).toBe("warn");

    expect(decideInactivityAction(base({
      ...semHorario, warningSentAt: new Date("2026-07-27T22:25:00-03:00"),
      now: new Date("2026-07-27T22:30:00-03:00"),
    })).kind).toBe("close");
  });
});

describe("configuração inválida", () => {
  it("prazo de encerramento zerado não age", () => {
    expect(decideInactivityAction(base({ closeThresholdMin: 0 })).kind).toBe("none");
  });

  it("antecedência zerada com aviso ligado não age", () => {
    const r = decideInactivityAction(base({ warnBeforeMin: 0, lastActivityAt: h("08:00") }));
    expect(r).toMatchObject({ kind: "none", reason: "warn_before_invalido" });
  });
});
