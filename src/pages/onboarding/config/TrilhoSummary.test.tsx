import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrilhoSummary } from "./TrilhoSummary";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// trilho = 3720 min (7d 6h úteis); o tipo de demanda promete 2400 (5d) — diverge.
const trilhoMin = vi.fn(() => 3720);
const demandTypes = vi.fn(() => [
  { id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 2400, ativo: true },
]);

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: demandTypes(), error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: (fn: string) =>
        fn === "fn_onb_trilho_sla_min"
          ? Promise.resolve({ data: trilhoMin(), error: null })
          : Promise.resolve({ data: null, error: null }),
    },
  };
});

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <TrilhoSummary tenantId="t1" produtoId={7} />
      </QueryClientProvider>,
    );
  });
  // Duas queries independentes (trilho e tipos de demanda) resolvem em rodadas
  // diferentes de microtask; um flush só deixa o componente no estado de loading.
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return host;
}

beforeEach(() => {
  document.body.innerHTML = "";
  trilhoMin.mockReturnValue(3720);
  demandTypes.mockReturnValue([
    { id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 2400, ativo: true },
  ]);
});

describe("TrilhoSummary", () => {
  it("mostra o total do trilho na base de 8h", async () => {
    const host = await render();
    // formatSlaHuman(3720) = 7 dias úteis + 6h
    expect(host.textContent).toContain("7d 6h");
  });

  it("acusa quando o plano estoura o prazo prometido", async () => {
    const host = await render();
    const txt = host.textContent ?? "";
    expect(txt).toContain("Onboarding PDV Legal");
    expect(txt).toContain("acima da promessa");
    // 3720 - 2400 = 1320 min = 2d 6h
    expect(txt).toContain("2d 6h");
  });

  it("não acusa nada quando o prazo prometido bate com o trilho", async () => {
    demandTypes.mockReturnValue([
      { id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 3720, ativo: true },
    ]);
    const host = await render();
    expect(host.textContent).not.toContain("promessa");
  });

  it("ignora tipo de demanda inativo e tipo sem prazo declarado", async () => {
    demandTypes.mockReturnValue([
      { id: "d1", nome: "Tipo Inativo", sla_total_minutos: 999, ativo: false },
      { id: "d2", nome: "Tipo Sem Prazo", sla_total_minutos: 0, ativo: true },
    ]);
    const host = await render();
    expect(host.textContent).not.toContain("Tipo Inativo");
    expect(host.textContent).not.toContain("Tipo Sem Prazo");
  });

  it("avisa quando não há etapa nenhuma na janela contada", async () => {
    trilhoMin.mockReturnValue(0);
    const host = await render();
    expect(host.textContent).toContain("Nenhuma etapa com SLA");
  });
});
