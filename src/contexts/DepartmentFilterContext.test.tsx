import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DepartmentFilterProvider, useDepartmentFilter } from "./DepartmentFilterContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regressão: no primeiro acesso do dia o chat abria filtrado no setor do cadastro
 * do próprio admin ("Direção"), escondendo o resto da operação. O padrão foi
 * introduzido em c3ceb826 para admin/head juntos.
 *
 * Decisão do Alexandre (24/08): admin e super admin abrem em "Todos os setores";
 * head continua abrindo no setor do cadastro, porque ele gerencia UM setor.
 */

const DEPT_DIRECAO = "11111111-1111-1111-1111-111111111111";
const DEPT_SUPORTE = "22222222-2222-2222-2222-222222222222";

let profile: { user_id: string; role: string; is_super_admin: boolean } = {
  user_id: "u1",
  role: "admin",
  is_super_admin: false,
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile }),
}));

vi.mock("@/hooks/useAllowedDepartments", () => ({
  useAllowedDepartments: () => ({
    data: [
      { id: DEPT_DIRECAO, name: "Direção" },
      { id: DEPT_SUPORTE, name: "Suporte" },
    ],
    isLoading: false,
  }),
}));

// O admin do teste TEM setor no cadastro — é justamente esse valor que vazava
// para o filtro. Se o hook devolvesse null o teste passaria sem provar nada.
vi.mock("@/hooks/useUserDepartment", () => ({
  useUserDepartment: () => ({ data: DEPT_DIRECAO, isLoading: false }),
}));

vi.mock("@/components/whatsapp/hooks/useSupportDepartments", () => ({
  useDepartmentInstances: () => ({ data: [] }),
}));

let seen: string | null | undefined;
let setSelected: (id: string | null) => void = () => {};

function Probe() {
  const { selectedDepartmentId, setSelectedDepartmentId } = useDepartmentFilter();
  seen = selectedDepartmentId;
  setSelected = setSelectedDepartmentId;
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DepartmentFilterProvider>
        <Probe />
      </DepartmentFilterProvider>
    );
  });
}

beforeEach(() => {
  seen = undefined;
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("DepartmentFilterProvider — setor padrão ao entrar", () => {
  it("admin abre em Todos os setores, ignorando o setor do cadastro", () => {
    profile = { user_id: "u1", role: "admin", is_super_admin: false };
    render();
    expect(seen).toBeNull();
  });

  it("super admin abre em Todos os setores", () => {
    profile = { user_id: "u2", role: "user", is_super_admin: true };
    render();
    expect(seen).toBeNull();
  });

  it("head continua abrindo no setor do próprio cadastro", () => {
    profile = { user_id: "u3", role: "head", is_super_admin: false };
    render();
    expect(seen).toBe(DEPT_DIRECAO);
  });

  it("operador segue travado no setor do cadastro", () => {
    profile = { user_id: "u4", role: "user", is_super_admin: false };
    render();
    expect(seen).toBe(DEPT_DIRECAO);
  });

  it("logout/login na mesma aba reaplica o padrão do novo usuário", () => {
    // head entra e fica no setor do cadastro
    profile = { user_id: "u3", role: "head", is_super_admin: false };
    render();
    expect(seen).toBe(DEPT_DIRECAO);

    // mesmo provider montado, outro usuário (admin) assume: volta para "Todos"
    profile = { user_id: "u9", role: "admin", is_super_admin: false };
    act(() => {
      root!.render(
        <DepartmentFilterProvider>
          <Probe />
        </DepartmentFilterProvider>
      );
    });
    expect(seen).toBeNull();
  });

  it("troca manual do admin vale para a sessão", () => {
    profile = { user_id: "u1", role: "admin", is_super_admin: false };
    render();
    act(() => setSelected(DEPT_SUPORTE));
    expect(seen).toBe(DEPT_SUPORTE);

    // remonta simulando F5 na mesma aba (sessionStorage sobrevive)
    act(() => root!.unmount());
    render();
    expect(seen).toBe(DEPT_SUPORTE);
  });
});
