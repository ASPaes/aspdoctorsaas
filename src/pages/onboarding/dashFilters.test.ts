import { describe, it, expect } from "vitest";
import {
  filtrarJornadas, filtroAtivo, pipelineSelecionado, fasesDosPipelines,
  FILTRO_VAZIO, type JourneyFiltravel,
} from "./dashFilters";

const jornadas: JourneyFiltravel[] = [
  { journey_id: "j1", responsavel_user_id: "u1", demand_type_id: "d1" },
  { journey_id: "j2", responsavel_user_id: "u2", demand_type_id: "d1" },
  { journey_id: "j3", responsavel_user_id: "u1", demand_type_id: "d2" },
  { journey_id: "j4", responsavel_user_id: null, demand_type_id: null },
];

const pipelinesPorJornada: Record<string, string[]> = { j1: ["p1", "p2"], j2: ["p1"], j3: ["p3"], j4: [] };
const participantesPorJornada: Record<string, string[]> = { j1: ["u1", "u9"], j2: ["u2"], j3: ["u1"], j4: [] };

/** j2 está hoje com u2, mas quem fez o onboarding dela foi u7. */
const responsaveisPorJornada: Record<string, string[]> = { j2: ["u7", "u2"] };

/** j1 teve PDV e Estoque; j2 só PDV; j3 só Estoque; j4 nenhum treino. */
const tiposTreinoPorJornada: Record<string, string[]> = { j1: ["tPdv", "tEst"], j2: ["tPdv"], j3: ["tEst"] };

function filtrar(f: Partial<typeof FILTRO_VAZIO>, hist: Record<string, string[]> = {}) {
  return [
    ...filtrarJornadas(
      jornadas, { ...FILTRO_VAZIO, ...f }, pipelinesPorJornada, participantesPorJornada, hist,
      tiposTreinoPorJornada,
    ),
  ].sort();
}

describe("filtrarJornadas", () => {
  it("filtro vazio não restringe nada", () => {
    expect(filtrar({})).toEqual(["j1", "j2", "j3", "j4"]);
  });

  it("tipo de treino: entra a jornada que TEVE aquele treino, e jornada sem treino fica fora", () => {
    expect(filtrar({ tipoTreinoIds: ["tPdv"] })).toEqual(["j1", "j2"]);
    expect(filtrar({ tipoTreinoIds: ["tEst"] })).toEqual(["j1", "j3"]);
    // Dentro da mesma dimensão é OU.
    expect(filtrar({ tipoTreinoIds: ["tPdv", "tEst"] })).toEqual(["j1", "j2", "j3"]);
  });

  it("tipo de treino cruza com as outras dimensões por E", () => {
    expect(filtrar({ tipoTreinoIds: ["tPdv"], demandTypeIds: ["d1"] })).toEqual(["j1", "j2"]);
    expect(filtrar({ tipoTreinoIds: ["tEst"], demandTypeIds: ["d1"] })).toEqual(["j1"]);
  });

  it("dentro da mesma dimensão é OU", () => {
    expect(filtrar({ responsavelIds: ["u1", "u2"] })).toEqual(["j1", "j2", "j3"]);
  });

  it("entre dimensões diferentes é E", () => {
    expect(filtrar({ responsavelIds: ["u1"], demandTypeIds: ["d2"] })).toEqual(["j3"]);
  });

  it("pipeline é 'passou por', não 'está em'", () => {
    expect(filtrar({ pipelineIds: ["p2"] })).toEqual(["j1"]);
    expect(filtrar({ pipelineIds: ["p1"] })).toEqual(["j1", "j2"]);
  });

  it("participante encontra quem não é o responsável", () => {
    expect(filtrar({ participanteIds: ["u9"] })).toEqual(["j1"]);
  });

  it("jornada sem responsável/demanda/pipeline some quando o filtro é usado", () => {
    expect(filtrar({ responsavelIds: ["u1"] })).not.toContain("j4");
    expect(filtrar({ pipelineIds: ["p1"] })).not.toContain("j4");
  });

  it("responsável é 'passou pela mão de', não 'está com'", () => {
    // Sem o histórico, quem só fez o onboarding não encontra a própria jornada.
    expect(filtrar({ responsavelIds: ["u7"] })).toEqual([]);
    expect(filtrar({ responsavelIds: ["u7"] }, responsaveisPorJornada)).toEqual(["j2"]);
  });

  it("o dono de hoje continua achando a jornada mesmo sem histórico", () => {
    expect(filtrar({ responsavelIds: ["u2"] }, responsaveisPorJornada)).toEqual(["j2"]);
    expect(filtrar({ responsavelIds: ["u1"] }, responsaveisPorJornada)).toEqual(["j1", "j3"]);
  });

  it("combinação sem interseção devolve vazio", () => {
    expect(filtrar({ responsavelIds: ["u2"], demandTypeIds: ["d2"] })).toEqual([]);
  });
});

describe("filtroAtivo", () => {
  it("é falso quando nada está selecionado", () => {
    expect(filtroAtivo(FILTRO_VAZIO)).toBe(false);
  });
  it("é verdadeiro com qualquer dimensão preenchida", () => {
    expect(filtroAtivo({ ...FILTRO_VAZIO, pipelineIds: ["p1"] })).toBe(true);
    // Sem esta linha, escolher só tipo de treino não acendia o botão "Limpar".
    expect(filtroAtivo({ ...FILTRO_VAZIO, tipoTreinoIds: ["tPdv"] })).toBe(true);
  });
});

/* ---------- recorte por pipeline ---------- */

describe("pipelineSelecionado", () => {
  it("sem filtro, tudo passa", () => {
    expect(pipelineSelecionado([], "p1")).toBe(true);
    expect(pipelineSelecionado([], null)).toBe(true);
  });

  it("com filtro, só o pipeline escolhido passa", () => {
    expect(pipelineSelecionado(["p1"], "p1")).toBe(true);
    expect(pipelineSelecionado(["p1"], "p2")).toBe(false);
  });

  it("com filtro, passagem sem pipeline não passa", () => {
    expect(pipelineSelecionado(["p1"], null)).toBe(false);
  });
});

describe("fasesDosPipelines", () => {
  const fasePorPipeline = { onbPDV: 1, onbGula: 1, impPDV: 2 };

  it("sem filtro devolve null — quer dizer 'todas as fases'", () => {
    expect(fasesDosPipelines([], fasePorPipeline)).toBeNull();
  });

  it("junta as fases dos pipelines escolhidos", () => {
    expect([...fasesDosPipelines(["onbPDV", "onbGula"], fasePorPipeline)!]).toEqual([1]);
    expect([...fasesDosPipelines(["onbPDV", "impPDV"], fasePorPipeline)!].sort()).toEqual([1, 2]);
  });

  it("pipeline desconhecido não inventa fase", () => {
    expect([...fasesDosPipelines(["desconhecido"], fasePorPipeline)!]).toEqual([]);
  });
});
