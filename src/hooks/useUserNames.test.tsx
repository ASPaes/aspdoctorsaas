import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserNames } from "./useUserNames";

// Sem @testing-library/react (peer @testing-library/dom ausente no projeto):
// componente-sonda + createRoot, mesmo padrão dos outros testes do repo.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selecionados = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => ({
    select: () => ({
      in: (_col: string, ids: any[]) => {
        selecionados(tabela, ids);
        if (tabela === "profiles") {
          return Promise.resolve({
            data: [
              { user_id: "u1", funcionario_id: 10 },
              { user_id: "u2", funcionario_id: null },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [{ id: 10, nome: "Alexandre" }], error: null });
      },
    }),
  });
  return { supabase: { from } };
});

function Sonda({ ids }: { ids: string[] }) {
  const { data } = useUserNames(ids);
  return <div data-testid="saida">{JSON.stringify(data ?? {})}</div>;
}

async function render(ids: string[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <Sonda ids={ids} />
      </QueryClientProvider>
    );
  });
  // São DUAS consultas encadeadas (profiles → funcionarios) e o react-query agenda o
  // aviso de mudança fora do microtask: esperar por timer, não por Promise.resolve().
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return host;
}

beforeEach(() => {
  selecionados.mockReset();
  document.body.innerHTML = "";
});

describe("useUserNames", () => {
  it("resolve o nome pelo funcionário vinculado", async () => {
    const host = await render(["u1", "u2"]);
    expect(JSON.parse(host.textContent!)).toEqual({ u1: "Alexandre" });
  });

  it("não consulta o banco com lista vazia", async () => {
    await render([]);
    expect(selecionados).not.toHaveBeenCalled();
  });

  it("descarta id repetido e vazio antes de consultar", async () => {
    await render(["u1", "u1", ""]);
    const chamada = selecionados.mock.calls.find((c) => c[0] === "profiles");
    expect(chamada![1]).toEqual(["u1"]);
  });
});
