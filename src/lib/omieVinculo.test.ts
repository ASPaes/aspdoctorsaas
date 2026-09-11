import { describe, it, expect } from "vitest";
import { mapaVinculoOmie, mapaSemVinculoOmie } from "./omieVinculo";

describe("omieVinculo", () => {
  it("casado pelo CNPJ sem vínculo gravado não conta como sincronizado (SAMIRA, 11/09/2026)", () => {
    const linhas = [
      { ds_contract_id: "a", codigo_contrato_omie: 11342104392, candidato_escolhido: null, status_usuario: "novo" },
    ];
    expect(mapaVinculoOmie(linhas).size).toBe(0);
    expect(mapaSemVinculoOmie(linhas).get("a")).toBe(11342104392);
  });

  it("vinculado conta pelo código que a detecção achou", () => {
    const linhas = [
      { ds_contract_id: "a", codigo_contrato_omie: 111, candidato_escolhido: null, status_usuario: "vinculado" },
    ];
    expect(mapaVinculoOmie(linhas).get("a")).toBe(111);
    expect(mapaSemVinculoOmie(linhas).size).toBe(0);
  });

  it("resolvido usa a escolha explícita, mesmo sem código detectado (VALEMAR)", () => {
    const linhas = [
      { ds_contract_id: "a", codigo_contrato_omie: null, candidato_escolhido: 7248327517, status_usuario: "resolvido" },
    ];
    expect(mapaVinculoOmie(linhas).get("a")).toBe(7248327517);
  });

  it("select sem status_usuario não inventa vínculo", () => {
    const linhas = [{ ds_contract_id: "a", codigo_contrato_omie: 111, candidato_escolhido: null }];
    expect(mapaVinculoOmie(linhas).size).toBe(0);
  });

  it("duas contas: a linha vinculada vence e o contrato não aparece como sem vínculo", () => {
    const linhas = [
      { ds_contract_id: "a", codigo_contrato_omie: 1, candidato_escolhido: null, status_usuario: "novo" },
      { ds_contract_id: "a", codigo_contrato_omie: 2, candidato_escolhido: null, status_usuario: "vinculado" },
    ];
    expect(mapaVinculoOmie(linhas).get("a")).toBe(2);
    expect(mapaSemVinculoOmie(linhas).size).toBe(0);
  });
});
