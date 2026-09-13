import { describe, it, expect } from "vitest";
import { documentoCompleto } from "./cnpjDigitsVariants";

describe("documentoCompleto", () => {
  it("CPF com 11 dígitos conta — era o furo do aviso", () => {
    // O VARANDÃO BAR entrou duplicado com o CPF 102.480.746-01. Em cadastro novo o
    // seletor de tipo fica em "jurídica", e a régua antiga (>= 14) descartava CPF.
    expect(documentoCompleto("10248074601")).toBe(true);
  });

  it("CNPJ com 14 dígitos conta", () => {
    expect(documentoCompleto("65324495000150")).toBe(true);
  });

  it("documento pela metade não dispara nada", () => {
    expect(documentoCompleto("")).toBe(false);
    expect(documentoCompleto("1024807")).toBe(false);
    expect(documentoCompleto("6532449500")).toBe(false);
  });

  it("13 dígitos é CNPJ incompleto, não passa", () => {
    expect(documentoCompleto("6532449500015")).toBe(false);
  });
});
