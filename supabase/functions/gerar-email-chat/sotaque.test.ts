/**
 * Guarda da reescrita (Sotaque, Idioma, Tamanho). Rodar com:
 *   bun test supabase/functions/gerar-email-chat/
 */
import { describe, expect, test } from "bun:test";
import { ESTADOS, lerReescrita, promptReescrita, ufValida } from "./sotaque.ts";

describe("estados", () => {
  test("os 27 estados, com sigla de 2 letras", () => {
    expect(Object.keys(ESTADOS)).toHaveLength(27);
    expect(Object.keys(ESTADOS).every((uf) => /^[A-Z]{2}$/.test(uf))).toBe(true);
  });

  test("aceita sigla em minúscula e recusa o que não é estado", () => {
    expect(ufValida("mg")).toBe(true);
    expect(ufValida("XX")).toBe(false);
    expect(ufValida(undefined)).toBe(false);
    expect(ufValida("constructor")).toBe(false);
  });
});

describe("lerReescrita", () => {
  test("sotaque, idioma e tamanho válidos", () => {
    expect(lerReescrita({ sotaque: { uf: "rs", intensidade: "raiz" } })).toEqual({
      sotaque: { uf: "RS", intensidade: "raiz" },
      idioma: null,
      tamanho: null,
    });
    expect(lerReescrita({ idioma: "es", tamanho: "curto" })).toEqual({ sotaque: null, idioma: "es", tamanho: "curto" });
    expect(lerReescrita({ sotaque: { uf: "MG" }, tamanho: "detalhado" })).toEqual({
      sotaque: { uf: "MG", intensidade: "leve" },
      idioma: null,
      tamanho: "detalhado",
    });
  });

  test("recusa pedido vazio, estado inválido e sotaque junto com idioma", () => {
    expect(lerReescrita({})).toBeNull();
    expect(lerReescrita({ idioma: "fr" })).toBeNull();
    expect(lerReescrita({ sotaque: { uf: "XX" }, tamanho: "curto" })).toBeNull();
    expect(lerReescrita({ sotaque: { uf: "MG" }, idioma: "en" })).toBeNull();
  });
});

describe("promptReescrita", () => {
  test("sotaque leve e raiz, com as regras de respeito", () => {
    const leve = promptReescrita({ sotaque: { uf: "MG", intensidade: "leve" }, idioma: null, tamanho: null });
    const raiz = promptReescrita({ sotaque: { uf: "MG", intensidade: "raiz" }, idioma: null, tamanho: null });
    expect(leve).toContain("Minas Gerais (MG)");
    expect(leve).toContain("Intensidade LEVE");
    expect(raiz).toContain("Intensidade RAIZ");
    expect(leve).toContain("caricatura");
    expect(leve).toContain("português do Brasil");
  });

  test("idioma e tamanho juntos; fidelidade vale sempre", () => {
    const p = promptReescrita({ sotaque: null, idioma: "es", tamanho: "curto" });
    expect(p).toContain("em espanhol");
    expect(p).toContain("mais curto");
    expect(p).not.toContain("SOTAQUE");
    expect(p).toContain("mesmos fatos");
    expect(p).toContain("href");
  });
});
