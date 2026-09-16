import { describe, expect, it } from "vitest";
import {
  assuntoDaEscrita,
  citacaoDoOriginal,
  destinatariosDaResposta,
  limparAssunto,
} from "./respostaEmail";

describe("assunto", () => {
  it("tira o código de resposta e não empilha prefixo", () => {
    expect(limparAssunto("Re: Falha no OMIE [#VPK4UZSG26]")).toBe("Falha no OMIE");
    expect(assuntoDaEscrita("responder", "Re: Falha no OMIE [#VPK4UZSG26]")).toBe("Re: Falha no OMIE");
    expect(assuntoDaEscrita("encaminhar", "Enc: Proposta")).toBe("Enc: Proposta");
    expect(assuntoDaEscrita("responder", null)).toBe("Re: (sem assunto)");
  });
});

describe("destinatários", () => {
  const contasDaCasa = ["suporte@digioffice.com.br", "Vinicius@DigiOffice.com.br"];

  it("responder vai só para quem escreveu", () => {
    expect(
      destinatariosDaResposta({
        modo: "responder",
        de: "contato@espeteria.com.br",
        para: ["suporte@digioffice.com.br", "financeiro@espeteria.com.br"],
        contasDaCasa,
      }),
    ).toEqual({ para: ["contato@espeteria.com.br"], cc: [] });
  });

  it("responder a todos junta os demais, sem repetir e sem as contas da casa", () => {
    expect(
      destinatariosDaResposta({
        modo: "responder_todos",
        de: "contato@espeteria.com.br",
        para: ["suporte@digioffice.com.br", "Financeiro@Espeteria.com.br"],
        cc: ["gerencia@espeteria.com.br", "contato@espeteria.com.br"],
        contasDaCasa,
      }),
    ).toEqual({
      para: ["contato@espeteria.com.br"],
      cc: ["financeiro@espeteria.com.br", "gerencia@espeteria.com.br"],
    });
  });

  it("responder a e-mail que a própria casa enviou não devolve para ela mesma", () => {
    expect(
      destinatariosDaResposta({
        modo: "responder",
        de: "vinicius@digioffice.com.br",
        para: ["cliente@x.com.br"],
        contasDaCasa,
      }),
    ).toEqual({ para: [], cc: [] });
  });

  it("encaminhar começa sem destinatário", () => {
    expect(
      destinatariosDaResposta({ modo: "encaminhar", de: "a@b.com", para: ["c@d.com"], contasDaCasa }),
    ).toEqual({ para: [], cc: [] });
  });
});

describe("citação", () => {
  it("cabeçalho com quem escreveu e o texto dentro do bloco citado", () => {
    const html = citacaoDoOriginal({
      de: "contato@espeteria.com.br",
      quando: "2026-09-15T11:12:00-03:00",
      assunto: "Falha no OMIE",
      corpoTexto: "Bom dia\nSegue o retorno",
    });
    expect(html).toContain("escreveu:");
    expect(html).toContain("contato@espeteria.com.br");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("Bom dia<br>Segue o retorno");
  });

  it("escapa o que parece marcação no texto original", () => {
    const html = citacaoDoOriginal({ de: "<script>", quando: null, assunto: null, corpoTexto: "<b>x</b>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
