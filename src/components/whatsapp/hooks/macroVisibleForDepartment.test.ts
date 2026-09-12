import { describe, it, expect } from "vitest";
import { macroVisibleForDepartment, macroDepartmentId } from "./useWhatsAppMacros";

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

describe("macroDepartmentId", () => {
  it("admin/head seguem o setor escolhido no seletor do chat", () => {
    expect(macroDepartmentId({
      canSeeAllDepartments: true,
      selectedDepartmentId: COMERCIAL,
      userDepartmentId: IMPLANTACAO,
    })).toBe(COMERCIAL);
  });

  it("'Todos os setores' volta a mostrar tudo, mesmo com setor no cadastro", () => {
    // null aqui é o que faz macroVisibleForDepartment liberar a lista inteira.
    expect(macroDepartmentId({
      canSeeAllDepartments: true,
      selectedDepartmentId: null,
      userDepartmentId: IMPLANTACAO,
    })).toBeNull();
  });

  it("operador ignora o seletor e fica no setor do cadastro", () => {
    expect(macroDepartmentId({
      canSeeAllDepartments: false,
      selectedDepartmentId: COMERCIAL,
      userDepartmentId: IMPLANTACAO,
    })).toBe(IMPLANTACAO);
  });

  it("undefined vira null (setor ainda carregando)", () => {
    expect(macroDepartmentId({
      canSeeAllDepartments: true,
      selectedDepartmentId: undefined,
      userDepartmentId: undefined,
    })).toBeNull();
    expect(macroDepartmentId({
      canSeeAllDepartments: false,
      selectedDepartmentId: COMERCIAL,
      userDepartmentId: undefined,
    })).toBeNull();
  });
});
