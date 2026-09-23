import { describe, it, expect } from "vitest";
import {
  modoDoResumo, templatesDoPipeline, pipelinesParaTemplate, montarUpdateResumo, houveConflito,
  type TemplateResumo, type PipelineResumo, type FaseResumo,
} from "./resumoVenda";

const tpl = (p: Partial<TemplateResumo> & { id: string }): TemplateResumo => ({
  nome: p.id, corpo: "", pipeline_id: null, ativo: true, position: 0, ...p,
});

describe("modoDoResumo", () => {
  it("sem payload da integração, a aba é de observação", () => {
    expect(modoDoResumo(null)).toBe("observacao");
    expect(modoDoResumo(undefined)).toBe("observacao");
  });

  it("com payload, é importado mesmo que exista texto escrito à mão", () => {
    expect(modoDoResumo({ cliente: { nome: "X" } })).toBe("importado");
  });
});

describe("templatesDoPipeline", () => {
  const todos = [
    tpl({ id: "geral", pipeline_id: null, position: 2 }),
    tpl({ id: "pdv", pipeline_id: "p1", position: 1 }),
    tpl({ id: "gula", pipeline_id: "p2", position: 0 }),
    tpl({ id: "off", pipeline_id: "p1", position: 0, ativo: false }),
  ];

  it("traz os do pipeline e os genéricos, na ordem de position", () => {
    expect(templatesDoPipeline(todos, "p1").map((t) => t.id)).toEqual(["pdv", "geral"]);
  });

  it("jornada sem pipeline de onboarding fica só com os genéricos", () => {
    expect(templatesDoPipeline(todos, null).map((t) => t.id)).toEqual(["geral"]);
  });

  it("template inativo nunca aparece", () => {
    expect(templatesDoPipeline(todos, "p1").some((t) => t.id === "off")).toBe(false);
  });

  it("empate de position desempata pelo nome", () => {
    const a = tpl({ id: "b", nome: "Beta", pipeline_id: "p1", position: 1 });
    const b = tpl({ id: "a", nome: "Alfa", pipeline_id: "p1", position: 1 });
    expect(templatesDoPipeline([a, b], "p1").map((t) => t.nome)).toEqual(["Alfa", "Beta"]);
  });
});

describe("pipelinesParaTemplate", () => {
  const fases: FaseResumo[] = [
    { id: "f1", slug: "onboarding", ativo: true },
    { id: "f2", slug: "implantacao", ativo: true },
  ];
  const pipes: PipelineResumo[] = [
    { id: "p1", nome: "Onboarding PDV", phase_id: "f1", ativo: true, position: 1 },
    { id: "p2", nome: "Implantação PDV", phase_id: "f2", ativo: true, position: 2 },
    { id: "p3", nome: "Onboarding velho", phase_id: "f1", ativo: false, position: 3 },
  ];

  it("só os pipelines ativos da fase de onboarding", () => {
    expect(pipelinesParaTemplate(fases, pipes).map((p) => p.id)).toEqual(["p1"]);
  });

  it("tenant sem fase de slug onboarding cai para todos os pipelines ativos", () => {
    const semSlug: FaseResumo[] = [{ id: "f1", slug: null, ativo: true }, { id: "f2", slug: null, ativo: true }];
    expect(pipelinesParaTemplate(semSlug, pipes).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("houveConflito", () => {
  it("UPDATE que não pegou nenhuma linha é conflito", () => {
    expect(houveConflito([])).toBe(true);
  });

  it("uma linha afetada é gravação boa", () => {
    expect(houveConflito([{ id: "j1" }])).toBe(false);
  });

  it("retorno que não é lista é tratado como conflito, não como sucesso", () => {
    expect(houveConflito(null)).toBe(true);
    expect(houveConflito(undefined)).toBe(true);
    expect(houveConflito({ id: "j1" })).toBe(true);
  });
});

describe("montarUpdateResumo", () => {
  it("texto vazio grava null e solta o template", () => {
    const u = montarUpdateResumo("   ", "t1", "u1");
    expect(u.resumo_venda_texto).toBeNull();
    expect(u.resumo_venda_template_id).toBeNull();
  });

  it("texto preenchido guarda o template usado e a autoria", () => {
    const u = montarUpdateResumo("Vendeu PDV + Financeiro", "t1", "u1");
    expect(u.resumo_venda_texto).toBe("Vendeu PDV + Financeiro");
    expect(u.resumo_venda_template_id).toBe("t1");
    expect(u.resumo_venda_updated_by).toBe("u1");
    expect(Number.isNaN(Date.parse(u.resumo_venda_updated_at))).toBe(false);
  });
});
