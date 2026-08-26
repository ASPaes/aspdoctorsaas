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

/** Clica no primeiro botão cujo texto começa com o rótulo. Sem @testing-library. */
async function clicar(rotulo: string) {
  const alvo = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(rotulo),
  );
  if (!alvo) throw new Error(`botão "${rotulo}" não encontrado`);
  await act(async () => {
    alvo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

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

  it("escolher PDV Legal → revisar → aplicar manda o blueprint inteiro com o produto amarrado", async () => {
    const onOpenChange = vi.fn();
    render(<ApplyTemplateDialog open onOpenChange={onOpenChange} />);
    await act(async () => { await Promise.resolve(); });

    await clicar("PDV Legal");
    // o produto sugerido do template existe neste tenant, então já vem escolhido
    expect(document.body.textContent ?? "").toContain("Produto do template");

    await clicar("Revisar");
    const revisao = document.body.textContent ?? "";
    expect(revisao).toContain("Treinamento Marcado");
    expect(revisao).toContain("Check List Balcão");
    expect(revisao).toContain("inicia SLA");

    await clicar("Aplicar template");
    expect(rpc).toHaveBeenCalledTimes(1);

    const [fn, args] = rpc.mock.calls[0] as unknown as [string, any];
    expect(fn).toBe("apply_onboarding_blueprint");
    expect(args.p_tenant_id).toBe("t1");
    const bp = args.p_blueprint;
    expect(bp.pipelines.map((p: any) => p.nome)).toEqual(["Onboarding PDV", "Implantação PDV"]);
    expect(bp.pipelines.every((p: any) => p.produto_id === 13)).toBe(true);
    expect(bp.pipelines.flatMap((p: any) => p.stages)).toHaveLength(10);
    const grupos = bp.pipelines.flatMap((p: any) => p.stages).flatMap((s: any) => s.checklist_groups ?? []);
    expect(grupos).toHaveLength(9);
    expect(grupos.flatMap((g: any) => g.itens)).toHaveLength(54);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("com pipeline de mesmo nome já existente, o que vai para o banco leva sufixo", async () => {
    pipelines.mockReturnValue([{ nome: "Implantação PDV", fase: "implantacao" }]);
    render(<ApplyTemplateDialog open onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });

    await clicar("PDV Legal");
    await clicar("Revisar");
    expect(document.body.textContent ?? "").toContain("já tem");

    await clicar("Aplicar template");
    const [, args] = rpc.mock.calls[0] as unknown as [string, any];
    expect(args.p_blueprint.pipelines.map((p: any) => p.nome))
      .toEqual(["Onboarding PDV", "Implantação PDV (2)"]);
  });
});
