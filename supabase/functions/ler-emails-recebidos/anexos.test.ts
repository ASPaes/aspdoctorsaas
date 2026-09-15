/**
 * Guarda dos anexos do e-mail do cliente. Rodar antes de mexer em anexos.ts:
 *   bun test supabase/functions/ler-emails-recebidos/
 *
 * Os casos de extração são os do DoctorDev (ler-respostas-email/anexos.test.ts),
 * que quebraram de verdade lá: imagem colada pelo Gmail, nome com acento do
 * Outlook e do Gmail, e-mail encaminhado. Os de seleção são a regra do ticket.
 */
import { describe, expect, it } from "bun:test";
import {
  ANEXO_INLINE_MIN_BYTES, ANEXO_MAX_BYTES, ANEXO_MAX_POR_MENSAGEM, bytesParaBinario, caminhoDoAnexo, extrairAnexos,
  nomeSeguro, normalizarMime, selecionarAnexos, type AnexoEmail,
} from "./anexos.ts";
import { extrairTexto } from "./imap.ts";

const CRLF = "\r\n";
const juntar = (...linhas: string[]) => linhas.join(CRLF);

/** bytes de teste e o base64 quebrado em 76 colunas, como vem no e-mail */
function arquivo(tamanho: number, semente = 7) {
  const bytes = Uint8Array.from({ length: tamanho }, (_, i) => (i * semente + 13) % 256);
  const b64 = btoa(bytesParaBinario(bytes));
  return { bytes, b64: (b64.match(/.{1,76}/g) ?? []).join(CRLF) };
}

describe("extrair anexos", () => {
  it("pega a imagem colada no corpo pelo Gmail (multipart/related)", () => {
    const img = arquivo(5000);
    const bruto = juntar(
      "From: Cliente <cliente@empresa.com.br>",
      'Content-Type: multipart/related; boundary="R"',
      "",
      "--R",
      'Content-Type: multipart/alternative; boundary="A"',
      "",
      "--A",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      "Fiz esse processo agora, porém não foi migrado:",
      "",
      "[image: image.png]",
      "",
      "--A",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      '<div>Fiz esse processo agora<img src="cid:ii_abc" alt="image.png"></div>',
      "--A--",
      "",
      "--R",
      'Content-Type: image/png; name="image.png"',
      'Content-Disposition: inline; filename="image.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <ii_abc>",
      "",
      img.b64,
      "--R--",
      "",
    );

    const anexos = extrairAnexos(bruto);
    expect(anexos).toHaveLength(1);
    expect(anexos[0].nome).toBe("image.png");
    expect(anexos[0].mime).toBe("image/png");
    expect(anexos[0].inline).toBe(true);
    expect(anexos[0].bytes).toEqual(img.bytes);
    // e o texto continua saindo do text/plain, sem o binário da imagem
    expect(extrairTexto(bruto)).toContain("Fiz esse processo agora");
  });

  it("anexo com nome RFC 2231 (Outlook)", () => {
    const pdf = arquivo(3000, 3);
    const bruto = juntar(
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Segue o relatório.",
      "--M",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment; filename*=UTF-8''relat%C3%B3rio%20final.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      pdf.b64,
      "--M--",
      "",
    );

    const [anexo] = extrairAnexos(bruto);
    expect(anexo.nome).toBe("relatório final.pdf");
    expect(anexo.mime).toBe("application/pdf");
    expect(anexo.inline).toBe(false);
    expect(anexo.bytes).toEqual(pdf.bytes);
  });

  it("junta nome RFC 2231 em continuação", () => {
    const bruto = juntar(
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      "Content-Type: image/jpeg",
      "Content-Disposition: attachment; filename*0*=UTF-8''tela%20de; filename*1*=%20erro.jpg",
      "Content-Transfer-Encoding: base64",
      "",
      arquivo(3000).b64,
      "--M--",
      "",
    );
    expect(extrairAnexos(bruto)[0].nome).toBe("tela de erro.jpg");
  });

  it("decodifica nome RFC 2047 no Content-Type (Gmail com acento)", () => {
    const bruto = juntar(
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      'Content-Type: image/png; name="=?UTF-8?B?Y2FwdHVyYS1lcnJvLnBuZw==?="',
      "Content-Transfer-Encoding: base64",
      "",
      arquivo(3000).b64,
      "--M--",
      "",
    );
    expect(extrairAnexos(bruto)[0].nome).toBe("captura-erro.png");
  });

  it("sem nome nenhum ganha nome pelo tipo", () => {
    const bruto = juntar(
      'Content-Type: multipart/related; boundary="R"',
      "",
      "--R",
      "Content-Type: text/plain",
      "",
      "Veja.",
      "--R",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "",
      arquivo(3000).b64,
      "--R--",
      "",
    );
    const [anexo] = extrairAnexos(bruto);
    expect(anexo.nome).toBe("anexo-1.png");
    expect(anexo.inline).toBe(true);
  });

  it("não traz o corpo de texto nem o html como anexo", () => {
    const bruto = juntar(
      'Content-Type: multipart/alternative; boundary="A"',
      "",
      "--A",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Só texto.",
      "--A",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>Só texto.</p>",
      "--A--",
      "",
    );
    expect(extrairAnexos(bruto)).toHaveLength(0);
  });

  it("não desce em e-mail encaminhado dentro da mensagem", () => {
    const bruto = juntar(
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      "Content-Type: text/plain",
      "",
      "Encaminho o que recebi.",
      "--M",
      "Content-Type: message/rfc822",
      "",
      'Content-Type: multipart/mixed; boundary="N"',
      "",
      "--N",
      "Content-Type: image/png",
      'Content-Disposition: attachment; filename="de-outro.png"',
      "Content-Transfer-Encoding: base64",
      "",
      arquivo(3000).b64,
      "--N--",
      "--M--",
      "",
    );
    expect(extrairAnexos(bruto)).toHaveLength(0);
  });

  it("XML de nota fiscal enviado como arquivo sai com os bytes intactos", () => {
    const xml = arquivo(4000, 11);
    const bruto = juntar(
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Nota rejeitada, segue o XML.",
      "--M",
      'Content-Type: application/octet-stream; name="35260912345678000199550010000012341000012345-nfe.xml"',
      'Content-Disposition: attachment; filename="35260912345678000199550010000012341000012345-nfe.xml"',
      "Content-Transfer-Encoding: base64",
      "",
      xml.b64,
      "--M--",
      "",
    );
    const [anexo] = extrairAnexos(bruto);
    expect(anexo.bytes).toEqual(xml.bytes);
    expect(normalizarMime(anexo.mime, anexo.nome)).toBe("application/xml");
  });
});

describe("o que entra no ticket", () => {
  const anexo = (p: Partial<AnexoEmail> & { tamanho?: number }): AnexoEmail => ({
    nome: p.nome ?? "print.png",
    mime: p.mime ?? "image/png",
    bytes: p.bytes ?? new Uint8Array(p.tamanho ?? 5000),
    inline: p.inline ?? false,
  });

  it("aceita print, PDF, XML, planilha e ZIP", () => {
    const { aceitos, ignorados } = selecionarAnexos([
      anexo({ nome: "print.png" }),
      anexo({ nome: "boleto.pdf", mime: "application/pdf" }),
      anexo({ nome: "nota.xml", mime: "text/xml" }),
      anexo({ nome: "relatorio.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      anexo({ nome: "backup.zip", mime: "application/x-zip-compressed" }),
    ]);
    expect(aceitos.map((a) => a.mime)).toEqual([
      "image/png",
      "application/pdf",
      "application/xml",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ]);
    expect(ignorados).toEqual([]);
  });

  it("recusa executável e SVG, dizendo o motivo", () => {
    const { aceitos, ignorados } = selecionarAnexos([
      anexo({ nome: "instalador.exe", mime: "application/x-msdownload" }),
      anexo({ nome: "logo.svg", mime: "image/svg+xml" }),
    ]);
    expect(aceitos).toHaveLength(0);
    expect(ignorados).toEqual([
      "instalador.exe (tipo não aceito: application/x-msdownload)",
      "logo.svg (tipo não aceito: image/svg+xml)",
    ]);
  });

  it("descarta calado o pixel de rastreio colado no corpo, mas mantém arquivo pequeno anexado", () => {
    const { aceitos, ignorados } = selecionarAnexos([
      anexo({ nome: "pixel.gif", mime: "image/gif", inline: true, tamanho: ANEXO_INLINE_MIN_BYTES - 1 }),
      anexo({ nome: "icone.png", inline: false, tamanho: 500 }),
    ]);
    expect(aceitos.map((a) => a.nome)).toEqual(["icone.png"]);
    expect(ignorados).toEqual([]);
  });

  it("arquivo acima de 25 MB fica de fora com o motivo", () => {
    const { aceitos, ignorados } = selecionarAnexos([anexo({ nome: "video.mp4", mime: "video/mp4", tamanho: ANEXO_MAX_BYTES + 1 })]);
    expect(aceitos).toHaveLength(0);
    expect(ignorados).toEqual(["video.mp4 (maior que 25 MB)"]);
  });

  it(`no máximo ${ANEXO_MAX_POR_MENSAGEM} arquivos por e-mail`, () => {
    const muitos = Array.from({ length: ANEXO_MAX_POR_MENSAGEM + 2 }, (_, i) => anexo({ nome: `print-${i + 1}.png` }));
    const { aceitos, ignorados } = selecionarAnexos(muitos);
    expect(aceitos).toHaveLength(ANEXO_MAX_POR_MENSAGEM);
    expect(ignorados).toHaveLength(2);
    expect(ignorados[0]).toContain("passou de 10 arquivos por e-mail");
  });

  it("tipo genérico com extensão conhecida vale a extensão", () => {
    expect(normalizarMime("application/octet-stream", "nota.XML")).toBe("application/xml");
    expect(normalizarMime("application/octet-stream", "sem-extensao")).toBe("application/octet-stream");
    expect(normalizarMime("image/jpg", "foto.jpg")).toBe("image/jpeg");
  });
});

describe("caminho no bucket", () => {
  it("nome seguro tira acento e espaço e preserva a extensão", () => {
    expect(nomeSeguro("relatório final (1).PDF", 0)).toBe("relatorio_final_1_.PDF");
    expect(nomeSeguro("a".repeat(150) + ".xml", 0)).toBe("a".repeat(80) + ".xml");
    expect(nomeSeguro("...", 2)).toBe("anexo-3");
  });

  it("mesmo e-mail cai sempre no mesmo caminho, com o tenant na primeira pasta", async () => {
    const a = await caminhoDoAnexo("tenant-1", "conta|<abc@gmail.com>", 0, "print.png");
    const b = await caminhoDoAnexo("tenant-1", "conta|<abc@gmail.com>", 0, "print.png");
    const outro = await caminhoDoAnexo("tenant-1", "conta|<xyz@gmail.com>", 0, "print.png");
    expect(a).toBe(b);
    expect(a).not.toBe(outro);
    expect(a).toMatch(/^tenant-1\/email\/[0-9a-f]{16}-1-print\.png$/);
  });
});
