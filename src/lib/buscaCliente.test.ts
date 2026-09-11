import { describe, it, expect } from "vitest";
import { normalizarBuscaCliente, padraoBuscaCliente } from "./buscaCliente";

describe("normalizarBuscaCliente", () => {
  it("o caso VARANDÃO: com e sem acento viram a mesma coisa", () => {
    expect(normalizarBuscaCliente("varandão")).toBe("VARANDAO");
    expect(normalizarBuscaCliente("VARANDAO")).toBe("VARANDAO");
    expect(normalizarBuscaCliente("Varandão Bar")).toBe("VARANDAO BAR");
  });

  it("cobre os acentos que aparecem em nome de empresa brasileira", () => {
    expect(normalizarBuscaCliente("São Conceição Ótimo Ângulo Açaí"))
      .toBe("SAO CONCEICAO OTIMO ANGULO ACAI");
  });

  it("tira o espaço das pontas, que o usuário cola sem querer", () => {
    expect(normalizarBuscaCliente("  padaria  ")).toBe("PADARIA");
  });

  it("não mexe em dígito — a busca por documento continua valendo", () => {
    expect(normalizarBuscaCliente("10248074601")).toBe("10248074601");
  });

  it("padraoBuscaCliente já vem com os dois %", () => {
    expect(padraoBuscaCliente("ção")).toBe("%CAO%");
  });
});
