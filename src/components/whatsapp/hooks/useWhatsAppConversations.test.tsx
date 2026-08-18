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
    // Só é alcançado quando a página volta com linhas; aqui a lista vem vazia.
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "tenant-1" }),
}));

// O canal Realtime tem teste próprio (realtimeChannelPool.test.ts). Aqui o
// `configure` sai do caminho de propósito — nenhum handler de postgres_changes
// roda. O que fica é o `onStatus`, capturado para que o teste consiga simular
// uma reconexão do socket.
const rt = vi.hoisted(() => ({ listeners: [] as Array<(s: string) => void> }));
vi.mock("@/lib/realtimeChannelPool", () => ({
  subscribeSharedChannel: (
    _topic: string,
    _configure: unknown,
    onStatus?: (s: string) => void
  ) => {
    if (onStatus) rt.listeners.push(onStatus);
    return () => {
      rt.listeners = rt.listeners.filter((l) => l !== onStatus);
    };
  },
}));

const emitirStatus = (status: string) => {
  for (const l of [...rt.listeners]) l(status);
};

function Sonda() {
  useWhatsAppConversations({ bucket: "waiting", queueOrder: true });
  return null;
}

async function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <Sonda />
      </QueryClientProvider>
    );
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return qc;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  document.body.innerHTML = "";
  rt.listeners = [];
  // Relógio falso ligado durante o teste INTEIRO. Voltar para o relógio real no
  // meio devolve o Date.now() e desfaz o avanço, e aí a query deixa de estar
  // velha — o teste passava a medir o staleTime errado.
  vi.useFakeTimers();
  focusManager.setFocused(true);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("useWhatsAppConversations — recuperação ao voltar para a aba", () => {
  it("busca a fila de novo quando a janela recebe foco depois do staleTime", async () => {
    await montar();
    expect(rpc).toHaveBeenCalledTimes(1);

    // Operador sai para outro app: o refetchInterval de 60s PARA aqui
    // (refetchIntervalInBackground é false por padrão no react-query v5), então
    // esta é a única janela em que a fila pode envelhecer sem ninguém buscar.
    await act(async () => { focusManager.setFocused(false); });

    // Passa do staleTime (30s) sem chegar no poll de 60s: nada deve ter buscado.
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(rpc).toHaveBeenCalledTimes(1);

    // Volta para a aba. Enquanto a pill se atualiza aqui (refetchOnWindowFocus
    // true em usePillCounts), a lista ficava parada — era o "Fila 2 com 1 cartão".
    await act(async () => { focusManager.setFocused(true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("useWhatsAppConversations — recuperação depois de uma queda do Realtime", () => {
  it("busca a lista de novo quando o canal volta a SUBSCRIBED", async () => {
    await montar();
    expect(rpc).toHaveBeenCalledTimes(1);

    // Primeiro SUBSCRIBED da sessão: a query ACABOU de buscar. Só calibra.
    await act(async () => { emitirStatus("SUBSCRIBED"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc).toHaveBeenCalledTimes(1);

    // Socket cai. `postgres_changes` não tem replay: o que for atribuído ao
    // operador nesta janela não chega por Realtime nunca. Sem tocar no foco nem
    // no relógio — a aba segue aberta e na frente, que é o caso que doía.
    await act(async () => { emitirStatus("CHANNEL_ERROR"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc).toHaveBeenCalledTimes(1);

    // Reconectou. É aqui que a lista tem que ir buscar o intervalo perdido, em
    // vez de esperar o poll de 60s.
    await act(async () => { emitirStatus("SUBSCRIBED"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
