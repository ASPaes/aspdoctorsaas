/**
 * Guarda do parsing da caixa. Rodar antes de mexer em imap.ts:
 *   bun test supabase/functions/ler-emails-recebidos/
 *
 * Os casos aqui são os que quebram de verdade: literal do IMAP com quebra de
 * linha dentro, assunto com acento, citação dobrada do Gmail e os cabeçalhos
 * que separam resposta de gente de disparo automático.
 */
import { describe, expect, test } from "bun:test";
import {
  ClienteImap, acharToken, cortarCitacao, decodificarCabecalho, decodificarQuotedPrintable,
  ehAutomatico, extrairEndereco, extrairTexto, lerCabecalhos, novosDesde, paraBinario, separarFetch,
} from "./imap.ts";

const CRLF = "\r\n";

describe("protocolo", () => {
  test("separa duas mensagens com literal que tem quebra de linha dentro", () => {
    const c1 = `Subject: Um${CRLF}From: a@b.com${CRLF}`;
    const c2 = `Subject: Dois${CRLF}From: c@d.com${CRLF}`;
    const bruto =
      `* 1 FETCH (UID 101 BODY[HEADER.FIELDS (SUBJECT FROM)] {${c1.length}}${CRLF}${c1})${CRLF}` +
      `* 2 FETCH (UID 102 BODY[HEADER.FIELDS (SUBJECT FROM)] {${c2.length}}${CRLF}${c2})${CRLF}` +
      `a3 OK FETCH completed${CRLF}`;
    const partes = separarFetch(bruto);
    expect(partes.map((p) => p.uid)).toEqual([101, 102]);
    expect(partes[0].cabecalho).toBe(c1);
    expect(partes[1].cabecalho).toBe(c2);
  });

  test("cabeçalho dobrado vira uma linha só, em minúsculo", () => {
    const cab = lerCabecalhos(`Subject: Resumo do seu${CRLF} atendimento${CRLF}From: a@b.com${CRLF}${CRLF}corpo`);
    expect(cab["subject"]).toBe("Resumo do seu atendimento");
    expect(cab["from"]).toBe("a@b.com");
  });
});

describe("o que o servidor real manda", () => {
  const bytes = (t: string) => new TextEncoder().encode(t);
  const bin = (t: string) => paraBinario(bytes(t));

  test("UID depois do literal e acento cru não desalinham a mensagem seguinte", () => {
    const c1 = `Subject: Não entendi a cobrança${CRLF}From: João <a@b.com>${CRLF}`;
    const c2 = `Subject: Dois${CRLF}From: c@d.com${CRLF}`;
    const bruto =
      `* 7 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM)] {${bytes(c1).length}}${CRLF}${bin(c1)} UID 10107)${CRLF}` +
      `* 8 FETCH (UID 10108 BODY[HEADER.FIELDS (SUBJECT FROM)] {${bytes(c2).length}}${CRLF}${bin(c2)})${CRLF}` +
      `a4 OK Success${CRLF}`;
    const partes = separarFetch(bruto);
    expect(partes.map((p) => p.uid)).toEqual([10107, 10108]);
    expect(partes[0].cabecalho).toBe(c1);
    expect(partes[1].cabecalho).toBe(c2);
  });

  test("sem mensagem nova o servidor devolve a última de novo, e ela é descartada", () => {
    expect(novosDesde([{ uid: 10106 }], 10106)).toEqual([]);
    expect(novosDesde([{ uid: 10106 }, { uid: 10107 }], 10106)).toEqual([{ uid: 10107 }]);
  });

  test("resposta picada no socket, com linha parecida com a etiqueta dentro do literal", async () => {
    const conteudo = `Subject: Ação${CRLF}a1 OK isto é conteúdo, não fim${CRLF}${CRLF}corpo`;
    const resposta = new Uint8Array([
      ...bytes(`* 1 FETCH (UID 5 BODY[] {${bytes(conteudo).length}}${CRLF}`),
      ...bytes(conteudo),
      ...bytes(`)${CRLF}a1 OK FETCH completed${CRLF}`),
    ]);
    // corta no meio do "ç" (2 bytes) e deixa a etiqueta falsa em outro pedaço
    const corte = resposta.indexOf(0xc3);
    const pedacos = [resposta.subarray(0, corte + 1), resposta.subarray(corte + 1, corte + 20), resposta.subarray(corte + 20)];

    const cliente = new ClienteImap("imap.teste", 993, "ssl") as any;
    cliente.conn = {
      write: async (b: Uint8Array) => b.length,
      read: async (destino: Uint8Array) => {
        const p = pedacos.shift();
        if (!p) return null;
        destino.set(p);
        return p.length;
      },
    };

    const partes = separarFetch(await cliente.comando("UID FETCH 5 (BODY.PEEK[])"));
    expect(partes).toHaveLength(1);
    expect(partes[0].uid).toBe(5);
    expect(partes[0].cabecalho).toBe(conteudo);
  });
});

describe("acentos", () => {
  test("assunto em base64 e em quoted-printable volta igual", () => {
    expect(decodificarCabecalho("=?UTF-8?B?UmVzdW1vIGRvIGF0ZW5kaW1lbnRvIGRlIDExLzA5?=")).toBe("Resumo do atendimento de 11/09");
    expect(decodificarCabecalho("=?UTF-8?Q?Configura=C3=A7=C3=A3o_conclu=C3=ADda?=")).toBe("Configuração concluída");
  });

  test("palavras codificadas vizinhas se juntam sem espaço sobrando", () => {
    const assunto = decodificarCabecalho("=?UTF-8?B?QcOnw6Nv?= =?UTF-8?B?IGNvbmNsdcOtZGE=?=");
    expect(assunto).toBe("Ação concluída");
  });

  test("quoted-printable com quebra suave", () => {
    const bytes = decodificarQuotedPrintable("Configura=C3=A7=\r\n=C3=A3o");
    expect(new TextDecoder().decode(bytes)).toBe("Configuração");
  });

  test("remetente com nome codificado", () => {
    expect(extrairEndereco("=?UTF-8?B?Sm/Do28gZGEgU2lsdmE=?= <JOAO@Exemplo.com.br>")).toEqual({
      nome: "João da Silva",
      email: "joao@exemplo.com.br",
    });
    expect(extrairEndereco(" ana@x.com ")).toEqual({ nome: "", email: "ana@x.com" });
  });
});

describe("corpo", () => {
  const multipart = [
    "Content-Type: multipart/alternative; boundary=\"XYZ\"",
    "",
    "--XYZ",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Obrigado! O boleto chegou certinho agora, tudo resolvido por a=C3=ADqui.",
    "--XYZ",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa("<p>ignorar</p>"),
    "--XYZ--",
  ].join(CRLF);

  test("prefere texto puro e decodifica o acento", () => {
    expect(extrairTexto(multipart)).toContain("chegou certinho agora");
    expect(extrairTexto(multipart)).toContain("aíqui");
  });

  test("só HTML vira texto legível", () => {
    const somenteHtml = [
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>Bom dia</p><p>ainda est&aacute; com problema</p>",
    ].join(CRLF);
    expect(extrairTexto(somenteHtml)).toContain("Bom dia");
  });
});

describe("corte da citação", () => {
  test("atribuição dobrada do Gmail não vaza para a resposta", () => {
    const texto = [
      "Pode fechar, resolvido.",
      "",
      "Em qua., 11 de set. de 2026 às 14:32, Suporte <suporte@empresa.com.br>",
      "escreveu:",
      "",
      "> Olá, segue o resumo do atendimento",
    ].join("\n");
    expect(cortarCitacao(texto)).toBe("Pode fechar, resolvido.");
  });

  test("Gmail quebrando a atribuição dentro do <e-mail> (resposta real de 12/09/2026)", () => {
    const texto = [
      "Boa noite,",
      "",
      "Muito obrigado pelo retorno.",
      "",
      "Em sáb., 12 de set. de 2026, 19:39, Suporte Gula Menu <",
      "vinicius@digioffice.com.br> escreveu:",
    ].join("\n");
    expect(cortarCitacao(texto)).toBe("Boa noite,\n\nMuito obrigado pelo retorno.");
  });

  test("frase comum começando com Em não é cortada", () => {
    const texto = "Em breve envio o comprovante.\nObrigado,\nJoão";
    expect(cortarCitacao(texto)).toBe(texto);
  });

  test("citação com > e mensagem original", () => {
    expect(cortarCitacao("Ok, obrigado\n\n> texto antigo")).toBe("Ok, obrigado");
    expect(cortarCitacao("Segue\n-----Mensagem original-----\nblá")).toBe("Segue");
  });
});

describe("identificação do envio", () => {
  test("acha no endereço com sufixo e no assunto", () => {
    expect(acharToken({ to: "suporte+A2B3C4D5E6@empresa.com.br" })).toBe("A2B3C4D5E6");
    expect(acharToken({ "delivered-to": "Suporte <suporte+a2b3c4d5e6@empresa.com.br>" })).toBe("A2B3C4D5E6");
    expect(acharToken({ to: "suporte@empresa.com.br", subject: "Re: Resumo [#A2B3C4D5E6]" })).toBe("A2B3C4D5E6");
    expect(acharToken({ to: "suporte@empresa.com.br", subject: "=?UTF-8?B?UmU6IEHDp8OjbyBbI0EyQjNDNEQ1RTZd?=" })).toBe("A2B3C4D5E6");
  });

  test("sem identificação nenhuma devolve nulo", () => {
    expect(acharToken({ to: "suporte@empresa.com.br", subject: "Promoção imperdível" })).toBeNull();
  });
});

describe("propaganda e automático", () => {
  test.each([
    [{ "list-unsubscribe": "<https://x/u>" }, true],
    [{ precedence: "bulk" }, true],
    [{ "auto-submitted": "auto-replied" }, true],
    [{ "x-auto-response-suppress": "All" }, true],
    [{ from: "no-reply@banco.com.br" }, true],
    [{ from: "Financeiro <financeiro@cliente.com.br>", "auto-submitted": "no" }, false],
  ])("%o", (cab, esperado) => {
    expect(ehAutomatico(cab as Record<string, string>)).toBe(esperado);
  });
});
