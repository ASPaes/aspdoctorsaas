import { describe, it, expect } from "vitest";
import { macroVisibleForDepartment } from "./useWhatsAppMacros";

const IMPLANTACAO = "11111111-1111-1111-1111-111111111111";
const COMERCIAL = "22222222-2222-2222-2222-222222222222";

describe("macroVisibleForDepartment", () => {
  it("macro sem setor aparece para todo mundo", () => {
    expect(macroVisibleForDepartment({ department_ids: null }, IMPLANTACAO)).toBe(true);
    expect(macroVisibleForDepartment({ department_ids: [] }, IMPLANTACAO)).toBe(true);
    expect(macroVisibleForDepartment({ department_ids: null }, null)).toBe(true);
  });

  it("macro vinculada só aparece para quem é do setor", () => {
    const macro = { department_ids: [IMPLANTACAO] };
    expect(macroVisibleForDepartment(macro, IMPLANTACAO)).toBe(true);
    expect(macroVisibleForDepartment(macro, COMERCIAL)).toBe(false);
  });

  it("macro vinculada a mais de um setor aparece nos dois", () => {
    const macro = { department_ids: [IMPLANTACAO, COMERCIAL] };
    expect(macroVisibleForDepartment(macro, IMPLANTACAO)).toBe(true);
    expect(macroVisibleForDepartment(macro, COMERCIAL)).toBe(true);
    expect(macroVisibleForDepartment(macro, "33333333-3333-3333-3333-333333333333")).toBe(false);
  });

  it("atendente sem setor no cadastro continua vendo tudo", () => {
    // Admin/super admin não têm funcionarios.department_id: restringir aqui
    // esconderia macro de gente que precisa enxergar a operação inteira.
    expect(macroVisibleForDepartment({ department_ids: [IMPLANTACAO] }, null)).toBe(true);
    expect(macroVisibleForDepartment({ department_ids: [IMPLANTACAO] }, undefined)).toBe(true);
  });
});
