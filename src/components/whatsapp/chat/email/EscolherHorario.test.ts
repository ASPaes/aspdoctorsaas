import { describe, expect, it } from "vitest";
import { atalhosDeAgendamento, descreverHorario, lerHorario, problemaDoHorario } from "./EscolherHorario";

describe("atalhos do agendamento", () => {
  it("numa quarta às 10h: amanhã 08:00, segunda 08:00 e daqui a 2 horas", () => {
    const quarta = new Date(2026, 8, 16, 10, 0, 0);
    const a = atalhosDeAgendamento(quarta);
    expect(a.map((x) => x.rotulo)).toEqual(["Amanhã, 08:00", "Segunda, 08:00", "Daqui a 2 horas"]);
    expect(a[0].quando).toEqual(new Date(2026, 8, 17, 8, 0, 0));
    expect(a[1].quando).toEqual(new Date(2026, 8, 21, 8, 0, 0));
    expect(a[2].quando).toEqual(new Date(2026, 8, 16, 12, 0, 0));
  });

  it("num domingo, amanhã já é segunda: não repete o atalho", () => {
    const domingo = new Date(2026, 8, 20, 15, 0, 0);
    expect(atalhosDeAgendamento(domingo).map((x) => x.rotulo)).toEqual(["Amanhã, 08:00", "Daqui a 2 horas"]);
  });
});

describe("conferência do horário", () => {
  const agora = new Date(2026, 8, 16, 10, 0, 0);
  it("recusa vazio, passado e mais de 180 dias", () => {
    expect(problemaDoHorario(lerHorario(""), agora)).toBe("Escolha o dia e a hora.");
    expect(problemaDoHorario(new Date(2026, 8, 16, 10, 0, 30), agora)).toContain("1 minuto");
    expect(problemaDoHorario(new Date(2027, 3, 1), agora)).toContain("180 dias");
    expect(problemaDoHorario(new Date(2026, 8, 17, 8, 0), agora)).toBeNull();
  });
});

describe("descreverHorario", () => {
  const agora = new Date(2026, 8, 17, 0, 29, 0);
  it("mostra hoje/amanhã e quanto falta, para o engano de hora saltar aos olhos", () => {
    expect(descreverHorario(new Date(2026, 8, 17, 0, 31), agora)).toBe("hoje às 00:31 (daqui a 2 min)");
    expect(descreverHorario(new Date(2026, 8, 17, 8, 31), agora)).toBe("hoje às 08:31 (daqui a 8 h)");
    expect(descreverHorario(new Date(2026, 8, 18, 8, 0), agora)).toBe("amanhã às 08:00 (daqui a 32 h)");
    expect(descreverHorario(new Date(2026, 8, 21, 8, 0), agora)).toBe("segunda-feira, 21/09 às 08:00 (daqui a 4 dias)");
  });
});
