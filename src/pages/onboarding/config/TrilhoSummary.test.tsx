import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrilhoSummary } from "./TrilhoSummary";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Cenário real do Digi Office no local: o pipeline visível tem 4d 6h, mas o trilho
// inteiro soma 53d 6h porque o Acompanhamento sozinho vale 45d.
const resumo = vi.fn(() => ({
  total_min: 25800,
  tem_encerra: false,
  tem_inicia: true,
  inicia_nome: "Novo Cliente",
  encerra_nome: "Cliente destravado",
  segmentos: [
    { jornada: "Onboarding", min: 2280 },
    { jornada: "Implantação", min: 1920 },
    { jornada: "Acompanhamento", min: 21600 },
  ],
}));
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
        fn === "fn_onb_trilho_resumo"
          ? Promise.resolve({ data: resumo(), error: null })
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
  // Duas queries independentes resolvem em rodadas diferentes de microtask.
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return host;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resumo.mockReturnValue({
    total_min: 25800, tem_encerra: false, tem_inicia: true,
    inicia_nome: "Novo Cliente", encerra_nome: "Cliente destravado",
    segmentos: [
      { jornada: "Onboarding", min: 2280 },
      { jornada: "Implantação", min: 1920 },
      { jornada: "Acompanhamento", min: 21600 },
    ],
  });
  demandTypes.mockReturnValue([
    { id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 2400, ativo: true },
  ]);
});

describe("TrilhoSummary", () => {
  it("abre a conta por jornada em vez de só mostrar o total", async () => {
    const host = await render();
    const txt = host.textContent ?? "";
    // Sem a decomposição, "53d 6h" no cabeçalho de um pipeline de 4d 6h parece erro.
    expect(txt).toContain("Onboarding");
    expect(txt).toContain("4d 6h");   // 2280
    expect(txt).toContain("Implantação");
    expect(txt).toContain("4d");      // 1920
    expect(txt).toContain("Acompanhamento");
    expect(txt).toContain("45d");     // 21600
    expect(txt).toContain("53d 6h");  // total
  });

  it("deixa explícito que o número não é só do pipeline aberto", async () => {
    const host = await render();
    expect(host.textContent).toContain("não só este pipeline");
  });

  it("avisa quando falta marcar a etapa que encerra a contagem", async () => {
    const host = await render();
    expect(host.textContent).toContain("encerrar a contagem");
  });

  it("com etapa que encerra marcada, mostra os limites da janela", async () => {
    resumo.mockReturnValue({
      total_min: 4200, tem_encerra: true, tem_inicia: true,
      inicia_nome: "Novo Cliente", encerra_nome: "Sub-tickets Finalizados",
      segmentos: [
        { jornada: "Onboarding", min: 2280 },
        { jornada: "Implantação", min: 1920 },
      ],
    });
    const host = await render();
    const txt = host.textContent ?? "";
    expect(txt).toContain("Novo Cliente");
    expect(txt).toContain("Sub-tickets Finalizados");
    expect(txt).not.toContain("encerrar a contagem");
    expect(txt).not.toContain("Acompanhamento");
  });

  it("acusa quando o plano estoura o prazo prometido", async () => {
    const host = await render();
    const txt = host.textContent ?? "";
    expect(txt).toContain("Onboarding PDV Legal");
    expect(txt).toContain("acima da promessa");
  });

  it("não acusa nada quando o prazo prometido bate com o trilho", async () => {
    demandTypes.mockReturnValue([
      { id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 25800, ativo: true },
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
    resumo.mockReturnValue({
      total_min: 0, tem_encerra: false, tem_inicia: false,
      inicia_nome: null, encerra_nome: null, segmentos: [],
    });
    const host = await render();
    expect(host.textContent).toContain("Nenhuma etapa com SLA");
  });
});
