import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplyTemplateDialog } from "./ApplyTemplateDialog";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn(() => Promise.resolve({ data: { pipelines: 2, stages: 10, checklist_items: 54 }, error: null }));
const produtos = vi.fn(() => [{ id: 13, nome: "PDV Legal" }, { id: 14, nome: "Gula" }]);
const pipelines = vi.fn(() => [] as { nome: string; fase: string }[]);

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const dados = () => (table === "produtos" ? produtos() : pipelines());
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: dados(), error: null }),
      then: (r: any, j?: any) => Promise.resolve({ data: dados(), error: null }).then(r, j),
    };
    return chain;
  };
  return { supabase: { from: (t: string) => build(t), rpc: (...a: unknown[]) => rpc(...(a as [])) } };
});
vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "t1" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function render(ui: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  act(() => { root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); });
  return el;
}

describe("ApplyTemplateDialog", () => {
  beforeEach(() => {
    rpc.mockClear();
    pipelines.mockReturnValue([]);
    document.body.innerHTML = "";
  });

  it("lista os dois templates com o resumo de cada um", async () => {
    render(<ApplyTemplateDialog open onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    const txt = document.body.textContent ?? "";
    expect(txt).toContain("PDV Legal");
    expect(txt).toContain("Software genérico");
    expect(txt).toContain("10 etapas");
    expect(txt).toContain("54 itens");
    expect(txt).toContain("21 itens");
  });

  it("não aplica nada só de abrir", async () => {
    render(<ApplyTemplateDialog open onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fica fechado quando open=false", async () => {
    render(<ApplyTemplateDialog open={false} onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent ?? "").not.toContain("Software genérico");
  });
});
