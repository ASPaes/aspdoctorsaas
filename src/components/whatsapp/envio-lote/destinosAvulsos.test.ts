import { describe, expect, it } from "vitest";
import { chaveTelefone, lerLinhas, lerTexto } from "./destinosAvulsos";

describe("chaveTelefone", () => {
  it("celular com e sem o 9 é a mesma chave", () => {
    expect(chaveTelefone("5549999112233")).toBe(chaveTelefone("554999112233"));
  });
  it("fixo não perde dígito", () => {
    expect(chaveTelefone("554933221100")).toBe("554933221100");
  });
});

describe("lerLinhas (planilha)", () => {
  it("com cabeçalho nome/telefone", () => {
    const r = lerLinhas([["Nome", "Telefone"], ["Joana Silva", "(49) 99911-2233"], ["Pedro", "11 98888-7777"]]);
    expect(r.validos).toEqual([
      { nome: "Joana Silva", telefone: "5549999112233" },
      { nome: "Pedro", telefone: "5511988887777" },
    ]);
  });
  it("cabeçalho na ordem invertida", () => {
    const r = lerLinhas([["telefone", "nome"], ["49999112233", "Joana"]]);
    expect(r.validos[0]).toEqual({ nome: "Joana", telefone: "5549999112233" });
  });
  it("sem cabeçalho, telefone na primeira coluna", () => {
    const r = lerLinhas([["49999112233", "Joana"]]);
    expect(r.validos[0]).toEqual({ nome: "Joana", telefone: "5549999112233" });
  });
  it("número do Excel como número e linha vazia", () => {
    const r = lerLinhas([["Joana", 49999112233 as unknown as string], [], ["", ""]]);
    expect(r.validos).toHaveLength(1);
  });
  it("inválido vai para a lista de recusados e duplicado some", () => {
    const r = lerLinhas([["Nome", "Telefone"], ["A", "123"], ["B", "49999112233"], ["C", "554999112233"]]);
    expect(r.validos).toHaveLength(1);
    expect(r.invalidos).toEqual(["A 123"]);
  });
});

describe("lerTexto (digitado)", () => {
  it("um por linha, com e sem nome", () => {
    const r = lerTexto("49999112233\nPedro; 11 98888-7777\nMaria\t(48) 99123-4567");
    expect(r.validos.map((v) => v.nome)).toEqual(["", "Pedro", "Maria"]);
    expect(r.validos).toHaveLength(3);
  });
  it("vários números na mesma linha separados por vírgula", () => {
    const r = lerTexto("49999112233, 11988887777, 48991234567");
    expect(r.validos).toHaveLength(3);
  });
  it("nome, telefone com vírgula", () => {
    const r = lerTexto("Pedro Souza, 11 98888-7777");
    expect(r.validos[0]).toEqual({ nome: "Pedro Souza", telefone: "5511988887777" });
  });
});
