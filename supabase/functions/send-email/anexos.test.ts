/**
 * Guarda do anexo do e-mail. Rodar antes de mexer em anexos.ts ou mime.ts:
 *   bun test supabase/functions/send-email/
 */
import { describe, expect, test } from "bun:test";
import { bytesParaBase64, tipoPermitido, validarAnexos, ANEXO_MAX_ARQUIVOS } from "./anexos.ts";
import { montarMensagem, parametroFilename } from "./mime.ts";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const CONVERSA = "e08a9d63-30c5-4ee3-a54e-2986415aefb3";
const caminho = (ext = "pdf") => `${TENANT}/${CONVERSA}/1b0f7c6f-0000-4000-8000-000000000001.${ext}`;

describe("tipoPermitido", () => {
  test("aceita documento, imagem e o que o navegador manda sem tipo mas com extensão conhecida", () => {
    expect(tipoPermitido("application/pdf", "proposta.pdf")).toBe(true);
    expect(tipoPermitido("image/png", "print.png")).toBe(true);
    expect(tipoPermitido("", "planilha.xlsx")).toBe(true);
    expect(tipoPermitido("application/octet-stream", "nota.xml")).toBe(true);
  });

  test("recusa SVG, executável e tipo desconhecido", () => {
    expect(tipoPermitido("image/svg+xml", "logo.svg")).toBe(false);
    expect(tipoPermitido("image/png", "disfarce.svg")).toBe(false);
    expect(tipoPermitido("application/x-msdownload", "setup.exe")).toBe(false);
    expect(tipoPermitido("", "setup.exe")).toBe(false);
  });
});

describe("validarAnexos", () => {
  test("sem anexo é válido", () => {
    expect(validarAnexos(undefined, TENANT)).toEqual({ ok: true, anexos: [] });
  });

  test("caminho do próprio tenant, no formato da get-media-upload-url", () => {
    const r = validarAnexos([{ path: caminho(), nome: " proposta.pdf ", mime: "application/pdf" }], TENANT);
    expect(r).toEqual({ ok: true, anexos: [{ path: caminho(), nome: "proposta.pdf", mime: "application/pdf" }] });
  });

  test("aceita o caminho da tela E-mails, que não tem conversa", () => {
    const daTela = `${TENANT}/emails/1b0f7c6f-0000-4000-8000-000000000001.pdf`;
    expect(validarAnexos([{ path: daTela, nome: "a.pdf", mime: "application/pdf" }], TENANT).ok).toBe(true);
  });

  test("recusa pasta inventada no lugar da conversa", () => {
    const inventado = `${TENANT}/qualquer/1b0f7c6f-0000-4000-8000-000000000001.pdf`;
    expect(validarAnexos([{ path: inventado, nome: "a.pdf", mime: "application/pdf" }], TENANT).ok).toBe(false);
  });

  test("recusa arquivo de outro tenant e caminho com ..", () => {
    const outro = caminho().replace(TENANT, "b0000000-0000-0000-0000-000000000002");
    expect(validarAnexos([{ path: outro, nome: "x.pdf", mime: "application/pdf" }], TENANT).ok).toBe(false);
    expect(validarAnexos([{ path: `${TENANT}/../x.pdf`, nome: "x.pdf", mime: "application/pdf" }], TENANT).ok).toBe(false);
  });

  test("recusa passar do limite de arquivos", () => {
    const muitos = Array.from({ length: ANEXO_MAX_ARQUIVOS + 1 }, () => ({ path: caminho(), nome: "a.pdf", mime: "application/pdf" }));
    expect(validarAnexos(muitos, TENANT).ok).toBe(false);
  });
});

describe("mensagem com anexo", () => {
  const base = { de: { email: "suporte@empresa.com.br" }, para: ["cliente@exemplo.com"], assunto: "Proposta" };

  test("vira multipart/mixed com o corpo na 1ª parte e o arquivo como attachment", () => {
    const m = montarMensagem({
      ...base,
      texto: "oi",
      html: "<p>oi</p>",
      anexos: [{ nome: "proposta.pdf", mime: "application/pdf", base64: btoa("PDF!") }],
    });
    const [cabecalho, ...resto] = m.bruta.split("\r\n\r\n");
    const corpo = resto.join("\r\n\r\n");
    expect(cabecalho).toContain('Content-Type: multipart/mixed; boundary="=_dsm_');
    expect(corpo.indexOf("multipart/alternative")).toBeLessThan(corpo.indexOf("Content-Disposition: attachment"));
    expect(corpo).toContain('Content-Disposition: attachment; filename="proposta.pdf"');
    expect(corpo).toContain(btoa("PDF!"));
    expect(corpo.trimEnd().endsWith("--")).toBe(true);
  });

  test("nome com acento e aspas não quebra o cabeçalho", () => {
    expect(parametroFilename('orçamento "final".pdf')).toBe("filename*=UTF-8''or%C3%A7amento%20_final_.pdf");
    const m = montarMensagem({ ...base, texto: "x", anexos: [{ nome: 'orçamento "final".pdf', mime: "application/pdf", base64: "QQ==" }] });
    expect(m.bruta).not.toContain('"final"');
  });

  test("tipo estranho vira octet-stream", () => {
    const m = montarMensagem({ ...base, texto: "x", anexos: [{ nome: "a.bin", mime: "text/html\r\nBcc: x@y.z", base64: "QQ==" }] });
    expect(m.bruta).toContain("Content-Type: application/octet-stream;");
    expect(m.bruta).not.toContain("Bcc:");
  });

  test("sem anexo, a mensagem continua sem multipart/mixed", () => {
    expect(montarMensagem({ ...base, texto: "x" }).bruta).not.toContain("multipart/mixed");
  });
});

describe("bytesParaBase64", () => {
  test("arquivo grande não estoura a pilha e bate com o btoa", () => {
    const bytes = new Uint8Array(300_000).map((_, i) => i % 256);
    const pequeno = new Uint8Array([72, 105]);
    expect(bytesParaBase64(pequeno)).toBe(btoa("Hi"));
    expect(bytesParaBase64(bytes).length).toBe(Math.ceil(bytes.length / 3) * 4);
  });
});
