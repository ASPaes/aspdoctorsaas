import { describe, it, expect } from "vitest";
import { dentroDoHorario, proximoHorarioUtil, relogioDoTenant, type ConfigHorario } from "./businessHours";

// Agenda comum: seg a sex, 08:00-12:00 e 13:00-18:00. Sábado e domingo fechados.
const semana = (): any => {
  const dia = { active: true, slots: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }] };
  return {
    sun: { active: false, slots: [{ start: "08:00", end: "18:00" }] },
    mon: dia, tue: dia, wed: dia, thu: dia, fri: dia,
    sat: { active: false, slots: [{ start: "08:00", end: "12:00" }] },
  };
};

const cfg = (over: Partial<ConfigHorario> = {}): ConfigHorario => ({
  enabled: true,
  timezone: "America/Sao_Paulo",
  schedule: semana(),
  fechados: new Set<string>(),
  ...over,
});

/** Instante em America/Sao_Paulo (UTC-3 fixo). */
const spo = (iso: string) => new Date(`${iso}-03:00`);

describe("relogioDoTenant", () => {
  it("lê o dia e a hora no fuso do tenant, não no do navegador", () => {
    // 01:00 UTC de terça = 22:00 de segunda em Sao Paulo.
    const r = relogioDoTenant(new Date("2026-09-15T01:00:00Z"), "America/Sao_Paulo");
    expect(r.diaSemana).toBe("mon");
    expect(r.data).toBe("2026-09-14");
    expect(r.minutos).toBe(22 * 60);
  });
});

describe("dentroDoHorario", () => {
  it("aceita quarta às 10h", () => {
    expect(dentroDoHorario(spo("2026-09-16T10:00:00"), cfg())).toBe(true);
  });

  it("recusa o almoço", () => {
    expect(dentroDoHorario(spo("2026-09-16T12:30:00"), cfg())).toBe(false);
  });

  it("recusa sábado", () => {
    expect(dentroDoHorario(spo("2026-09-19T10:00:00"), cfg())).toBe(false);
  });

  it("recusa o instante do fechamento (18:00 já é fora)", () => {
    expect(dentroDoHorario(spo("2026-09-16T18:00:00"), cfg())).toBe(false);
    expect(dentroDoHorario(spo("2026-09-16T17:59:00"), cfg())).toBe(true);
  });

  it("recusa feriado mesmo em dia útil", () => {
    const c = cfg({ fechados: new Set(["2026-09-16"]) });
    expect(dentroDoHorario(spo("2026-09-16T10:00:00"), c)).toBe(false);
  });

  it("sem horário configurado o tenant é 24/7, igual à fn_is_business_hours", () => {
    expect(dentroDoHorario(spo("2026-09-20T03:00:00"), cfg({ enabled: false }))).toBe(true);
    expect(dentroDoHorario(spo("2026-09-20T03:00:00"), null)).toBe(true);
  });
});

describe("proximoHorarioUtil", () => {
  it("do sábado à noite vai para segunda às 08:00", () => {
    const r = proximoHorarioUtil(spo("2026-09-19T22:00:00"), cfg());
    expect(r?.toISOString()).toBe(spo("2026-09-21T08:00:00").toISOString());
  });

  it("do almoço vai para as 13:00 do mesmo dia", () => {
    const r = proximoHorarioUtil(spo("2026-09-16T12:30:00"), cfg());
    expect(r?.toISOString()).toBe(spo("2026-09-16T13:00:00").toISOString());
  });

  it("depois do expediente vai para a manhã seguinte", () => {
    const r = proximoHorarioUtil(spo("2026-09-16T19:00:00"), cfg());
    expect(r?.toISOString()).toBe(spo("2026-09-17T08:00:00").toISOString());
  });

  it("pula o feriado", () => {
    const c = cfg({ fechados: new Set(["2026-09-17"]) });
    const r = proximoHorarioUtil(spo("2026-09-16T19:00:00"), c);
    expect(r?.toISOString()).toBe(spo("2026-09-18T08:00:00").toISOString());
  });

  it("dentro do expediente devolve o próprio instante", () => {
    const quando = spo("2026-09-16T10:00:00");
    const r = proximoHorarioUtil(quando, cfg());
    expect(r?.toISOString()).toBe(quando.toISOString());
  });

  it("agenda toda fechada devolve null em vez de chutar", () => {
    const c = cfg({
      schedule: {
        sun: { active: false, slots: [] }, mon: { active: false, slots: [] },
        tue: { active: false, slots: [] }, wed: { active: false, slots: [] },
        thu: { active: false, slots: [] }, fri: { active: false, slots: [] },
        sat: { active: false, slots: [] },
      } as any,
    });
    expect(proximoHorarioUtil(spo("2026-09-16T19:00:00"), c)).toBeNull();
  });
});
