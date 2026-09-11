/**
 * Guarda do montador de mensagem. Rodar antes de mexer em mime.ts:
 *   bun test supabase/functions/send-email/
 *
 * O caso que importa é assunto COM ACENTO: ASCII puro passa por outro caminho e
 * não prova nada. Foi assim que o DoctorDev mandou e-mail quebrado por 2 dias.
 */
import { describe, expect, test } from "bun:test";
import { codificarCabecalho, enderecoValido, formatarEndereco, htmlParaTexto, montarMensagem } from "./mime.ts";
import { mensagemAmigavel } from "../test-email-account/smtp.ts";

/** desfaz as palavras =?UTF-8?B?…?= (nunca partimos caractere entre elas) */
const decodificar = (valor: string) =>
  valor
    .replace(/\r\n /g, " ")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) =>
      new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))),
    );

/** linhas do cabeçalho `nome`, com as continuações (linhas que começam com espaço) */
function linhasDoCabecalho(bruta: string, nome: string): string[] {
  const linhas = bruta.split("\r\n");
  const i = linhas.findIndex((l) => l.startsWith(`${nome}:`));
  const saida = [linhas[i]];
  for (let j = i + 1; j < linhas.length && linhas[j].startsWith(" "); j++) saida.push(linhas[j]);
  return saida;
}

const valorDoCabecalho = (bruta: string, nome: string) =>
  linhasDoCabecalho(bruta, nome).join("\r\n").slice(nome.length + 2);

const base = { de: { email: "suporte@empresa.com.br" }, para: ["cliente@exemplo.com"], texto: "x" };

describe("assunto", () => {
  test("ASCII vai como está", () => {
    expect(codificarCabecalho("Teste simples (DEM-0001)")).toBe("Teste simples (DEM-0001)");
  });

  test("com acento: decodifica igual e nenhuma linha passa de 76 colunas", () => {
    const assunto = "Atualização da sua solicitação (DEM-0001) · configuração concluída com êxito";
    const m = montarMensagem({ ...base, assunto });
    const linhas = linhasDoCabecalho(m.bruta, "Subject");
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.length).toBeLessThanOrEqual(76);
    expect(decodificar(valorDoCabecalho(m.bruta, "Subject"))).toBe(assunto);
  });

  test("nenhuma linha de cabeçalho termina em '=' solto (a quebra do denomailer)", () => {
    const m = montarMensagem({ ...base, assunto: "Ação ".repeat(40).trim() });
    const cabecalho = m.bruta.split("\r\n\r\n")[0];
    for (const l of cabecalho.split("\r\n")) {
      if (l.endsWith("=")) expect(l.endsWith("?=")).toBe(true);
    }
  });

  test("emoji não é partido entre palavras", () => {
    const assunto = "✅🚀 Envio 🎉 concluído ".repeat(6).trim();
    const m = montarMensagem({ ...base, assunto });
    expect(decodificar(valorDoCabecalho(m.bruta, "Subject"))).toBe(assunto);
  });

  test("quebra de linha no assunto não injeta cabeçalho", () => {
    const m = montarMensagem({ ...base, assunto: "Oi\r\nBcc: espiao@x.com" });
    expect(m.bruta.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
});

describe("mensagem inteira", () => {
  const html = "<p>Olá, <strong>José</strong></p><p>Linha 2 · ação</p>";
  const m = montarMensagem({
    de: { email: "suporte@empresa.com.br", nome: "Suporte Ação" },
    para: ["a@b.com", "c@d.com"],
    cc: ["e@f.com"],
    responderPara: "resp@empresa.com.br",
    assunto: "Olá",
    html,
  });

  test("só CRLF, nada de LF ou CR solto", () => {
    expect(m.bruta.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("cabeçalhos de endereço e Message-ID do domínio do remetente", () => {
    expect(m.bruta).toContain("\r\nTo: a@b.com, c@d.com\r\n");
    expect(m.bruta).toContain("\r\nCc: e@f.com\r\n");
    expect(m.bruta).toContain("\r\nReply-To: resp@empresa.com.br\r\n");
    expect(m.messageId).toMatch(/^<[0-9a-f-]{36}@empresa\.com\.br>$/);
    expect(decodificar(valorDoCabecalho(m.bruta, "From"))).toBe("Suporte Ação <suporte@empresa.com.br>");
  });

  test("partes texto e HTML decodificam de volta, base64 em linhas de até 76", () => {
    const partes = m.bruta.split(/--=_ds_[0-9a-f]+/);
    const corpo = (p: string) =>
      new TextDecoder().decode(
        Uint8Array.from(atob(p.split("\r\n\r\n")[1].replace(/\r\n/g, "").trim()), (c) => c.charCodeAt(0)),
      );
    expect(corpo(partes[2])).toBe(html);
    expect(corpo(partes[1])).toContain("Olá, José");
    for (const l of m.bruta.split("\r\n")) {
      if (/^[A-Za-z0-9+/=]{20,}$/.test(l)) expect(l.length).toBeLessThanOrEqual(76);
    }
  });
});

describe("endereços", () => {
  test("nome ASCII entre aspas, com acento codificado, vazio vira só o e-mail", () => {
    expect(formatarEndereco("a@b.com", 'Suporte "Top"')).toBe('"Suporte \\"Top\\"" <a@b.com>');
    expect(formatarEndereco("a@b.com", "João")).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
    expect(formatarEndereco("a@b.com", "")).toBe("a@b.com");
  });

  test("validação barra o que injetaria cabeçalho", () => {
    expect(enderecoValido("a.b+c@dominio.com.br")).toBe(true);
    for (const ruim of ["sem-arroba", "a@b", "a b@c.com", "x@y.com>\r\nBcc:z@w.com", "x@y.com, z@w.com"]) {
      expect(enderecoValido(ruim)).toBe(false);
    }
  });
});

test("texto puro a partir do HTML", () => {
  expect(htmlParaTexto("<p>Um</p><p>Dois &amp; três</p><br>Fim")).toBe("Um\nDois & três\n\nFim");
});

describe("frases dos erros de envio", () => {
  test.each([
    ["destinatário x@y.com: servidor respondeu 550 5.1.1 The email account that you tried to reach does not exist", "recusou o destinatário"],
    ["entrega: servidor respondeu 552 5.3.4 Message size exceeds fixed limit", "maior do que o provedor aceita"],
    ["entrega: servidor respondeu 550 5.4.5 Daily user sending limit exceeded", "limitou os envios"],
    ["remetente: servidor respondeu 553 5.7.1 Sender address rejected", "como remetente"],
    ["senha: servidor respondeu 534-5.7.9 Application-specific password required", "senha de aplicativo"],
  ])("%s", (bruto, esperado) => {
    expect(mensagemAmigavel(bruto)).toContain(esperado);
  });
});
