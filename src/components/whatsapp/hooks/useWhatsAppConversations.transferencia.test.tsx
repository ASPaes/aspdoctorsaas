import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useWhatsAppConversations } from "./useWhatsAppConversations";

// Sem @testing-library/react (peer @testing-library/dom ausente): componente-sonda
// + createRoot, mesmo padrão dos outros testes do repo.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UID = "operador-destino";
const SETOR = "setor-1";

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
  useAuth: () => ({ user: { id: UID } }),
}));

vi.mock("@/hooks/useUserDepartment", () => ({
  useUserDepartment: () => ({ data: SETOR }),
}));

// Guarda os handlers registrados por topic para o teste poder entregar o evento
// na mão — é o que o Realtime faria no navegador de quem RECEBEU o chat.
const rt = vi.hoisted(() => ({
  handlers: [] as Array<{ topic: string; cfg: any; cb: (p: any) => void }>,
}));
vi.mock("@/lib/realtimeChannelPool", () => ({
  subscribeSharedChannel: (topic: string, configure: (ch: any) => void) => {
    const channel = {
      on: (_t: string, cfg: any, cb: (p: any) => void) => {
        rt.handlers.push({ topic, cfg, cb });
        return channel;
      },
    };
    configure(channel);
    return () => { rt.handlers = rt.handlers.filter((h) => h.topic !== topic); };
  },
}));

/** Entrega o evento a quem assinou aquela tabela com aquele filtro. */
function entregar(table: string, filtro: string, row: Record<string, unknown>) {
  const alvos = rt.handlers.filter((h) => h.cfg.table === table && h.cfg.filter === filtro);
  expect(alvos.length, `ninguém assinou ${table} com filtro ${filtro}`).toBeGreaterThan(0);
  for (const h of alvos) h.cb({ new: row, old: {} });
}

function Sonda() {
  useWhatsAppConversations({ bucket: "in_progress" });
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
  // A lista do destinatário tem OUTRA conversa; a transferida não está nela.
  rpc.mockResolvedValue({
    data: [{
      conversation: { id: "outra", tenant_id: "tenant-1", unread_count: 0, last_message_at: "2026-08-25T12:00:00Z" },
      contact: { id: "c1" },
      bucket: "in_progress",
    }],
    error: null,
  });
  document.body.innerHTML = "";
  rt.handlers = [];
  // Relógio falso o teste inteiro: voltar ao real no meio devolve o Date.now() e
  // desfaz o avanço (armadilha já paga em useWhatsAppConversations.test.tsx).
  vi.useFakeTimers();
  focusManager.setFocused(true);
});

afterEach(() => { vi.useRealTimers(); });

describe("chat transferido — a lista de quem recebeu", () => {
  it("recarrega quando o atendimento passa a ser MEU", async () => {
    await montar();
    const antes = rpc.mock.calls.length;

    await act(async () => {
      entregar("support_attendances", `assigned_to=eq.${UID}`, {
        id: "att-1", tenant_id: "tenant-1", conversation_id: "transferida",
        assigned_to: UID, status: "in_progress",
      });
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(rpc.mock.calls.length).toBeGreaterThan(antes);
  });

  it("recarrega quando o atendimento cai na fila do MEU setor", async () => {
    await montar();
    const antes = rpc.mock.calls.length;

    await act(async () => {
      entregar("support_attendances", `department_id=eq.${SETOR}`, {
        id: "att-2", tenant_id: "tenant-1", conversation_id: "transferida",
        assigned_to: null, department_id: SETOR, status: "waiting",
      });
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(rpc.mock.calls.length).toBeGreaterThan(antes);
  });

  it("recarrega pelo canal do tenant quando ele funciona", async () => {
    await montar();
    const antes = rpc.mock.calls.length;

    await act(async () => {
      entregar("whatsapp_conversations", "tenant_id=eq.tenant-1", {
        id: "transferida", tenant_id: "tenant-1", assigned_to: UID,
        department_id: SETOR, status: "active", unread_count: 0,
      });
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(rpc.mock.calls.length).toBeGreaterThan(antes);
  });
});
