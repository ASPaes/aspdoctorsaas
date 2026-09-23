import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropostaVendaSection from "./PropostaVendaSection";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const jornada = vi.fn((): Record<string, unknown> => ({
  proposta_payload: null,
  resumo_venda_texto: null,
  resumo_venda_template_id: null,
  resumo_venda_updated_at: null,
  resumo_venda_updated_by: null,
  pipeline_onboarding_id: "p1",
}));
const templates = vi.fn(() => ([
  { id: "t1", nome: "Onboarding PDV", corpo: "Quem é o cliente?", pipeline_id: "p1", ativo: true, position: 1 },
]));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string): any => {
    const dados = () =>
      table === "onboarding_journeys" ? jornada()
      : table === "onboarding_sale_summary_templates" ? templates()
      : [];
    const c: any = {
      select: () => c,
      eq: () => c,
      is: () => c,
      in: () => Promise.resolve({ data: [], error: null }),
      order: () => Promise.resolve({ data: dados(), error: null }),
      maybeSingle: () => Promise.resolve({ data: dados(), error: null }),
      update: () => c,
      then: (r: any, j?: any) => Promise.resolve({ data: dados(), error: null }).then(r, j),
    };
    return c;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
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

async function assentar() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("PropostaVendaSection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sem proposta importada, mostra o campo de observação", async () => {
    render(<PropostaVendaSection journeyId="j1" />);
    await assentar();
    expect(document.querySelector("textarea")).not.toBeNull();
    expect(document.body.textContent).toContain("Resumo da venda");
  });

  it("sem proposta importada, o texto já escrito aparece no campo", async () => {
    jornada.mockReturnValueOnce({
      proposta_payload: null,
      resumo_venda_texto: "Vendeu PDV + Financeiro",
      resumo_venda_template_id: "t1",
      resumo_venda_updated_at: "2026-09-22T12:00:00Z",
      resumo_venda_updated_by: "u9",
      pipeline_onboarding_id: "p1",
    });
    render(<PropostaVendaSection journeyId="j1" />);
    await assentar();
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value)
      .toBe("Vendeu PDV + Financeiro");
  });

  it("com proposta importada, não mostra campo nenhum para escrever", async () => {
    jornada.mockReturnValueOnce({
      proposta_payload: { cliente: { nome_fantasia: "PORCAO" }, proposta: {} },
      resumo_venda_texto: null,
      resumo_venda_template_id: null,
      resumo_venda_updated_at: null,
      resumo_venda_updated_by: null,
      pipeline_onboarding_id: "p1",
    });
    render(<PropostaVendaSection journeyId="j1" />);
    await assentar();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("importado do sistema comercial");
  });
});
