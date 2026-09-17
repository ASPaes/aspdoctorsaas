import { describe, expect, it } from "vitest";
import { alternarIdioma, alternarTamanho, comSotaque, NOME_ESTADO, REGIOES, SEM_AJUSTES, semAjustes } from "./estadosSotaque";

describe("estados do sotaque", () => {
  it("as regiões cobrem os 27 estados, sem repetir", () => {
    const ufs = REGIOES.flatMap((r) => r.ufs);
    expect(new Set(ufs).size).toBe(27);
    expect(ufs.every((uf) => uf in NOME_ESTADO)).toBe(true);
  });
});

describe("combinação de ajustes", () => {
  it("idioma tira o sotaque; sotaque tira o idioma; tamanho fica", () => {
    const mgCurto = comSotaque(alternarTamanho(SEM_AJUSTES, "curto"), "MG", "leve");
    expect(mgCurto).toEqual({ sotaque: { uf: "MG", intensidade: "leve" }, idioma: null, tamanho: "curto" });

    const espanhol = alternarIdioma(mgCurto, "es");
    expect(espanhol).toEqual({ sotaque: null, idioma: "es", tamanho: "curto" });

    expect(comSotaque(espanhol, "RS", "raiz")).toEqual({ sotaque: { uf: "RS", intensidade: "raiz" }, idioma: null, tamanho: "curto" });
  });

  it("clicar de novo no que está aplicado tira", () => {
    const en = alternarIdioma(SEM_AJUSTES, "en");
    expect(alternarIdioma(en, "en")).toEqual(SEM_AJUSTES);
    expect(semAjustes(alternarTamanho(alternarTamanho(SEM_AJUSTES, "detalhado"), "detalhado"))).toBe(true);
    expect(alternarTamanho(alternarTamanho(SEM_AJUSTES, "curto"), "detalhado").tamanho).toBe("detalhado");
  });
});
