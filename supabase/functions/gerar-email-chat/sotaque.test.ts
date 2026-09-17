/**
 * Guarda do sotaque. Rodar com: bun test supabase/functions/gerar-email-chat/
 */
import { describe, expect, test } from "bun:test";
import { ESTADOS, promptSotaque, ufValida } from "./sotaque.ts";

describe("sotaque", () => {
  test("os 27 estados, com sigla de 2 letras", () => {
    expect(Object.keys(ESTADOS)).toHaveLength(27);
    expect(Object.keys(ESTADOS).every((uf) => /^[A-Z]{2}$/.test(uf))).toBe(true);
  });

  test("aceita sigla em minúscula e recusa o que não é estado", () => {
    expect(ufValida("mg")).toBe(true);
    expect(ufValida("XX")).toBe(false);
    expect(ufValida(undefined)).toBe(false);
    expect(ufValida("toString")).toBe(false);
  });

  test("leve e raiz mudam a dose; as regras de fidelidade valem nos dois", () => {
    const leve = promptSotaque("mg", "leve");
    const raiz = promptSotaque("MG", "raiz");
    expect(leve).toContain("Minas Gerais (MG)");
    expect(leve).toContain("Intensidade LEVE");
    expect(raiz).toContain("Intensidade RAIZ");
    for (const p of [leve, raiz]) {
      expect(p).toContain("mesmos fatos");
      expect(p).toContain("caricatura");
      expect(p).toContain("href");
    }
  });
});
