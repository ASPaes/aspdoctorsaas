import { describe, it, expect } from "vitest";
import { resolverProdutoSugerido, renomearColisoes, nomesEmColisao, filtrarPorSelecao, selecaoCompleta } from "./apply";
import type { TemplateBlueprint } from "./types";

const bp = (): TemplateBlueprint => ({
  pipelines: [
    {
      fase: "onboarding", nome: "Onboarding PDV", descricao: null,
      stages: [
        { nome: "A", sla_minutos: 60, checklist: [{ texto: "a1", is_required: true }] },
        { nome: "B", sla_minutos: 60, checklist_groups: [{ nome: "G", demandas: ["Novo Cliente"], itens: [{ texto: "b1", is_required: false }] }] },
      ],
    },
    { fase: "implantacao", nome: "Implantação PDV", descricao: null, stages: [{ nome: "C", sla_minutos: 0 }] },
  ],
  demand_types: [{ nome: "Novo Cliente", descricao: null }, { nome: "Up-Sell", descricao: null }],
  training_types: [{ nome: "Treinamento PDV", conta_como_pdv: true }],
  pause_reasons: [{ nome: "Aguardando cliente" }],
  accounting_fields: [],
  vendor_return_reasons: [{ nome: "Dados errados", atribuivel_vendedor: true }],
});

describe("resolverProdutoSugerido", () => {
  const produtos = [{ id: 7, nome: "Gula" }, { id: 13, nome: "PDV Legal" }];
  it("casa ignorando caixa e espaço", () => {
    expect(resolverProdutoSugerido(produtos, "  pdv legal ")).toBe(13);
  });
  it("devolve null quando não acha ou quando não há sugestão", () => {
    expect(resolverProdutoSugerido(produtos, "PDV Legal Anual")).toBeNull();
    expect(resolverProdutoSugerido(produtos, undefined)).toBeNull();
  });
});

describe("colisão de nome de pipeline", () => {
  it("só colide dentro da mesma jornada", () => {
    const existentes = [{ nome: "Onboarding PDV", fase: "implantacao" }];
    expect(nomesEmColisao(bp(), existentes)).toEqual([]);
  });
  it("aponta e sufixa o que já existe na mesma jornada", () => {
    const existentes = [{ nome: "onboarding pdv", fase: "onboarding" }];
    expect(nomesEmColisao(bp(), existentes)).toEqual(["Onboarding PDV"]);
    expect(renomearColisoes(bp(), existentes).pipelines.map((p) => p.nome))
      .toEqual(["Onboarding PDV (2)", "Implantação PDV"]);
  });
  it("pula sufixos já ocupados", () => {
    const existentes = [
      { nome: "Onboarding PDV", fase: "onboarding" },
      { nome: "Onboarding PDV (2)", fase: "onboarding" },
    ];
    expect(renomearColisoes(bp(), existentes).pipelines[0].nome).toBe("Onboarding PDV (3)");
  });
  it("não muda o original", () => {
    const original = bp();
    renomearColisoes(original, [{ nome: "Onboarding PDV", fase: "onboarding" }]);
    expect(original.pipelines[0].nome).toBe("Onboarding PDV");
  });
});

describe("filtrarPorSelecao", () => {
  it("com tudo marcado devolve o blueprint inteiro", () => {
    const b = bp();
    expect(filtrarPorSelecao(b, selecaoCompleta(b))).toEqual(b);
  });
  it("tira as etapas desmarcadas e o pipeline que ficou vazio", () => {
    const b = bp();
    const sel = selecaoCompleta(b);
    sel.stages[0] = new Set([1]);
    sel.stages[1] = new Set();
    const out = filtrarPorSelecao(b, sel);
    expect(out.pipelines.map((p) => p.nome)).toEqual(["Onboarding PDV"]);
    expect(out.pipelines[0].stages.map((s) => s.nome)).toEqual(["B"]);
  });
  it("tira os itens de catálogo desmarcados", () => {
    const b = bp();
    const sel = selecaoCompleta(b);
    sel.demand_types = new Set([1]);
    expect(filtrarPorSelecao(b, sel).demand_types.map((d) => d.nome)).toEqual(["Up-Sell"]);
  });
});
