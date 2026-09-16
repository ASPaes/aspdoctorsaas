// DEM-0370 — de onde sai o aviso automático em feriado fechado o dia todo.
//
// Antes o texto era fixo dentro da function ("nosso atendimento está pausado"),
// ou uma variação da IA. Quem trabalha de sobreaviso em feriado precisava
// mandar outra coisa e não tinha onde escrever.
//
// O padrão continua 'auto' de propósito: a tela nova é opt-in e nenhum tenant
// que não mexer nela muda de comportamento.
import { describe, it, expect } from "vitest";
import {
  decideHolidayMessageSource,
  resolveHolidayMessageMode,
  renderHolidayTemplate,
  defaultHolidayMessage,
  HOLIDAY_MESSAGE_MODE_DEFAULT,
} from "./message-processor.ts";

describe("resolveHolidayMessageMode", () => {
  it("aceita os modos conhecidos", () => {
    expect(resolveHolidayMessageMode("off_hours")).toBe("off_hours");
    expect(resolveHolidayMessageMode("custom")).toBe("custom");
    expect(resolveHolidayMessageMode("auto")).toBe("auto");
  });

  it("volta ao padrão com nulo, vazio ou lixo", () => {
    expect(resolveHolidayMessageMode(null)).toBe(HOLIDAY_MESSAGE_MODE_DEFAULT);
    expect(resolveHolidayMessageMode(undefined)).toBe(HOLIDAY_MESSAGE_MODE_DEFAULT);
    expect(resolveHolidayMessageMode("")).toBe(HOLIDAY_MESSAGE_MODE_DEFAULT);
    expect(resolveHolidayMessageMode(7)).toBe(HOLIDAY_MESSAGE_MODE_DEFAULT);
  });
});

describe("decideHolidayMessageSource", () => {
  const base = { hasHolidayMessage: true, hasOffHoursTemplate: true };

  it("modo auto mantém o texto da plataforma", () => {
    expect(decideHolidayMessageSource({ ...base, mode: "auto" })).toBe("auto");
  });

  it("modo custom usa o texto de feriado", () => {
    expect(decideHolidayMessageSource({ ...base, mode: "custom" })).toBe("custom");
  });

  it("modo off_hours reusa a mensagem de fora do horário", () => {
    expect(decideHolidayMessageSource({ ...base, mode: "off_hours" })).toBe("off_hours");
  });

  // Sem texto não adianta o modo: o aviso precisa sair, e o padrão da
  // plataforma é melhor que uma mensagem vazia.
  it("custom sem texto escrito cai no padrão", () => {
    expect(decideHolidayMessageSource({ ...base, mode: "custom", hasHolidayMessage: false })).toBe("auto");
  });

  // O default de fora do horário diz "nosso horário é das X às Y" — num feriado
  // isso é hora errada, então não serve de substituto.
  it("off_hours sem mensagem de fora do horário cai no padrão", () => {
    expect(decideHolidayMessageSource({ ...base, mode: "off_hours", hasOffHoursTemplate: false })).toBe("auto");
  });
});

describe("renderHolidayTemplate", () => {
  const vars = {
    greeting: "Bom dia",
    holidayName: "Independência do Brasil",
    nextStart: "07:30",
    nextWhen: "amanhã a partir das 07:30",
    firstStart: "08:00",
    lastEnd: "18:00",
    slots: [{ start: "08:00", end: "18:00" }],
  };

  it("troca os placeholders de feriado", () => {
    const out = renderHolidayTemplate(
      "{{greeting}}! Hoje é {{holiday_name}}. Voltamos {{next_when}}.",
      vars,
    );
    expect(out).toBe("Bom dia! Hoje é Independência do Brasil. Voltamos amanhã a partir das 07:30.");
  });

  it("continua trocando os placeholders de fora do horário", () => {
    const out = renderHolidayTemplate("Das {{start}} às {{end}}, retorno {{next_start}}", vars);
    expect(out).toBe("Das 08:00 às 18:00, retorno 07:30");
  });

  it("texto sem placeholder sai igual", () => {
    expect(renderHolidayTemplate("Estamos de sobreaviso, pode chamar.", vars))
      .toBe("Estamos de sobreaviso, pode chamar.");
  });
});

describe("defaultHolidayMessage", () => {
  it("mantém o texto que a plataforma já enviava", () => {
    const out = defaultHolidayMessage({
      greeting: "Boa tarde",
      holidayName: "Independência do Brasil",
      nextWhen: "amanhã a partir das 07:30",
    });
    expect(out).toContain("Boa tarde!");
    expect(out).toContain("Hoje é feriado (Independência do Brasil) e nosso atendimento está pausado.");
    expect(out).toContain("Retornamos amanhã a partir das 07:30.");
  });
});
