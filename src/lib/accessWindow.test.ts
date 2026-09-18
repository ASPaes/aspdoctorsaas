import { describe, expect, it } from "vitest";
import { formatarHora, formatarProximoAcesso, isOutsideWindow, resumirDias, resumirIntervalos } from "./accessWindow";

describe("horário de acesso: textos da tela", () => {
  it("resume dias seguidos com traço e salteados com vírgula", () => {
    expect(resumirDias([1, 2, 3, 4, 5])).toBe("Seg–Sex");
    expect(resumirDias([6])).toBe("Sáb");
    expect(resumirDias([1, 3, 5])).toBe("Seg, Qua, Sex");
    expect(resumirDias([0, 1, 2, 3, 4, 5, 6])).toBe("Todos os dias");
    expect(resumirDias([5, 1, 2, 3, 4])).toBe("Seg–Sex");
  });

  it("uma linha por intervalo", () => {
    expect(
      resumirIntervalos([
        { start: "07:20", end: "20:15", days: [1, 2, 3, 4, 5] },
        { start: "07:50", end: "12:15", days: [6] },
      ]),
    ).toEqual(["Seg–Sex 07:20–20:15", "Sáb 07:50–12:15"]);
  });

  it("formata no fuso da regra, não no da máquina", () => {
    // 10:50Z = sábado 07:50 em São Paulo
    expect(formatarProximoAcesso("2026-09-19T10:50:00Z", "America/Sao_Paulo")).toBe("sábado, 19/09 às 07:50");
    // mesma hora em Manaus é 06:50
    expect(formatarHora("2026-09-19T10:50:00Z", "America/Manaus")).toBe("06:50");
    // meia-noite não vira "24:00"
    expect(formatarHora("2026-09-19T03:00:00Z", "America/Sao_Paulo")).toBe("00:00");
  });

  it("só barra quando há regra e a pessoa está fora", () => {
    const base = { server_now: "2026-09-18T22:00:00Z" };
    expect(isOutsideWindow(null)).toBe(false);
    expect(isOutsideWindow({ ...base, restricted: false })).toBe(false);
    expect(isOutsideWindow({ ...base, restricted: true, allowed: true })).toBe(false);
    expect(isOutsideWindow({ ...base, restricted: true, allowed: false, in_grace: true })).toBe(true);
  });
});
