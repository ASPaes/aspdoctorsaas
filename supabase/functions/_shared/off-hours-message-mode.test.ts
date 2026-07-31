// Qual fonte de texto o aviso de "fora do horário" usa: o template do tenant ou a IA.
//
// Regra do owner (31/07/2026): o template escrito na tela é o padrão e vale para
// os 2 primeiros avisos do mesmo ciclo fora do horário. Se o cliente insiste, do
// 3º aviso em diante a IA reescreve o texto para não repetir a mesma parede.
//
// O bug que originou a regra: a IA vencia SEMPRE que o tenant tinha IA ativa, e
// `business_hours_message` só era usada se a chamada de IA falhasse — ou seja, o
// campo da tela era decorativo.
import { describe, it, expect } from "vitest";
import {
  decideOffHoursMessageMode,
  offHoursNoticeWindowStart,
  OFF_HOURS_TEMPLATE_LIMIT,
} from "./message-processor.ts";

describe("decideOffHoursMessageMode", () => {
  const base = { hasTemplate: true, hasAI: true, isHoliday: false, previousNoticeCount: 0 };

  it("usa o template no 1º aviso", () => {
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: 0 })).toBe("template");
  });

  it("usa o template no 2º aviso", () => {
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: 1 })).toBe("template");
  });

  it("troca para a IA no 3º aviso", () => {
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: 2 })).toBe("ai");
  });

  it("segue na IA do 4º em diante", () => {
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: 7 })).toBe("ai");
  });

  it("sem IA configurada, o template se repete — nunca fica sem resposta", () => {
    expect(decideOffHoursMessageMode({ ...base, hasAI: false, previousNoticeCount: 9 })).toBe("template");
  });

  it("sem template escrito, a IA assume desde o 1º aviso", () => {
    expect(decideOffHoursMessageMode({ ...base, hasTemplate: false, previousNoticeCount: 0 })).toBe("ai");
  });

  it("sem template e sem IA, cai no texto padrão do sistema", () => {
    expect(decideOffHoursMessageMode({ ...base, hasTemplate: false, hasAI: false })).toBe("template");
  });

  it("feriado ignora o template do tenant — o texto fala de horário, não de feriado", () => {
    expect(decideOffHoursMessageMode({ ...base, isHoliday: true, previousNoticeCount: 0 })).toBe("ai");
  });

  it("feriado sem IA usa o texto de feriado do sistema", () => {
    expect(decideOffHoursMessageMode({ ...base, isHoliday: true, hasAI: false })).toBe("template");
  });

  it("contagem negativa ou suja não derruba o template", () => {
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: -1 })).toBe("template");
    expect(decideOffHoursMessageMode({ ...base, previousNoticeCount: NaN })).toBe("template");
  });

  it("o limite publicado é 2", () => {
    expect(OFF_HOURS_TEMPLATE_LIMIT).toBe(2);
  });
});

// A partir de quando os avisos anteriores contam.
//
// `opened_out_of_hours_at` só é reescrito quando a conversa fecha e reabre —
// medido em produção (31/07), há conversas com essa marca parada em 25/07. Sem
// piso, um cliente que escreveu numa segunda à noite acordaria na sexta já no
// modo IA, porque o contador nunca zerou.
describe("offHoursNoticeWindowStart", () => {
  const now = new Date("2026-07-31T22:00:00Z");
  const h = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString();

  it("conta a partir do retorno ao expediente", () => {
    const start = offHoursNoticeWindowStart(
      { opened_out_of_hours_at: h(30), out_of_hours_cleared_at: h(6) },
      now,
    );
    expect(start.toISOString()).toBe(h(6));
  });

  it("sem retorno ao expediente, conta desde que a conversa entrou fora do horário", () => {
    const start = offHoursNoticeWindowStart(
      { opened_out_of_hours_at: h(5), out_of_hours_cleared_at: null },
      now,
    );
    expect(start.toISOString()).toBe(h(5));
  });

  it("marca velha não vale: o piso é 24h", () => {
    const start = offHoursNoticeWindowStart(
      { opened_out_of_hours_at: h(140), out_of_hours_cleared_at: null },
      now,
    );
    expect(start.toISOString()).toBe(h(24));
  });

  it("sem marca nenhuma, também cai no piso de 24h", () => {
    expect(offHoursNoticeWindowStart({}, now).toISOString()).toBe(h(24));
  });

  it("data corrompida é ignorada, não vira NaN", () => {
    const start = offHoursNoticeWindowStart(
      { opened_out_of_hours_at: "nao-e-data", out_of_hours_cleared_at: h(3) },
      now,
    );
    expect(start.toISOString()).toBe(h(3));
  });

  it("a noite inteira cabe na janela — 18h às 08h não zera o contador", () => {
    const start = offHoursNoticeWindowStart({ opened_out_of_hours_at: h(14) }, now);
    expect(start.toISOString()).toBe(h(14));
  });
});
