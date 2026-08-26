import { describe, it, expect } from "vitest";
import { PDV_LEGAL_TEMPLATE } from "./pdvLegal";
import { resumoTemplate } from "./index";

const stages = PDV_LEGAL_TEMPLATE.blueprint.pipelines.flatMap((p) => p.stages);
const groups = stages.flatMap((s) => s.checklist_groups ?? []);
const itens = groups.flatMap((g) => g.itens);

describe("template PDV Legal", () => {
  it("tem os 2 pipelines de PDV, um por jornada", () => {
    const nomes = PDV_LEGAL_TEMPLATE.blueprint.pipelines.map((p) => `${p.fase}:${p.nome}`);
    expect(nomes).toEqual(["onboarding:Onboarding PDV", "implantacao:Implantação PDV"]);
  });

  it("tem 10 etapas, 9 grupos e 54 itens de checklist", () => {
    expect(resumoTemplate(PDV_LEGAL_TEMPLATE)).toEqual({ pipelines: 2, etapas: 10, itens: 54 });
    expect(groups).toHaveLength(9);
    expect(itens).toHaveLength(54);
  });

  it("na Implantação a etapa inicial é 'Treinamento Marcado', a 3a da lista", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.findIndex((s) => s.is_initial)).toBe(2);
    expect(impl.stages[2].nome).toBe("Treinamento Marcado");
    expect(impl.stages[2].inicia_sla).toBe(true);
  });

  it("a janela de SLA fecha na última etapa da Implantação", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.filter((s) => s.encerra_sla).map((s) => s.nome)).toEqual(["Sub-tickets Finalizados"]);
    expect(impl.stages.filter((s) => s.is_final).map((s) => s.nome)).toEqual(["Sub-tickets Finalizados"]);
  });

  it("'Pendente Agendar' é quem recebe o treino faltado de volta", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.filter((s) => s.retorno_no_show).map((s) => s.nome)).toEqual(["Pendente Agendar"]);
  });

  it("não leva nada do cliente Nutrebem", () => {
    expect(JSON.stringify(PDV_LEGAL_TEMPLATE).toLowerCase()).not.toContain("nutrebem");
  });

  it("todo grupo de checklist aponta para um tipo de demanda do próprio template", () => {
    const demandas = new Set(PDV_LEGAL_TEMPLATE.blueprint.demand_types.map((d) => d.nome));
    for (const g of groups) {
      expect(g.demandas?.length ?? 0).toBeGreaterThan(0);
      for (const d of g.demandas!) expect(demandas.has(d)).toBe(true);
    }
  });

  it("sugere o produto PDV Legal", () => {
    expect(PDV_LEGAL_TEMPLATE.produto_sugerido).toBe("PDV Legal");
  });
});
