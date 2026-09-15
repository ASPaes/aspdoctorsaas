import { describe, expect, it } from "vitest";
import {
  assuntoComReferencia,
  MAX_ASSUNTO,
  referenciaDoAssunto,
  conferirTrava,
  normalizarQuantidade,
  OPCOES_PADRAO,
  separarEmails,
  htmlParaEmail,
  normalizarUrl,
  textoParaParagrafos,
  type OpcoesGeracao,
} from "./travaEnvioEmail";

describe("referência no assunto", () => {
  it("ticket vence atendimento", () => {
    expect(referenciaDoAssunto("TK-2026-4855", "07523/26")).toBe("Ticket TK-2026-4855");
    expect(referenciaDoAssunto(null, "07523/26")).toBe("Atendimento #07523/26");
    expect(referenciaDoAssunto(null, null)).toBeNull();
  });

  it("acrescenta no fim", () => {
    expect(assuntoComReferencia(" Falha no OMIE ", "Atendimento #07523/26")).toBe("Falha no OMIE · Atendimento #07523/26");
  });

  it("não repete se a pessoa já escreveu", () => {
    expect(assuntoComReferencia("Retorno do atendimento #07523/26", "Atendimento #07523/26")).toBe("Retorno do atendimento #07523/26");
  });

  it("sem referência, fica como está", () => {
    expect(assuntoComReferencia("Olá", null)).toBe("Olá");
  });

  it("corta o assunto, nunca a referência, para caber no limite", () => {
    const r = assuntoComReferencia("x".repeat(400), "Ticket TK-2026-4855");
    expect(r.length).toBeLessThanOrEqual(MAX_ASSUNTO);
    expect(r.endsWith(" · Ticket TK-2026-4855")).toBe(true);
  });
});

describe("textoParaParagrafos", () => {
  it("parágrafo por linha em branco, <br> por quebra simples, lista por •", () => {
    expect(textoParaParagrafos("Prezados,\n\nEscopo:\n• Cardápio\n• Usuários\n\n\nAtenciosamente,\nVinicius")).toBe(
      "<p>Prezados,</p><p>Escopo:</p><ul><li><p>Cardápio</p></li><li><p>Usuários</p></li></ul><p>Atenciosamente,<br>Vinicius</p>",
    );
  });

  it("escapa o que parece marcação", () => {
    expect(textoParaParagrafos('<script>x</script> & "a"')).toBe("<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;a&quot;</p>");
  });

  it("vazio", () => {
    expect(textoParaParagrafos("")).toBe("");
  });
});

describe("htmlParaEmail", () => {
  it("margens inline, parágrafo vazio visível e item de lista sem folga", () => {
    const html = htmlParaEmail("<p>Olá</p><p></p><ul><li><p>A</p></li></ul>");
    expect(html.startsWith('<div style="font-family:Arial')).toBe(true);
    expect(html).toContain('<p style="margin:0 0 12px;">Olá</p>');
    expect(html).toContain('<p style="margin:0 0 12px;"><br></p>');
    expect(html).toContain('<ul style="margin:0 0 12px;padding-left:22px"><li><p style="margin:0;">A</p></li></ul>');
  });

  it("mantém o alinhamento que veio do editor", () => {
    expect(htmlParaEmail('<p style="text-align: center">X</p>')).toContain('<p style="margin:0 0 12px;text-align: center">X</p>');
  });
});

describe("normalizarUrl", () => {
  it("completa protocolo, reconhece e-mail e respeita o que já veio certo", () => {
    expect(normalizarUrl(" ajuda.gulamenu.com.br/manual ")).toBe("https://ajuda.gulamenu.com.br/manual");
    expect(normalizarUrl("http://x.com")).toBe("http://x.com");
    expect(normalizarUrl("suporte@digioffice.com.br")).toBe("mailto:suporte@digioffice.com.br");
    expect(normalizarUrl("")).toBe("");
  });
});

const op = (o: Partial<OpcoesGeracao>): OpcoesGeracao => ({ ...OPCOES_PADRAO, ...o });

describe("conferirTrava", () => {
  it("abre liberado: opções iguais às da geração", () => {
    expect(conferirTrava(OPCOES_PADRAO, OPCOES_PADRAO)).toEqual({ travado: false, aviso: null });
  });

  it("trocou só o tom", () => {
    const r = conferirTrava(op({ tom: "amigavel" }), OPCOES_PADRAO);
    expect(r.travado).toBe(true);
    expect(r.aviso).toBe("Você trocou o tom do e-mail. Clique em Gerar novo antes de enviar.");
  });

  it("trocou só o atendimento", () => {
    const r = conferirTrava(op({ base: "resumo", quantidade: 3 }), OPCOES_PADRAO);
    expect(r.aviso).toBe("Você trocou o atendimento usado no e-mail. Clique em Gerar novo antes de enviar.");
  });

  it("trocou só a quantidade, com resumo dos dois lados", () => {
    const r = conferirTrava(op({ base: "resumo", quantidade: 5 }), op({ base: "resumo", quantidade: 3 }));
    expect(r.aviso).toBe("Você trocou a quantidade de atendimentos. Clique em Gerar novo antes de enviar.");
  });

  it("trocou atendimento e tom", () => {
    const r = conferirTrava(op({ base: "resumo", tom: "tecnico" }), OPCOES_PADRAO);
    expect(r.aviso).toBe("Você trocou o atendimento e o tom do e-mail. Clique em Gerar novo antes de enviar.");
  });

  it("trocou quantidade e tom", () => {
    const r = conferirTrava(op({ base: "resumo", quantidade: 4, tom: "tecnico" }), op({ base: "resumo", quantidade: 2 }));
    expect(r.aviso).toBe("Você trocou a quantidade de atendimentos e o tom do e-mail. Clique em Gerar novo antes de enviar.");
  });

  it("quantidade não conta com Último atendimento dos dois lados", () => {
    expect(conferirTrava(op({ quantidade: 7 }), op({ quantidade: 1 })).travado).toBe(false);
  });

  it("exemplo do Alexandre: gerou em Amigável, foi para Técnico e voltou sem gerar", () => {
    const gerado = op({ tom: "amigavel" });
    expect(conferirTrava(op({ tom: "tecnico" }), gerado).travado).toBe(true);
    expect(conferirTrava(op({ tom: "amigavel" }), gerado).travado).toBe(false);
    // voltar para o padrão (Formal) depois de gerar em Amigável trava
    expect(conferirTrava(op({ tom: "formal" }), gerado).travado).toBe(true);
  });
});

describe("normalizarQuantidade", () => {
  it("prende entre 1 e 10", () => {
    expect(normalizarQuantidade(0)).toBe(1);
    expect(normalizarQuantidade(NaN)).toBe(1);
    expect(normalizarQuantidade(3.7)).toBe(3);
    expect(normalizarQuantidade(99)).toBe(10);
  });
});

describe("separarEmails", () => {
  it("separa campo com dois endereços e descarta lixo", () => {
    expect(separarEmails("Contato@Loja.com.br; financeiro@loja.com.br, xx , contato@loja.com.br")).toEqual([
      "contato@loja.com.br",
      "financeiro@loja.com.br",
    ]);
  });
  it("vazio", () => {
    expect(separarEmails(null)).toEqual([]);
    expect(separarEmails("")).toEqual([]);
  });
});
