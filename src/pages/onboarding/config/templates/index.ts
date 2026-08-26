import type { OnboardingTemplate } from "./types";
import { PDV_LEGAL_TEMPLATE } from "./pdvLegal";

export * from "./types";

export const ONBOARDING_TEMPLATES: OnboardingTemplate[] = [PDV_LEGAL_TEMPLATE];

export function resumoTemplate(t: OnboardingTemplate): { pipelines: number; etapas: number; itens: number } {
  const stages = t.blueprint.pipelines.flatMap((p) => p.stages);
  const itens = stages.reduce(
    (acc, s) =>
      acc +
      (s.checklist_groups
        ? s.checklist_groups.reduce((a, g) => a + g.itens.length, 0)
        : s.checklist?.length ?? 0),
    0,
  );
  return { pipelines: t.blueprint.pipelines.length, etapas: stages.length, itens };
}
