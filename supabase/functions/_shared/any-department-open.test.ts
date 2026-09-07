// O portão que decide se a URA pode pular a checagem de horário comercial.
//
// Bug de 07/09/2026 (feriado da Independência): com URA ligada e conversa ainda
// sem setor, o processador pergunta "algum setor está aberto agora?". A resposta
// vinha só da grade semanal — a tabela de feriados nunca era lida. Num feriado
// marcado "fechado o dia todo", a grade de segunda dizia 07:30–11:48 ativo, o
// portão respondia "sim" e o cliente recebia o menu da URA e entrava na fila em
// vez da mensagem de feriado. Mediu-se 22 menus enviados naquele dia em tenants
// com o feriado cadastrado como fechado.
import { describe, it, expect } from "vitest";
import { isAnyDepartmentOpen } from "./message-processor.ts";
import { zonedTimeToInstant } from "./business-hours.ts";

const TZ = "America/Sao_Paulo";
const TENANT = "tenant-1";

// Mock mínimo do client: cada .from() devolve um encadeável "thenable",
// respondendo com o que a tabela tiver no dicionário.
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

// Grade da Delvale: segunda 07:30–11:48 e 13:30–18:00.
const gradeSemanal = {
  mon: { active: true, slots: [{ start: "07:30", end: "11:48" }, { start: "13:30", end: "18:00" }] },
};

const setoresComHorario = [
  { id: "d1", business_hours_enabled: true, business_hours: gradeSemanal },
];

const feriado = (over: Record<string, any> = {}) => ([{
  date: "2026-09-07", name: "Independência do Brasil",
  is_closed: true, use_template: false, department_id: null, ...over,
}]);

const perguntar = (tables: Record<string, any>, hora: string) =>
  isAnyDepartmentOpen(
    mockSupabase(tables), TENANT,
    zonedTimeToInstant("2026-09-07", hora, TZ), // segunda-feira
    TZ, gradeSemanal,
  );

describe("isAnyDepartmentOpen", () => {
  it("dia normal dentro do turno: aberto", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: [],
    }, "08:06");
    expect(aberto).toBe(true);
  });

  it("dia normal no intervalo de almoço: fechado", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: [],
    }, "12:30");
    expect(aberto).toBe(false);
  });

  it("feriado fechado o dia todo: fechado mesmo dentro da grade semanal", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: feriado(),
    }, "08:06");
    expect(aberto).toBe(false);
  });

  it("feriado fechado o dia todo vale também para setor sem horário próprio", async () => {
    const aberto = await perguntar({
      support_departments: [{ id: "d1", business_hours_enabled: false, business_hours: null }],
      business_hours_exceptions: feriado(),
    }, "08:06");
    expect(aberto).toBe(false);
  });

  it("feriado com horário reduzido: aberto dentro da janela do template", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: feriado({ is_closed: false, use_template: true }),
      tenant_holiday_template: { open_at: "09:00", close_at: "13:00", has_break: false, break_start: null, break_end: null },
    }, "09:30");
    expect(aberto).toBe(true);
  });

  it("feriado com horário reduzido: fechado fora da janela, mesmo dentro da grade semanal", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: feriado({ is_closed: false, use_template: true }),
      tenant_holiday_template: { open_at: "09:00", close_at: "13:00", has_break: false, break_start: null, break_end: null },
    }, "08:06");
    expect(aberto).toBe(false);
  });

  it("feriado com horário reduzido: fechado durante o intervalo do template", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: feriado({ is_closed: false, use_template: true }),
      tenant_holiday_template: { open_at: "09:00", close_at: "17:00", has_break: true, break_start: "11:00", break_end: "13:00" },
    }, "11:30");
    expect(aberto).toBe(false);
  });

  it("exceção marcada para usar template mas sem template cadastrado: cai na grade semanal", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: feriado({ is_closed: false, use_template: true }),
      tenant_holiday_template: null,
    }, "08:06");
    expect(aberto).toBe(true);
  });

  it("exceção de OUTRA data não fecha o dia de hoje", async () => {
    const aberto = await perguntar({
      support_departments: setoresComHorario,
      business_hours_exceptions: [{ date: "2026-09-08", name: "Outro", is_closed: true, use_template: false, department_id: null }],
    }, "08:06");
    expect(aberto).toBe(true);
  });
});
