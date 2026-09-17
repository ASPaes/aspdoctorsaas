/**
 * Guarda da conversa completa depois da assinatura. Rodar com:
 *   bun test supabase/functions/send-email/
 */
import { describe, expect, test } from "bun:test";
import { anexarHistorico } from "./historico.ts";
import { aplicarAssinatura } from "./assinatura.ts";

const assinatura = { html: "<p>ASSINATURA</p>", texto: "ASSINATURA", embutidas: [] };

describe("anexarHistorico", () => {
  test("a conversa fica depois da assinatura, no HTML e no texto", () => {
    const comAssinatura = aplicarAssinatura({ html: "<div><p>Resumo</p></div>", texto: "Resumo" }, assinatura);
    const final = anexarHistorico(comAssinatura, { html: "<div>CONVERSA</div>", texto: "CONVERSA" });
    expect(final.html!.indexOf("ASSINATURA")).toBeLessThan(final.html!.indexOf("CONVERSA"));
    expect(final.html!.indexOf("Resumo")).toBeLessThan(final.html!.indexOf("ASSINATURA"));
    expect(final.texto).toBe("Resumo\n\nASSINATURA\n\nCONVERSA");
    expect(final.embutidas).toEqual([]);
  });

  test("respeita o </body> quando o corpo é documento inteiro", () => {
    const final = anexarHistorico({ html: "<html><body><p>Oi</p></body></html>", texto: null }, { html: "<div>C</div>", texto: null });
    expect(final.html).toBe("<html><body><p>Oi</p><div>C</div></body></html>");
  });

  test("sem histórico, nada muda", () => {
    const corpo = { html: "<p>x</p>", texto: "x" };
    expect(anexarHistorico(corpo, { html: null, texto: "   " })).toEqual(corpo);
  });

  test("e-mail só em texto recebe a conversa só em texto", () => {
    const final = anexarHistorico({ html: null, texto: "Resumo" }, { html: "<div>C</div>", texto: "C" });
    expect(final.html).toBeNull();
    expect(final.texto).toBe("Resumo\n\nC");
  });
});
