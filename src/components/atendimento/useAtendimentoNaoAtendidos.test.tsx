import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAtendimentoNaoAtendidos,
  type AtendimentoNaoAtendidos,
} from "./useAtendimentoNaoAtendidos";

/**
 * Sem @testing-library/react aqui: o peer @testing-library/dom não está instalado
 * no projeto, então RTL não carrega. Mesmo padrão dos outros testes do repo
 * (createRoot + act na mão) — ver src/contexts/TenantFilterContext.test.tsx.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TID = "ca58f952-929c-48b2-9d65-6d813d889f47";
const FROM = new Date("2026-06-02T00:00:00.000Z");
const TO = new Date("2026-07-01T23:59:59.000Z");

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let tipoAtendimento: "all" | "group" | "individual" = "all";
let agentId: string | null = null;

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: TID }),
}));
vi.mock("@/contexts/UnidadeFilterContext", () => ({
  useUnidadeFilter: () => ({ selectedUnidadeId: null, viewKey: "todas", unidadeFilterReady: true }),
}));
vi.mock("@/contexts/AtendimentoFilterContext", () => ({
  useAtendimentoFilter: () => ({
    dateRange: { from: FROM, to: TO },
    departmentId: null,
    agentId,
    tipoAtendimento,
  }),
}));

type Estado = { data?: AtendimentoNaoAtendidos; isSuccess: boolean };
let capturado: Estado = { isSuccess: false };

function Probe({ enabled }: { enabled: boolean }) {
  const q = useAtendimentoNaoAtendidos(enabled);
  capturado = { data: q.data, isSuccess: q.isSuccess };
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(enabled: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <Probe enabled={enabled} />
      </QueryClientProvider>,
    );
  });
}

async function tick(ms = 5) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function esperarSucesso() {
  for (let i = 0; i < 20; i++) {
    if (capturado.isSuccess) return;
    await tick();
  }
  throw new Error("a query não chegou em isSuccess");
}

beforeEach(() => {
  rpc.mockReset();
  tipoAtendimento = "all";
  agentId = null;
  capturado = { isSuccess: false };
  rpc.mockResolvedValue({
    data: {
      total_card: 7,
      total_sem_resposta: 3,
      total_respondido: 3,
      total_ticket: 1,
      total_contatos: 2,
      truncado: false,
      contatos: [
        {
          contato: "Padaria do Zé", telefone: "5511999990000",
          cliente_id: null, cliente_nome: null, qtd: 2, qtd_sem_resposta: 1,
          ultimo_at: "2026-06-30T12:00:00.000Z",
          chats: [
            { attendance_id: "a1", attendance_code: "AT-1", conversation_id: "c1",
              opened_at: "2026-06-30T12:00:00.000Z", closed_at: "2026-06-30T13:00:00.000Z",
              departamento: "Suporte", msg_customer_count: 4, msg_agent_count: 0,
              motivo: "sem_resposta", aberto_seg: 3600 },
            { attendance_id: "a2", attendance_code: null, conversation_id: "c2",
              opened_at: "2026-06-20T09:00:00.000Z", closed_at: null,
              departamento: null, msg_customer_count: 1, msg_agent_count: 2,
              motivo: "respondido", aberto_seg: 60 },
          ],
        },
      ],
    },
    error: null,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useAtendimentoNaoAtendidos", () => {
  it("não chama a RPC enquanto o dialog está fechado", async () => {
    await render(false);
    await tick(20);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda p_is_group null quando o filtro é 'Todos os tipos'", async () => {
    await render(true);
    await esperarSucesso();
    expect(rpc).toHaveBeenCalledWith("get_atendimento_nao_atendidos", {
      p_tenant_id: TID,
      p_date_from: FROM.toISOString(),
      p_date_to: TO.toISOString(),
      p_department_id: null,
      p_unidade_base_id: null,
      p_agent_id: null,
      p_is_group: null,
    });
  });

  it("traduz o filtro de tipo para p_is_group booleano", async () => {
    tipoAtendimento = "group";
    await render(true);
    await esperarSucesso();
    expect(rpc.mock.calls[0][1].p_is_group).toBe(true);
  });

  it("normaliza o retorno e preserva os chats de cada contato", async () => {
    await render(true);
    await esperarSucesso();
    const d = capturado.data!;
    expect(d.total_card).toBe(7);
    expect(d.total_sem_resposta).toBe(3);
    expect(d.total_respondido).toBe(3);
    expect(d.total_ticket).toBe(1);
    expect(d.truncado).toBe(false);
    expect(d.contatos).toHaveLength(1);
    expect(d.contatos[0].chats).toHaveLength(2);
    expect(d.contatos[0].chats[0].motivo).toBe("sem_resposta");
    expect(d.contatos[0].chats[1].motivo).toBe("respondido");
    expect(d.contatos[0].chats[1].departamento).toBeNull();
    expect(d.contatos[0].cliente_nome).toBeNull();
  });

  /** Se a RPC em produção estiver atrás do repo, o campo chega undefined — cair em
   *  'sem_resposta' pinta um chat como vácuo sem ele ser. Melhor um default explícito
   *  e testado do que um crash no MOTIVO_BADGE. */
  it("cai em 'sem_resposta' quando a RPC não manda o motivo", async () => {
    rpc.mockResolvedValue({
      data: {
        total_card: 1, total_contatos: 1, truncado: false,
        contatos: [{
          contato: "Sem motivo", telefone: null, cliente_id: null, cliente_nome: null,
          qtd: 1, ultimo_at: "2026-06-30T12:00:00.000Z",
          chats: [{ attendance_id: "a9", attendance_code: null, conversation_id: "c9",
            opened_at: "2026-06-30T12:00:00.000Z", closed_at: null,
            departamento: null, msg_customer_count: 1, aberto_seg: 10 }],
        }],
      },
      error: null,
    });
    await render(true);
    await esperarSucesso();
    expect(capturado.data!.contatos[0].chats[0].motivo).toBe("sem_resposta");
    expect(capturado.data!.contatos[0].qtd_sem_resposta).toBe(0);
  });

  it("aguenta a RPC devolver payload vazio sem quebrar", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await render(true);
    await esperarSucesso();
    expect(capturado.data!.contatos).toEqual([]);
    expect(capturado.data!.total_sem_resposta).toBe(0);
  });
});
