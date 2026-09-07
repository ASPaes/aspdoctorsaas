import { describe, it, expect } from "vitest";
import { parseTemplateParams, inferParamSources } from "./metaTemplateParams";

/**
 * DEM-0350. Os 4 corpos abaixo são os templates APROVADOS que existiam em
 * produção em 07/09/2026 — os únicos, dos 13, que têm variável. O teste existe
 * porque a inferência é um palpite sobre texto livre: se ela errar aqui, manda
 * o nome errado para o cliente no primeiro contato.
 */
const corpo = {
  iniciarvar: "Olá, sou {{1}} aqui da empresa *Delvale Tecnologia*. Podemos conversar agora?",
  iniciarpdv:
    "Olá, sou {{1}} técnico aqui na *Delvale Tecnologia*. Estou entrando em contato para conversar sobre o *Sistema PDV Legal.*\nPodemos conversar agora?",
  iniciarcobr:
    "*Olá, sou {{1}} analista de cobrança da Delvale Tecnologia.*\nGostaria de falar sobre a regularização da sua mensalidade.",
  continuidade:
    "Olá {{nome}}, tudo bem? Gostaríamos de continuar o atendimento que fizemos no dia {{data}}. Estamos com novidades!",
};

const specPosicional = (n: number) => ({
  format: "POSITIONAL" as const,
  names: Array.from({ length: n }, (_, i) => String(i + 1)),
  examples: Array.from({ length: n }, () => ""),
  unsupported: [],
});

describe("inferParamSources", () => {
  it("le 'sou {{1}}' como o nome de quem envia", () => {
    expect(inferParamSources(corpo.iniciarvar, specPosicional(1))).toEqual(["operator"]);
    expect(inferParamSources(corpo.iniciarpdv, specPosicional(1))).toEqual(["operator"]);
  });

  it("atravessa o asterisco de negrito grudado na saudacao", () => {
    expect(inferParamSources(corpo.iniciarcobr, specPosicional(1))).toEqual(["operator"]);
  });

  it("le 'Ola {{nome}},' como o nome do CONTATO, nao o do operador", () => {
    const spec = {
      format: "NAMED" as const,
      names: ["nome", "data"],
      examples: ["", ""],
      unsupported: [],
    };
    // A armadilha da DEM: a variavel se chama "nome" e um de-para por nome de
    // variavel colocaria ali o nome do operador, saudando o cliente com o nome
    // de quem escreve.
    expect(inferParamSources(corpo.continuidade, spec)).toEqual(["contact", null]);
  });

  it("nao chuta o que a frase nao deixa claro", () => {
    const spec = specPosicional(1);
    expect(inferParamSources("Seu protocolo é {{1}}. Guarde este número.", spec)).toEqual([null]);
    expect(inferParamSources("Sua fatura vence em {{1}}.", spec)).toEqual([null]);
    expect(inferParamSources("Confirma o endereço {{1}}?", spec)).toEqual([null]);
  });

  it("aceita as outras formas de se apresentar", () => {
    const spec = specPosicional(1);
    expect(inferParamSources("Oi! Aqui é o {{1}} da Delvale.", spec)).toEqual(["operator"]);
    expect(inferParamSources("Quem fala é a {{1}}, do suporte.", spec)).toEqual(["operator"]);
    expect(inferParamSources("Me chamo {{1}} e vou te atender hoje.", spec)).toEqual(["operator"]);
  });

  it("aceita as outras saudacoes de abertura", () => {
    const spec = specPosicional(1);
    expect(inferParamSources("Bom dia {{1}}, tudo bem?", spec)).toEqual(["contact"]);
    expect(inferParamSources("Prezado {{1}}, segue o combinado.", spec)).toEqual(["contact"]);
  });

  it("saudacao no meio do texto nao vale como abertura", () => {
    // "Olá" aqui não abre o corpo: o que vem antes dele não é vazio.
    expect(
      inferParamSources("Passando para avisar. Olá do time {{1}}!", specPosicional(1)),
    ).toEqual([null]);
  });

  it("devolve null para variavel que nao existe no corpo", () => {
    expect(inferParamSources("Corpo sem variavel nenhuma.", specPosicional(1))).toEqual([null]);
  });

  it("casa com o que o parseTemplateParams extrai do componente da Meta", () => {
    const spec = parseTemplateParams([{ type: "BODY", text: corpo.iniciarvar }]);
    expect(spec.format).toBe("POSITIONAL");
    expect(spec.names).toEqual(["1"]);
    expect(inferParamSources(corpo.iniciarvar, spec)).toEqual(["operator"]);
  });
});
