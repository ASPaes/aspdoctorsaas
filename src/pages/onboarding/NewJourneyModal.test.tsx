import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewJourneyModal } from "./NewJourneyModal";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
Element.prototype.scrollIntoView = () => {};

/** Linhas de cliente_produtos do cliente que o teste vai escolher. */
let produtosDoCliente: Array<{ produto_id: number }> = [];

const CATALOGO = [
  { id: 7, nome: "PDV Legal" },
  { id: 9, nome: "Retaguarda" },
];

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  /** Encadeamento preguiçoso: qualquer .select/.eq/.order devolve o próprio objeto,
   *  que é "thenable" e resolve com as linhas da tabela pedida. */
  const chain = (linhas: () => any[]) => {
    const c: any = {
      select: () => c,
      eq: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      then: (ok: any, falha: any) =>
        Promise.resolve({ data: linhas(), error: null }).then(ok, falha),
    };
    return c;
  };

  const tabelas: Record<string, () => any[]> = {
    onboarding_pipelines: () => [{ id: "pl1", nome: "Onboarding PDV", phase_id: "ph1", position: 1 }],
    onboarding_stages: () => [{ pipeline_id: "pl1" }],
    produtos: () => [
      { id: 7, nome: "PDV Legal" },
      { id: 9, nome: "Retaguarda" },
    ],
    onboarding_demand_types: () => [],
    profiles: () => [],
    funcionarios: () => [],
    cliente_produtos: () => produtosDoCliente,
  };

  return {
    supabase: {
      from: (tabela: string) => chain(tabelas[tabela] ?? (() => [])),
      rpc: (fn: string, params: any) => {
        rpc(fn, params);
        if (fn === "search_clientes") {
          return Promise.resolve({
            data: [{ id: "c1", nome_fantasia: "DEGUST CONCEITO", razao_social: null, cnpj: null }],
            error: null,
          });
        }
        if (fn === "create_onboarding_journey") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        if (fn === "fn_onb_trilho_sla_min") return Promise.resolve({ data: 480, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

vi.mock("@/hooks/useOnboardingPhases", () => ({
  useOnboardingPhases: () => ({
    data: [{ id: "ph1", nome: "Onboarding", slug: "onboarding", position: 1 }],
    isLoading: false,
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <NewJourneyModal
          open
          onOpenChange={vi.fn()}
          tenantId="t1"
          onCreated={vi.fn()}
          defaultPipelineId="pl1"
        />
      </QueryClientProvider>
    );
  });
}

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function porTexto(texto: string): HTMLElement {
  const el = [...document.querySelectorAll("button, [cmdk-item]")].find((x) =>
    x.textContent?.includes(texto)
  );
  if (!el) throw new Error(`elemento com "${texto}" não encontrado`);
  return el as HTMLElement;
}

/** O botão do campo Produto, achado pelo rótulo (a tela tem 4 selects). */
function gatilhoProduto(): HTMLElement {
  const label = [...document.querySelectorAll("label")].find((l) =>
    l.textContent?.startsWith("Produto")
  );
  if (!label) throw new Error("rótulo Produto não encontrado");
  return label.parentElement!.querySelector("button") as HTMLElement;
}

async function escolherCliente() {
  await act(async () => { porTexto("Buscar cliente por nome ou CNPJ").click(); });
  await assentar();
  await act(async () => { porTexto("DEGUST CONCEITO").click(); });
  await assentar();
}

async function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  rpc.mockReset();
  produtosDoCliente = [];
  document.body.innerHTML = "";
});

describe("NewJourneyModal — produto preenchido pelo cliente (DEM-0324)", () => {
  it("preenche o produto sozinho quando o cliente tem um só", async () => {
    produtosDoCliente = [{ produto_id: 7 }];
    render();
    await assentar();
    await escolherCliente();

    expect(gatilhoProduto().textContent).toContain("PDV Legal");
    expect(document.body.textContent).toContain("Preenchido pelo produto do cliente");
  });

  it("manda o produto preenchido como número para a RPC", async () => {
    produtosDoCliente = [{ produto_id: 7 }];
    render();
    await assentar();
    await escolherCliente();

    const assunto = [...document.querySelectorAll("input")].find((i) => i.type === "text")!;
    await digitar(assunto as HTMLInputElement, "IMPLANTAÇÃO PDV");
    await act(async () => { porTexto("Criar").click(); });
    await assentar();

    const criar = rpc.mock.calls.find((c) => c[0] === "create_onboarding_journey");
    expect(criar).toBeDefined();
    expect(criar![1].p_produto_id).toBe(7);
    expect(criar![1].p_cliente_id).toBe("c1");
  });

  it("não escolhe por conta própria quando o cliente tem mais de um produto", async () => {
    produtosDoCliente = [{ produto_id: 7 }, { produto_id: 9 }];
    render();
    await assentar();
    await escolherCliente();

    expect(gatilhoProduto().textContent).toContain("Selecione o produto");
    expect(document.body.textContent).toContain("2 produtos ativos");
  });

  it("deixa o campo vazio e avisa quando o cliente não tem produto ativo", async () => {
    produtosDoCliente = [];
    render();
    await assentar();
    await escolherCliente();

    expect(gatilhoProduto().textContent).toContain("Selecione o produto");
    expect(document.body.textContent).toContain("não tem produto ativo cadastrado");
  });

  it("ignora linha de produto que não está no catálogo do tenant", async () => {
    produtosDoCliente = [{ produto_id: 7 }, { produto_id: 4242 }];
    render();
    await assentar();
    await escolherCliente();

    // 4242 não existe em `produtos`: sobra um só, e o preenchimento vale.
    expect(CATALOGO.some((p) => p.id === 4242)).toBe(false);
    expect(gatilhoProduto().textContent).toContain("PDV Legal");
  });
});
