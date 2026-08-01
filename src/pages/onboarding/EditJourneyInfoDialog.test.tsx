import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditJourneyInfoDialog } from "./EditJourneyInfoDialog";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O diálogo faz TRÊS chamadas rpc distintas (search_clientes, fn_journey_go_live e
 * update_onboarding_journey_info). Um mock único responderia o payload do save
 * também para a busca de clientes, e o `.map()` da lista quebraria. Por isso o
 * roteamento por nome: só `update_...` é controlado pelo teste.
 */
const rpc = vi.fn();
const saveResult = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 7, nome: "Essencial" }, error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: (fn: string, params: any) => {
        rpc(fn, params);
        if (fn === "update_onboarding_journey_info") return saveResult();
        if (fn === "fn_journey_go_live") return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: [], error: null }); // search_clientes
      },
    },
  };
});

/** Chamadas ao save, ignorando as de busca/cálculo. */
const chamadasDeSave = () => rpc.mock.calls.filter((c) => c[0] === "update_onboarding_journey_info");

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (m: any) => toastSuccess(m), error: (m: any) => toastError(m) } }));

const initial = {
  clienteId: "c1",
  clienteLabel: "BOM D+ SORVETERIA LTDA",
  produtoId: 7,
  demandTypeId: null,
  assunto: "IMPLANTAÇÃO PDV",
  dataInicio: "2026-07-29",
  goLive: "2026-08-04",
};

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <EditJourneyInfoDialog
          open
          onOpenChange={onOpenChange}
          tenantId="t1"
          journeyId="j1"
          initial={initial}
          onSaved={onSaved}
        />
      </QueryClientProvider>
    );
  });
  return { host, onSaved, onOpenChange };
}

function botao(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`botão "${texto}" não encontrado`);
  return b as HTMLButtonElement;
}

async function digitar(el: HTMLTextAreaElement | HTMLInputElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  rpc.mockReset();
  saveResult.mockReset();
  saveResult.mockResolvedValue({ data: { ok: true, mudou: [] }, error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
  document.body.innerHTML = "";
});

describe("EditJourneyInfoDialog", () => {
  it("não chama a RPC quando o motivo está vazio", async () => {
    render();
    await act(async () => { botao("Salvar").click(); });
    expect(chamadasDeSave()).toHaveLength(0);
    expect(toastError).toHaveBeenCalled();
  });

  it("envia todos os campos, inclusive os nulos, ao salvar com motivo", async () => {
    saveResult.mockResolvedValue({ data: { ok: true, mudou: ["assunto"] }, error: null });
    const { onSaved } = render();

    const motivo = document.querySelector("textarea") as HTMLTextAreaElement;
    await digitar(motivo, "corrigindo cadastro do vendedor");
    await act(async () => { botao("Salvar").click(); });

    expect(chamadasDeSave()).toHaveLength(1);
    expect(chamadasDeSave()[0][1]).toEqual({
      p_journey_id: "j1",
      p_cliente_id: "c1",
      p_assunto: "IMPLANTAÇÃO PDV",
      p_motivo: "corrigindo cadastro do vendedor",
      p_demand_type_id: null,
      p_data_inicio_planejado: "2026-07-29",
      p_go_live_previsto: "2026-08-04",
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("avisa e não fecha quando a jornada está encerrada", async () => {
    saveResult.mockResolvedValue({ data: { ok: false, reason: "jornada_terminal" }, error: null });
    const { onSaved, onOpenChange } = render();

    const motivo = document.querySelector("textarea") as HTMLTextAreaElement;
    await digitar(motivo, "tentando editar jornada fechada");
    await act(async () => { botao("Salvar").click(); });

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("cancelada"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("mostra o produto como somente leitura", () => {
    render();
    const produto = [...document.querySelectorAll("input")].find((i) => i.disabled);
    expect(produto).toBeTruthy();
    expect(document.body.textContent).toContain("cancele esta jornada");
  });

  // O go-live passou a derivar da soma das etapas do trilho (01/08). O tipo de demanda
  // virou referência e não entra mais no cálculo — se voltar a entrar, isto quebra.
  it("calcula o go-live pelo produto, não pelo tipo de demanda", async () => {
    render();
    await act(async () => { await Promise.resolve(); });
    const chamada = rpc.mock.calls.find((c) => c[0] === "fn_journey_go_live");
    expect(chamada).toBeDefined();
    expect(chamada![1]).toHaveProperty("p_produto_id", 7);
    expect(chamada![1]).not.toHaveProperty("p_demand_type_id");
  });
});
