import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantFilterProvider, useTenantFilter } from "./TenantFilterContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regressão: link "abrir cadastro do cliente em nova aba" (detalhe da jornada de
 * onboarding) abria o cliente vazio para o super admin.
 *
 * O filtro de tenant vive em sessionStorage — que é POR ABA. `window.open(...,
 * "noopener")` cria a aba sem cópia do sessionStorage do opener, então o super
 * admin caía no fallback `profile.tenant_id` (ASP) e o ClienteForm consultava
 * `clientes` com `.eq('tenant_id', ASP)` → cliente de outro tenant não bate →
 * formulário com os defaults (parece cadastro novo).
 *
 * Fix: o link leva `?tenant=` e o provider aplica isso já no primeiro render.
 */

const TENANT_DIGI = "d0000000-0000-0000-0000-000000000002";
const TENANT_ASP = "a0000000-0000-0000-0000-000000000001";

let profile: { tenant_id: string; is_super_admin: boolean } = {
  tenant_id: TENANT_ASP,
  is_super_admin: true,
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: async () => ({ data: [], error: null }) }),
    }),
  },
}));

/** effectiveTenantId visto no PRIMEIRO render — se só chegasse por useEffect,
 *  as queries da página já teriam saído com o tenant errado. */
let firstRenderTid: string | null | undefined;

function Probe() {
  const { effectiveTenantId } = useTenantFilter();
  if (firstRenderTid === undefined) firstRenderTid = effectiveTenantId;
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderWithSearch(search: string) {
  window.history.replaceState({}, "", `/clientes/abc${search}`);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={qc}>
        <TenantFilterProvider>
          <Probe />
        </TenantFilterProvider>
      </QueryClientProvider>
    );
  });
}

describe("TenantFilterProvider — tenant vindo da URL", () => {
  beforeEach(() => {
    sessionStorage.clear();
    firstRenderTid = undefined;
    profile = { tenant_id: TENANT_ASP, is_super_admin: true };
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("super admin em aba nova sem sessionStorage: ?tenant= define o tenant no primeiro render", () => {
    renderWithSearch(`?tenant=${TENANT_DIGI}`);
    expect(firstRenderTid).toBe(TENANT_DIGI);
  });

  it("persiste o tenant da URL no sessionStorage da aba nova", () => {
    renderWithSearch(`?tenant=${TENANT_DIGI}`);
    expect(sessionStorage.getItem("super-admin-tenant-filter")).toBe(TENANT_DIGI);
  });

  it("sem ?tenant= e sem sessionStorage, mantém o fallback para o tenant do próprio perfil", () => {
    renderWithSearch("");
    expect(firstRenderTid).toBe(TENANT_ASP);
  });

  it("?tenant= vence o valor guardado no sessionStorage da aba", () => {
    sessionStorage.setItem("super-admin-tenant-filter", TENANT_ASP);
    renderWithSearch(`?tenant=${TENANT_DIGI}`);
    expect(firstRenderTid).toBe(TENANT_DIGI);
  });

  it("usuário comum ignora ?tenant= e continua no tenant do próprio perfil", () => {
    profile = { tenant_id: TENANT_ASP, is_super_admin: false };
    renderWithSearch(`?tenant=${TENANT_DIGI}`);
    expect(firstRenderTid).toBe(TENANT_ASP);
    expect(sessionStorage.getItem("super-admin-tenant-filter")).toBeNull();
  });
});
