import { describe, it, expect } from "vitest";
import { resumoDemandas } from "./ChecklistGroupDemandPicker";

describe("resumoDemandas", () => {
  it("sem vinculo vale para todas", () => {
    expect(resumoDemandas([])).toBe("Todas");
  });

  it("um tipo mostra o nome", () => {
    expect(resumoDemandas(["Implantação"])).toBe("Implantação");
  });

  // O header do checklist tem ~330px e nome de demanda chega a 21 caracteres:
  // concatenar dois truncaria os dois. A partir do segundo, conta em vez de listar.
  it("dois ou mais viram contagem", () => {
    expect(resumoDemandas(["Implantação", "Migração"])).toBe("2 demandas");
    expect(resumoDemandas(["Implantação", "Migração", "Troca"])).toBe("3 demandas");
  });
});
