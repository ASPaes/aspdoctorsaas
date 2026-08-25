import { describe, it, expect } from "vitest";
import { filtrarJornadas, filtroAtivo, FILTRO_VAZIO, type JourneyFiltravel } from "./dashFilters";

const jornadas: JourneyFiltravel[] = [
  { journey_id: "j1", responsavel_user_id: "u1", demand_type_id: "d1" },
  { journey_id: "j2", responsavel_user_id: "u2", demand_type_id: "d1" },
  { journey_id: "j3", responsavel_user_id: "u1", demand_type_id: "d2" },
  { journey_id: "j4", responsavel_user_id: null, demand_type_id: null },
];

const pipelinesPorJornada: Record<string, string[]> = { j1: ["p1", "p2"], j2: ["p1"], j3: ["p3"], j4: [] };
const participantesPorJornada: Record<string, string[]> = { j1: ["u1", "u9"], j2: ["u2"], j3: ["u1"], j4: [] };

function filtrar(f: Partial<typeof FILTRO_VAZIO>) {
  return [...filtrarJornadas(jornadas, { ...FILTRO_VAZIO, ...f }, pipelinesPorJornada, participantesPorJornada)].sort();
}

describe("filtrarJornadas", () => {
  it("filtro vazio não restringe nada", () => {
    expect(filtrar({})).toEqual(["j1", "j2", "j3", "j4"]);
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
  });
});
