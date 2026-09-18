/**
 * bun test supabase/functions/gerar-email-chat/
 */
import { describe, expect, test } from "bun:test";
import { FERRAMENTA_ADAPTAR, promptAdaptar } from "./adaptar.ts";

describe("promptAdaptar", () => {
  test("fala do histórico certo e leva o tom só quando vem um", () => {
    const chat = promptAdaptar(null, false);
    expect(chat).toContain("do atendimento pelo WhatsApp");
    expect(chat).not.toContain("- Tom:");

    const ticket = promptAdaptar("Formal: tratamento respeitoso.", true);
    expect(ticket).toContain("do chamado");
    expect(ticket).toContain("- Tom: Formal: tratamento respeitoso.");
  });

  test("proíbe tirar o que a macro informa e inventar fato", () => {
    const p = promptAdaptar(null, false);
    expect(p).toContain("Não remova e não troque esses dados");
    expect(p).toContain("Não invente");
  });

  test("a ferramenta devolve só o HTML, lido pelo mesmo leitor do corrigir", () => {
    expect(FERRAMENTA_ADAPTAR[0].function.name).toBe("devolver_texto_adaptado");
    expect(FERRAMENTA_ADAPTAR[0].function.parameters.required).toEqual(["html"]);
  });
});
