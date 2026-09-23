import { describe, it, expect } from "vitest";
import { normalizeCidadeNome, acharCidadePorNome } from "./cidadeLookup";

const CIDADES_RS = [
  { id: 5054, nome: "Teutônia" },
  { id: 5001, nome: "Porto Alegre" },
  { id: 5002, nome: "Santana do Livramento" },
  { id: 5003, nome: "Sant'Ana do Livramento" },
];

describe("normalizeCidadeNome", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalizeCidadeNome("Teutônia")).toBe("teutonia");
    expect(normalizeCidadeNome("TEUTONIA")).toBe("teutonia");
    expect(normalizeCidadeNome("Sant'Ana do Livramento")).toBe("santanadolivramento");
    expect(normalizeCidadeNome("SÃO PAULO")).toBe("saopaulo");
  });
});

describe("acharCidadePorNome", () => {
  it("casa o município sem acento da Receita com o nome acentuado do banco", () => {
    expect(acharCidadePorNome(CIDADES_RS, "TEUTONIA")?.id).toBe(5054);
  });

  it("continua casando o nome acentuado do ViaCEP", () => {
    expect(acharCidadePorNome(CIDADES_RS, "Teutônia")?.id).toBe(5054);
  });

  it("devolve null quando não existe no estado", () => {
    expect(acharCidadePorNome(CIDADES_RS, "Curitiba")).toBeNull();
  });

  it("devolve null para nome vazio, em vez de casar a primeira cidade", () => {
    expect(acharCidadePorNome(CIDADES_RS, "")).toBeNull();
  });
});
