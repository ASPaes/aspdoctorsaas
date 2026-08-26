import { describe, it, expect } from "vitest";
import { validateSchedule, cleanSchedule, parseBusinessHours, type BusinessHours } from "./WeeklyScheduleGrid";

const dia = (active: boolean, slots: { start: string; end: string }[]): BusinessHours[string] => ({ active, slots });

describe("validateSchedule", () => {
  it("recusa turno com fim antes do início", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "18:00", end: "09:00" }]) };
    expect(validateSchedule(s)).toMatch(/Segunda/);
  });

  it("recusa turnos sobrepostos", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "08:00", end: "13:00" }, { start: "12:00", end: "18:00" }]) };
    expect(validateSchedule(s)).toMatch(/sobrep/);
  });

  it("aceita almoço", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "08:00", end: "12:00" }, { start: "13:30", end: "18:18" }]) };
    expect(validateSchedule(s)).toBeNull();
  });

  it("ignora dia inativo", () => {
    const s: BusinessHours = { sat: dia(false, [{ start: "18:00", end: "09:00" }]) };
    expect(validateSchedule(s)).toBeNull();
  });
});

describe("cleanSchedule", () => {
  it("descarta slot com campo vazio e mantém o dia com um slot padrão", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "", end: "" }]) };
    expect(cleanSchedule(s).mon.slots).toHaveLength(1);
  });
});

describe("parseBusinessHours", () => {
  it("converte o formato antigo {start,end} em slots", () => {
    const out = parseBusinessHours({ mon: { active: true, start: "09:00", end: "18:00" } });
    expect(out.mon.slots).toEqual([{ start: "09:00", end: "18:00" }]);
  });

  it("devolve todos os dias mesmo com objeto vazio", () => {
    const out = parseBusinessHours({});
    expect(Object.keys(out)).toHaveLength(7);
    expect(out.sun.active).toBe(false);
  });
});
