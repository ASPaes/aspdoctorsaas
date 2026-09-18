import { describe, expect, it } from "vitest";
import { documentoDoEmail } from "./LerEmailDialog";

describe("quadro do e-mail enviado", () => {
  const corpo = '<div style="color:#1E293B;background:#fff"><p>Prezados,</p><a href="https://x.com">link</a></div>';

  it("no tema escuro, o texto claro vence as cores do e-mail e o fundo fica o da tela", () => {
    const doc = documentoDoEmail(corpo, true);
    expect(doc).toContain(":root{color-scheme:dark}");
    expect(doc).toContain("color:inherit!important");
    expect(doc).toContain("background-color:transparent!important");
    expect(doc).toContain(corpo);
  });

  it("no tema claro, o e-mail aparece como o cliente recebeu", () => {
    const doc = documentoDoEmail(corpo, false);
    expect(doc).toContain(":root{color-scheme:light}");
    expect(doc).not.toContain("!important");
  });
});
