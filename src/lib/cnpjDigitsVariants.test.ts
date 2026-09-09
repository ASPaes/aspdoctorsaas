import { describe, it, expect } from "vitest";
import { cnpjDigitsVariants } from "./cnpjDigitsVariants";

describe("cnpjDigitsVariants", () => {
  it("acha o CPF gravado com zero-fill de 14 dígitos pela importação", () => {
    // 374.105.258-27 está na base como 00037410525827
    expect(cnpjDigitsVariants("37410525827")).toContain("00037410525827");
  });

  it("mantém o que foi digitado", () => {
    expect(cnpjDigitsVariants("37410525827")).toContain("37410525827");
  });

  it("acha o CPF de 11 dígitos quando o campo veio com os zeros", () => {
    expect(cnpjDigitsVariants("00037410525827")).toContain("37410525827");
  });

  it("não inventa variante para CNPJ de 14 dígitos", () => {
    expect(cnpjDigitsVariants("42824745000115")).toEqual(["42824745000115"]);
  });

  it("descarta variante curta demais para ser documento", () => {
    // tirar os zeros deixaria "1", que casaria com qualquer coisa
    expect(cnpjDigitsVariants("00000000000001")).toEqual(["00000000000001"]);
  });
});
