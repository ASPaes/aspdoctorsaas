import { describe, it, expect } from "vitest";
import { SOFTWARE_GENERICO_TEMPLATE } from "./softwareGenerico";
import { ONBOARDING_TEMPLATES, resumoTemplate } from "./index";

describe("template Software genérico", () => {
  it("tem 2 pipelines, 8 etapas e 21 itens de checklist", () => {
    expect(resumoTemplate(SOFTWARE_GENERICO_TEMPLATE)).toEqual({ pipelines: 2, etapas: 8, itens: 21 });
  });

  it("usa checklist plano, sem grupo por demanda", () => {
    const stages = SOFTWARE_GENERICO_TEMPLATE.blueprint.pipelines.flatMap((p) => p.stages);
    expect(stages.every((s) => s.checklist_groups === undefined)).toBe(true);
    expect(stages.every((s) => (s.checklist?.length ?? 0) > 0)).toBe(true);
  });

  it("abre e fecha a janela de SLA na Implantação", () => {
    const impl = SOFTWARE_GENERICO_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages[0].inicia_sla).toBe(true);
    expect(impl.stages[0].is_initial).toBe(true);
    expect(impl.stages[impl.stages.length - 1].encerra_sla).toBe(true);
    expect(impl.stages[impl.stages.length - 1].is_final).toBe(true);
  });

  it("não sugere produto", () => {
    expect(SOFTWARE_GENERICO_TEMPLATE.produto_sugerido).toBeUndefined();
  });

  it("entra no catálogo depois do PDV Legal", () => {
    expect(ONBOARDING_TEMPLATES.map((t) => t.id)).toEqual(["pdv-legal", "software-generico"]);
  });
});
