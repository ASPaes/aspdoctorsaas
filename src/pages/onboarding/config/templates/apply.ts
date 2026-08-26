import type { TemplateBlueprint } from "./types";

export type SelecaoTemplate = {
  /** índice do pipeline -> índices das etapas marcadas */
  stages: Record<number, Set<number>>;
  demand_types: Set<number>;
  training_types: Set<number>;
  pause_reasons: Set<number>;
  accounting_fields: Set<number>;
  vendor_return_reasons: Set<number>;
};

const norm = (s: string) => s.trim().toLowerCase();

export function resolverProdutoSugerido(
  produtos: { id: number; nome: string }[],
  sugerido?: string,
): number | null {
  if (!sugerido) return null;
  const alvo = norm(sugerido);
  return produtos.find((p) => norm(p.nome) === alvo)?.id ?? null;
}

/**
 * A importação é aditiva: cria pipeline novo em vez de mesclar com o que existe.
 * Nome repetido na MESMA jornada confunde o quadro, então ganha sufixo.
 */
export function nomesEmColisao(
  bp: TemplateBlueprint,
  existentes: { nome: string; fase: string }[],
): string[] {
  const ocupados = new Set(existentes.map((e) => `${e.fase}::${norm(e.nome)}`));
  return bp.pipelines.filter((p) => ocupados.has(`${p.fase}::${norm(p.nome)}`)).map((p) => p.nome);
}

export function renomearColisoes(
  bp: TemplateBlueprint,
  existentes: { nome: string; fase: string }[],
): TemplateBlueprint {
  const ocupados = new Set(existentes.map((e) => `${e.fase}::${norm(e.nome)}`));
  return {
    ...bp,
    pipelines: bp.pipelines.map((p) => {
      let nome = p.nome;
      let n = 1;
      while (ocupados.has(`${p.fase}::${norm(nome)}`)) {
        n += 1;
        nome = `${p.nome} (${n})`;
      }
      ocupados.add(`${p.fase}::${norm(nome)}`);
      return { ...p, nome };
    }),
  };
}

export function selecaoCompleta(bp: TemplateBlueprint): SelecaoTemplate {
  const stages: Record<number, Set<number>> = {};
  bp.pipelines.forEach((p, pi) => {
    stages[pi] = new Set(p.stages.map((_, si) => si));
  });
  return {
    stages,
    demand_types: new Set(bp.demand_types.map((_, i) => i)),
    training_types: new Set(bp.training_types.map((_, i) => i)),
    pause_reasons: new Set(bp.pause_reasons.map((_, i) => i)),
    accounting_fields: new Set(bp.accounting_fields.map((_, i) => i)),
    vendor_return_reasons: new Set(bp.vendor_return_reasons.map((_, i) => i)),
  };
}

export function filtrarPorSelecao(bp: TemplateBlueprint, sel: SelecaoTemplate): TemplateBlueprint {
  return {
    pipelines: bp.pipelines
      .map((p, pi) => ({ ...p, stages: p.stages.filter((_, si) => sel.stages[pi]?.has(si)) }))
      .filter((p) => p.stages.length > 0),
    demand_types: bp.demand_types.filter((_, i) => sel.demand_types.has(i)),
    training_types: bp.training_types.filter((_, i) => sel.training_types.has(i)),
    pause_reasons: bp.pause_reasons.filter((_, i) => sel.pause_reasons.has(i)),
    accounting_fields: bp.accounting_fields.filter((_, i) => sel.accounting_fields.has(i)),
    vendor_return_reasons: bp.vendor_return_reasons.filter((_, i) => sel.vendor_return_reasons.has(i)),
  };
}
