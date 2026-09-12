/**
 * Guarda da assinatura. Rodar antes de mexer em assinatura.ts ou mime.ts:
 *   bun test supabase/functions/send-email/
 *
 * O que importa: texto de gente não vira HTML injetado, a imagem vai embutida
 * (multipart/related) e volta byte a byte, e o corpo de quem chamou não perde nada.
 */
import { describe, expect, test } from "bun:test";
import { aplicarAssinatura, CID_ASSINATURA, montarAssinatura } from "./assinatura.ts";
import { montarMensagem } from "./mime.ts";

/** PNG de 1x1 px */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const vazia = { texto: null, imagem_base64: null, imagem_mime: null, imagem_largura: null, imagem_altura: null };

describe("montar a assinatura", () => {
  test("sem texto e sem imagem não existe assinatura", () => {
    expect(montarAssinatura(null)).toBeNull();
    expect(montarAssinatura({ ...vazia, texto: "   \n  " })).toBeNull();
  });

  test("texto escapado linha por linha, com site e e-mail virando link", () => {
    const a = montarAssinatura({ ...vazia, texto: "Maria <Suporte>\nwww.empresa.com.br · suporte@empresa.com.br" })!;
    expect(a.html).toContain("Maria &lt;Suporte&gt;<br>");
    expect(a.html).not.toContain("<Suporte>");
    expect(a.html).toContain('<a href="https://www.empresa.com.br"');
    expect(a.html).toContain('<a href="mailto:suporte@empresa.com.br"');
    expect(a.texto).toBe("-- \nMaria <Suporte>\nwww.empresa.com.br · suporte@empresa.com.br");
    expect(a.embutidas).toEqual([]);
  });

  test("link com https não é linkado duas vezes", () => {
    const a = montarAssinatura({ ...vazia, texto: "https://www.empresa.com.br/contato." })!;
    expect(a.html.match(/<a /g)).toHaveLength(1);
    expect(a.html).toContain('href="https://www.empresa.com.br/contato"');
  });

  test("imagem vai por cid, com largura limitada a 600 e altura proporcional", () => {
    const a = montarAssinatura({ ...vazia, imagem_base64: PNG, imagem_mime: "image/png", imagem_largura: 1200, imagem_altura: 300 })!;
    expect(a.html).toContain(`src="cid:${CID_ASSINATURA}"`);
    expect(a.html).toContain('width="600" height="150"');
    expect(a.embutidas).toEqual([{ cid: CID_ASSINATURA, mime: "image/png", nome: "assinatura.png", base64: PNG }]);
  });

  test("tipo de imagem fora da lista, ou base64 corrompido, é ignorado", () => {
    expect(montarAssinatura({ ...vazia, imagem_base64: PNG, imagem_mime: "image/svg+xml", imagem_largura: 10, imagem_altura: 10 })).toBeNull();
    expect(montarAssinatura({ ...vazia, imagem_base64: "<script>", imagem_mime: "image/png", imagem_largura: 10, imagem_altura: 10 })).toBeNull();
  });
});

describe("aplicar ao corpo", () => {
  const assinatura = montarAssinatura({
    ...vazia,
    texto: "Equipe Suporte",
    imagem_base64: PNG,
    imagem_mime: "image/png",
    imagem_largura: 200,
    imagem_altura: 50,
  });

  test("HTML recebe a assinatura no fim, antes do </body> quando ele existe", () => {
    const r = aplicarAssinatura({ html: "<html><body><p>Oi</p></body></html>", texto: null }, assinatura);
    expect(r.html!.indexOf("Equipe Suporte")).toBeGreaterThan(r.html!.indexOf("<p>Oi</p>"));
    expect(r.html!.endsWith("</body></html>")).toBe(true);
    expect(r.texto).toBeNull();
    expect(r.embutidas).toHaveLength(1);
  });

  test("corpo só em texto ganha HTML para a imagem aparecer, e o texto ganha o separador", () => {
    const r = aplicarAssinatura({ html: null, texto: "Olá <cliente>\nTudo certo  " }, assinatura);
    expect(r.html).toContain("Olá &lt;cliente&gt;<br>Tudo certo");
    expect(r.html).toContain(`cid:${CID_ASSINATURA}`);
    expect(r.texto).toBe("Olá <cliente>\nTudo certo\n\n-- \nEquipe Suporte");
  });

  test("assinatura só de texto em corpo só de texto não inventa HTML", () => {
    const soTexto = montarAssinatura({ ...vazia, texto: "Equipe" });
    expect(aplicarAssinatura({ html: null, texto: "Oi" }, soTexto)).toEqual({ html: null, texto: "Oi\n\n-- \nEquipe", embutidas: [] });
  });

  test("sem assinatura o corpo não muda", () => {
    expect(aplicarAssinatura({ html: "<p>x</p>", texto: null }, null)).toEqual({ html: "<p>x</p>", texto: null, embutidas: [] });
  });
});

describe("mensagem com a imagem embutida", () => {
  const assinatura = montarAssinatura({ ...vazia, texto: "Equipe", imagem_base64: PNG, imagem_mime: "image/png", imagem_largura: 1, imagem_altura: 1 });
  const corpo = aplicarAssinatura({ html: "<p>Oi</p>", texto: null }, assinatura);
  const m = montarMensagem({ de: { email: "s@empresa.com.br" }, para: ["c@x.com"], assunto: "Oi", ...corpo });

  test("related por fora da alternativa, imagem com Content-ID e inline", () => {
    const iRelated = m.bruta.indexOf("Content-Type: multipart/related");
    const iAlternative = m.bruta.indexOf("Content-Type: multipart/alternative");
    expect(iRelated).toBeGreaterThan(-1);
    expect(iAlternative).toBeGreaterThan(iRelated);
    expect(m.bruta).toContain(`Content-ID: <${CID_ASSINATURA}>`);
    expect(m.bruta).toContain('Content-Disposition: inline; filename="assinatura.png"');
    expect(m.bruta.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("a imagem volta idêntica", () => {
    const parte = m.bruta.split(`Content-ID: <${CID_ASSINATURA}>`)[1];
    const b64 = parte.split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
    expect(b64).toBe(PNG);
  });

  test("sem imagem continua multipart/alternative simples", () => {
    const semImagem = montarMensagem({ de: { email: "s@empresa.com.br" }, para: ["c@x.com"], assunto: "Oi", html: "<p>Oi</p>" });
    expect(semImagem.bruta).not.toContain("multipart/related");
  });
});
