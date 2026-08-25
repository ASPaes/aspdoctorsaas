/**
 * Filtro do Dashboard de Onboarding, isolado da página para poder ser testado
 * sem DOM e sem Supabase.
 *
 * Duas regras, e só duas:
 *  - Dimensão vazia não restringe nada (vazio = "todos").
 *  - Dentro da mesma dimensão é OU; entre dimensões diferentes é E.
 *
 * `pipelineIds` é "a jornada PASSOU POR este pipeline", não "está nele agora":
 * a jornada percorre um pipeline por fase (Onboarding e Implantação), então
 * perguntar em qual ela está esconderia metade do histórico.
 */

export interface FiltroDash {
  pipelineIds: string[];
  responsavelIds: string[];
  participanteIds: string[];
  demandTypeIds: string[];
}

export const FILTRO_VAZIO: FiltroDash = {
  pipelineIds: [],
  responsavelIds: [],
  participanteIds: [],
  demandTypeIds: [],
};

export interface JourneyFiltravel {
  journey_id: string;
  responsavel_user_id: string | null;
  demand_type_id: string | null;
}

export function filtroAtivo(f: FiltroDash): boolean {
  return (
    f.pipelineIds.length > 0 ||
    f.responsavelIds.length > 0 ||
    f.participanteIds.length > 0 ||
    f.demandTypeIds.length > 0
  );
}

/** Alguma opção selecionada bate com o que a jornada tem? Seleção vazia passa direto. */
function bate(selecionados: string[], valores: (string | null)[]): boolean {
  if (selecionados.length === 0) return true;
  return valores.some((v) => v != null && selecionados.includes(v));
}

export function filtrarJornadas(
  journeys: JourneyFiltravel[],
  filtro: FiltroDash,
  pipelinesPorJornada: Record<string, string[]>,
  participantesPorJornada: Record<string, string[]>,
): Set<string> {
  const out = new Set<string>();
  journeys.forEach((j) => {
    if (!bate(filtro.responsavelIds, [j.responsavel_user_id])) return;
    if (!bate(filtro.demandTypeIds, [j.demand_type_id])) return;
    if (!bate(filtro.pipelineIds, pipelinesPorJornada[j.journey_id] ?? [])) return;
    if (!bate(filtro.participanteIds, participantesPorJornada[j.journey_id] ?? [])) return;
    out.add(j.journey_id);
  });
  return out;
}

/* ---------- recorte por pipeline ---------- */

/**
 * O filtro de pipeline RECORTA OS DADOS DA FASE, não apenas escolhe jornadas.
 *
 * A primeira versão selecionava a jornada inteira que "passou por" o pipeline. Como
 * 75 das 160 jornadas de Onboarding PDV também passam pela Implantação PDV, filtrar
 * por uma fase continuava mostrando a outra. Agora cada passagem de fase, etapa e
 * histórico é avaliada uma a uma.
 *
 * Passagem sem pipeline não passa quando há filtro: sem pipeline não há como afirmar
 * que ela pertence à fase escolhida.
 */
export function pipelineSelecionado(pipelineIds: string[], pipelineId: string | null): boolean {
  if (pipelineIds.length === 0) return true;
  return pipelineId != null && pipelineIds.includes(pipelineId);
}

/**
 * Fases (por `phase_position`) alcançadas pelos pipelines escolhidos. `null` = sem
 * filtro, ou seja, todas.
 *
 * Serve aos cards de tempo de entrega, que são presos a uma fase específica: o tempo
 * de onboarding não existe dentro do pipeline de implantação. A posição vem da ordem
 * configurada pelo próprio tenant — casar por NOME não serve, porque cada tenant tem
 * o seu conjunto de fases e os nomes se repetem entre eles.
 */
export function fasesDosPipelines(
  pipelineIds: string[],
  fasePorPipeline: Record<string, number>,
): Set<number> | null {
  if (pipelineIds.length === 0) return null;
  const s = new Set<number>();
  pipelineIds.forEach((id) => {
    const pos = fasePorPipeline[id];
    if (pos != null) s.add(pos);
  });
  return s;
}
