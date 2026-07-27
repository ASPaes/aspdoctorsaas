// Fim do expediente: é o que sustenta a antecipação de aviso/encerramento por
// inatividade. Errar aqui manda mensagem na hora errada para cliente real.
//
// Mock mínimo do client do Supabase: cada .from() devolve um objeto encadeável e
// "thenable", como o PostgREST.
import { describe, it, expect } from "vitest";
import { evaluateBusinessHours, zonedTimeToInstant, tzTimeStr } from "./business-hours.ts";

const TZ = "America/Sao_Paulo";

function mockSupabase(tables: Record<string, any>) {
  const make = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, is: () => q, or: () => q,
      maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      then: (res: any) => res({ data: tables[table] ?? [], error: null }),
    };
    return q;
  };
  return { from: (t: string) => make(t) };
}

const config = {
  business_hours_timezone: TZ,
  business_hours_message: null,
  business_hours: {
    mon: { active: true, slots: [{ start: "08:00", end: "18:00" }] },
    tue: { active: true, slots: [{ start: "08:00", end: "12:00" }, { start: "13:30", end: "18:18" }] },
    wed: { active: true, start: "09:00", end: "17:00" }, // formato legado, sem slots
    sun: { active: false, slots: [] },
  },
};

const semSetor = () => mockSupabase({
  whatsapp_conversations: null,
  support_departments: null,
  business_hours_exceptions: [],
});

const avaliar = (sb: any, dia: string, hora: string) =>
  evaluateBusinessHours(sb, "conv-1", "inst-1", "tenant-1", config, zonedTimeToInstant(dia, hora, TZ));

describe("helpers de fuso", () => {
  it("formata a hora no fuso do tenant", () => {
    expect(tzTimeStr(new Date("2026-07-27T21:00:00Z"), TZ)).toBe("18:00");
  });

  it("converte hora local em instante absoluto", () => {
    expect(zonedTimeToInstant("2026-07-27", "18:00", TZ).toISOString()).toBe("2026-07-27T21:00:00.000Z");
  });

  it("faz ida e volta sem perder minuto", () => {
    expect(tzTimeStr(zonedTimeToInstant("2026-07-27", "07:30", TZ), TZ)).toBe("07:30");
  });
});

describe("fim do expediente", () => {
  it("turno único: fim é o fim do turno", async () => {
    const r = await avaliar(semSetor(), "2026-07-27", "17:50"); // segunda
    expect(r.inside).toBe(true);
    expect(r.dayEndLabel).toBe("18:00");
    expect(r.dayEndAt?.toISOString()).toBe("2026-07-27T21:00:00.000Z");
  });

  it("dois turnos: o almoço NÃO é fim de expediente", async () => {
    const r = await avaliar(semSetor(), "2026-07-28", "12:30"); // terça, no almoço
    expect(r.inside).toBe(false);
    expect(r.dayEndLabel).toBe("18:18"); // fim da tarde, não 12:00
  });

  it("dois turnos: à tarde está dentro", async () => {
    const r = await avaliar(semSetor(), "2026-07-28", "14:00");
    expect(r.inside).toBe(true);
    expect(r.dayEndLabel).toBe("18:18");
  });

  it("aceita o formato legado start/end sem slots", async () => {
    const r = await avaliar(semSetor(), "2026-07-29", "10:00"); // quarta
    expect(r.inside).toBe(true);
    expect(r.dayEndLabel).toBe("17:00");
  });

  it("dia inativo não tem fim de expediente", async () => {
    const r = await avaliar(semSetor(), "2026-07-26", "10:00"); // domingo
    expect(r.inside).toBe(false);
    expect(r.dayEndAt).toBeNull();
  });

  it("feriado fechado o dia inteiro não tem fim de expediente", async () => {
    const sb = mockSupabase({
      whatsapp_conversations: null,
      support_departments: null,
      business_hours_exceptions: [
        { date: "2026-07-27", name: "Feriado", is_closed: true, use_template: false, department_id: null },
      ],
    });
    const r = await avaliar(sb, "2026-07-27", "10:00");
    expect(r.inside).toBe(false);
    expect(r.dayEndAt).toBeNull();
  });

  it("feriado com horário reduzido usa o fim do template", async () => {
    const sb = mockSupabase({
      whatsapp_conversations: null,
      support_departments: null,
      business_hours_exceptions: [
        { date: "2026-07-27", name: "Meio período", is_closed: false, use_template: true, department_id: null },
      ],
      tenant_holiday_template: {
        open_at: "09:00:00", close_at: "13:00:00", has_break: false, break_start: null, break_end: null,
      },
    });
    expect(await avaliar(sb, "2026-07-27", "10:00")).toMatchObject({ inside: true, dayEndLabel: "13:00" });
    expect((await avaliar(sb, "2026-07-27", "14:00")).inside).toBe(false);
  });

  it("horário próprio do setor vence o global", async () => {
    const sb = mockSupabase({
      whatsapp_conversations: { department_id: "d1" },
      support_departments: {
        id: "d1", name: "Suporte", business_hours_enabled: true,
        business_hours: { mon: { active: true, slots: [{ start: "08:00", end: "22:30" }] } },
        business_hours_message: null,
      },
      business_hours_exceptions: [],
    });
    const r = await avaliar(sb, "2026-07-27", "19:00"); // global já teria fechado às 18:00
    expect(r.inside).toBe(true);
    expect(r.dayEndLabel).toBe("22:30");
  });
});
