/**
 * Guarda das regras de destino e do aviso de abertura. Rodar antes de mexer em rotas.ts:
 *   bun test supabase/functions/ler-emails-recebidos/
 */
import { describe, expect, test } from "bun:test";
import {
  assuntoConfirmacao, ehDeUmaDasNossasCaixas, enderecosDe, htmlConfirmacao, primeiroNome,
  resolverEnderecoDestino, semSufixo,
} from "./rotas.ts";

describe("endereços", () => {
  test("tira o sufixo da identificação e deixa minúsculo", () => {
    expect(semSufixo("Suporte+K7M2Q9XP4D@Empresa.com.br")).toBe("suporte@empresa.com.br");
    expect(semSufixo(" financeiro@empresa.com.br ")).toBe("financeiro@empresa.com.br");
  });

  test("acha todos os endereços do cabeçalho, inclusive com nome que tem vírgula", () => {
    expect(enderecosDe('"Silva, João" <joao@x.com.br>, Maria <MARIA@y.com>')).toEqual(["joao@x.com.br", "maria@y.com"]);
    expect(enderecosDe(undefined)).toEqual([]);
  });
});

describe("destino do e-mail novo", () => {
  const conhecidos = new Set(["suporte@empresa.com.br", "financeiro@empresa.com.br"]);

  test("endereço que o cliente digitou vale mais que o da caixa (financeiro@ chegando na caixa do suporte)", () => {
    const cab = { to: "Financeiro <financeiro@empresa.com.br>", "delivered-to": "suporte@empresa.com.br" };
    expect(resolverEnderecoDestino(cab, conhecidos, "suporte@empresa.com.br")).toBe("financeiro@empresa.com.br");
  });

  test("em cópia também conta", () => {
    const cab = { to: "fornecedor@outro.com", cc: "suporte@empresa.com.br" };
    expect(resolverEnderecoDestino(cab, conhecidos, "suporte@empresa.com.br")).toBe("suporte@empresa.com.br");
  });

  test("resposta com sufixo de identificação cai no endereço sem sufixo", () => {
    const cab = { to: "suporte+K7M2Q9XP4D@empresa.com.br" };
    expect(resolverEnderecoDestino(cab, conhecidos, "outra@empresa.com.br")).toBe("suporte@empresa.com.br");
  });

  test("cópia oculta (nenhum destinatário conhecido) usa o endereço da caixa", () => {
    const cab = { to: "alguem@cliente.com.br" };
    expect(resolverEnderecoDestino(cab, conhecidos, "Suporte@Empresa.com.br")).toBe("suporte@empresa.com.br");
  });

  test("mensagem que saiu de caixa nossa é reconhecida, com ou sem sufixo", () => {
    expect(ehDeUmaDasNossasCaixas("Suporte+ABC@empresa.com.br", conhecidos)).toBe(true);
    expect(ehDeUmaDasNossasCaixas("marina@padaria.com.br", conhecidos)).toBe(false);
  });
});

describe("aviso de abertura", () => {
  test("primeiro nome para a saudação", () => {
    expect(primeiroNome("Marina Costa")).toBe("Marina");
    expect(primeiroNome("JOÃO PEREIRA")).toBe("João");
    expect(primeiroNome('"Carla"')).toBe("Carla");
    expect(primeiroNome("financeiro@padaria.com.br")).toBe("");
    expect(primeiroNome("(11) 99999")).toBe("");
    expect(primeiroNome(null)).toBe("");
  });

  test("texto escapado, com código, assunto e setor", () => {
    const html = htmlConfirmacao({ nome: "Marina Costa", assunto: "Impressora <não> imprime", codigo: "TK-2026-04127", setor: "Suporte" });
    expect(html).toContain("Olá, Marina!");
    expect(html).toContain("Impressora &lt;não&gt; imprime");
    expect(html).toContain("<strong>TK-2026-04127</strong> no setor Suporte");
    expect(html).not.toContain("<não>");
  });

  test("sem nome e sem assunto continua legível", () => {
    const html = htmlConfirmacao({ nome: "", assunto: "", codigo: "TK-1" });
    expect(html).toContain("Olá!");
    expect(html).toContain("Recebemos sua mensagem e abrimos o chamado");
    expect(assuntoConfirmacao("TK-1")).toBe("Recebemos seu chamado TK-1");
  });
});
