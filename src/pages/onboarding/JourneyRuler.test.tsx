import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JourneyRuler, larguras, semaforo } from "./JourneyRuler";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RULER = [
  { stage_id: "s1", nome: "Novo Cliente",       fase: "Onboarding",  ordem: 10001, plano_min: 120, real_min: 60,   passagens: 1, aberta: false, inicia: true,  encerra: false, fora_janela: false },
  { stage_id: "s2", nome: "Conferência",        fase: "Onboarding",  ordem: 10002, plano_min: 360, real_min: 240,  passagens: 2, aberta: false, inicia: false, encerra: false, fora_janela: false },
  { stage_id: "s3", nome: "Recolhimento Dados", fase: "Onboarding",  ordem: 10003, plano_min: 480, real_min: 1680, passagens: 1, aberta: true,  inicia: false, encerra: true,  fora_janela: false },
  { stage_id: "s4", nome: "Sub-tickets",        fase: "Implantação", ordem: 20005, plano_min: 960, real_min: 0,    passagens: 0, aberta: false, inicia: false, encerra: false, fora_janela: true },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: RULER, error: null }) },
}));

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <JourneyRuler journeyId="j1" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("semaforo", () => {
  it("estouro do plano vira vermelho", () => expect(semaforo(480, 1680)).toBe("vermelho"));
  it("a partir de 70% vira amarelo", () => expect(semaforo(100, 70)).toBe("amarelo"));
  it("abaixo de 70% fica verde", () => expect(semaforo(120, 60)).toBe("verde"));
  it("etapa sem plano não tem semáforo", () => expect(semaforo(0, 999)).toBe("sem_sla"));
});

describe("larguras", () => {
  it("distribui 100% entre os segmentos", () => {
    const w = larguras([100, 300]);
    expect(Math.round(w.reduce((a, b) => a + b, 0))).toBe(100);
  });

  it("garante largura mínima para a etapa curta ao lado da longa", () => {
    // 1 min contra 10.000 daria 0,01% — invisível e impossível de clicar.
    const w = larguras([1, 10000]);
    expect(w[0]).toBeGreaterThanOrEqual(3);
  });

  it("tudo zerado não divide por zero", () => {
    const w = larguras([0, 0]);
    expect(w.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(larguras([])).toEqual([]);
  });
});

describe("JourneyRuler", () => {
  it("desenha uma etapa por nó, sem repetir", async () => {
    await render();
    const ids = [...document.querySelectorAll("[data-ruler-stage]")]
      .map((n) => n.getAttribute("data-ruler-stage"));
    // 3 etapas da janela x 2 réguas (plano e real) + 1 fora da janela
    expect(new Set(ids).size).toBe(4);
  });

  it("marca a revisita com o selo de passagens", async () => {
    await render();
    const s2 = document.querySelector("[data-ruler-stage='s2']");
    expect(s2?.getAttribute("data-passagens")).toBe("2");
    expect(document.body.textContent).toContain("×2");
  });

  it("pinta de vermelho a etapa que estourou o plano", async () => {
    await render();
    const s3 = [...document.querySelectorAll("[data-ruler-stage='s3']")]
      .find((n) => n.getAttribute("data-linha") === "real");
    expect(s3?.getAttribute("data-semaforo")).toBe("vermelho");
    const s1 = [...document.querySelectorAll("[data-ruler-stage='s1']")]
      .find((n) => n.getAttribute("data-linha") === "real");
    expect(s1?.getAttribute("data-semaforo")).toBe("verde");
  });

  it("separa as etapas fora da janela", async () => {
    await render();
    expect(document.querySelector("[data-ruler-stage='s4']")?.getAttribute("data-fora-janela")).toBe("true");
    expect(document.body.textContent).toContain("fora da contagem");
  });

  it("mostra os totais de plano e real da janela", async () => {
    await render();
    const txt = document.body.textContent ?? "";
    // formatMinUtil, base 8h: plano 120+360+480 = 960 min → "2d"
    // real 60+240+1680 = 1980 min = 33h → "4d 1h"
    expect(txt).toContain("2d");
    expect(txt).toContain("4d 1h");
  });
});
