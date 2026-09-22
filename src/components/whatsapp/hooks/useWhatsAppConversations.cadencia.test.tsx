import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useWhatsAppConversations } from "./useWhatsAppConversations";

// Sem @testing-library/react (peer @testing-library/dom ausente no projeto):
// componente-sonda + createRoot, mesmo padrão dos outros testes do repo.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "tenant-1" }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "operador-1" } }),
}));

vi.mock("@/hooks/useUserDepartment", () => ({
  useUserDepartment: () => ({ data: "setor-1" }),
}));

vi.mock("@/lib/realtimeChannelPool", () => ({
  subscribeSharedChannel: () => () => {},
}));

function Sonda({ ms }: { ms?: number }) {
  useWhatsAppConversations({ bucket: "waiting", refetchIntervalMs: ms });
  return null;
}

async function montar(ms?: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <Sonda ms={ms} />
      </QueryClientProvider>
    );
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  document.body.innerHTML = "";
  vi.useFakeTimers();
  focusManager.setFocused(true);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("useWhatsAppConversations — cadência da releitura de segurança", () => {
  it("sem pedir nada, relê a cada 60s (comportamento do computador)", async () => {
    await montar();
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("no celular a cadência é de 180s: aos 61s ainda não releu", async () => {
    await montar(180_000);
    expect(rpc).toHaveBeenCalledTimes(1);

    // O que segura a tela em dia é o Realtime; este intervalo só cobre o evento
    // perdido, e no celular ele fica aberto o dia inteiro.
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("com a tela em segundo plano não relê, em nenhuma das duas cadências", async () => {
    await montar(180_000);
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { focusManager.setFocused(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
