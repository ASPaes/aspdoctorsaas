import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueueAlert } from "./useQueueAlert";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O alerta de fila chegava a QUEM NÃO TEM SETOR — e esse é o caso mais comum de
 * quem não faz atendimento.
 *
 * `useAllowedDepartments` devolve lista vazia para usuário sem
 * `funcionarios.department_id`. O DepartmentFilterContext então fica em
 * `selectedDepartmentId = null`, que é o mesmo valor de "Todos os setores", e
 * `whatsapp_pill_counts` roda sem `p_department_id` — contando a fila do tenant
 * inteiro. Resultado medido em produção: o financeiro levava bip e toast da fila
 * do suporte no meio do cadastro de cliente, em qualquer tela do sistema.
 *
 * Regra: alerta de fila exige setor em foco.
 */

const SETOR_A = "11111111-1111-1111-1111-111111111111";
const SETOR_B = "22222222-2222-2222-2222-222222222222";

let departmentId: string | null = SETOR_A;
let departmentLoading = false;
let waitingTotal: number | null = 0;

/** O que `usePillCounts` recebeu na última renderização. */
let lastPillOptions: { enabled?: boolean } | undefined;

const toastInfo = vi.fn();
const toastWarning = vi.fn();
const beep = vi.fn();

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

vi.mock("@/lib/queueBeep", () => ({
  playQueueBeep: (...args: unknown[]) => beep(...args),
  primeQueueBeep: () => {},
}));

vi.mock("@/lib/realtimeChannelPool", () => ({
  subscribeSharedChannel: () => () => {},
}));

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "a0000000-0000-0000-0000-000000000001" }),
}));

vi.mock("@/contexts/DepartmentFilterContext", () => ({
  useDepartmentFilter: () => ({
    selectedDepartmentId: departmentId,
    isLoading: departmentLoading,
  }),
}));

vi.mock("@/hooks/usePresenceRow", () => ({
  usePresenceRow: () => ({ presence: null }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

vi.mock("@/hooks/useUserPreferences", () => ({
  useUserPreferences: () => ({
    preferences: { queue_sound_enabled: true, queue_sound_volume: 70 },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

vi.mock("./usePillCounts", () => ({
  usePillCounts: (options?: { enabled?: boolean }) => {
    lastPillOptions = options;
    if (options?.enabled === false) return { data: undefined };
    return { data: { waiting: { total: waitingTotal ?? 0, aguardando: 0, unread: 0, unreadConvs: 0 } } };
  },
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function Probe() {
  useQueueAlert();
  return null;
}

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
}

/** Reflete uma mudança de estado externa (nova contagem, troca de setor). */
function rerender() {
  act(() => root!.render(<Probe />));
}

describe("useQueueAlert — o alerta de fila é do setor, não do tenant", () => {
  beforeEach(() => {
    departmentId = SETOR_A;
    departmentLoading = false;
    waitingTotal = 0;
    lastPillOptions = undefined;
    toastInfo.mockClear();
    toastWarning.mockClear();
    beep.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("usuário sem setor não paga o RPC da fila", () => {
    departmentId = null;
    render();
    expect(lastPillOptions?.enabled).toBe(false);
  });

  it("usuário sem setor não recebe toast nem bip quando a fila cresce", () => {
    departmentId = null;
    render();

    waitingTotal = 3;
    rerender();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(beep).not.toHaveBeenCalled();
  });

  it("enquanto o setor ainda está carregando, ninguém é alertado", () => {
    departmentLoading = true;
    render();
    expect(lastPillOptions?.enabled).toBe(false);
  });

  it("com setor em foco, a entrada de um cliente alerta normalmente", () => {
    render();
    expect(lastPillOptions?.enabled).toBe(true);

    waitingTotal = 1;
    rerender();

    expect(beep).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).toBe("Cliente aguardando na fila");
  });

  it("a primeira leitura da sessão só calibra: fila cheia ao entrar não dispara alerta", () => {
    waitingTotal = 4;
    render();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(beep).not.toHaveBeenCalled();
  });

  it("trocar de setor recalibra: a fila maior do setor novo não vira 'entraram na fila'", () => {
    waitingTotal = 1;
    render();
    expect(toastInfo).not.toHaveBeenCalled(); // calibração

    // O gestor troca para um setor que já tinha 4 pessoas esperando.
    departmentId = SETOR_B;
    waitingTotal = 4;
    rerender();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(beep).not.toHaveBeenCalled();
  });

  it("depois de recalibrar no setor novo, uma entrada real volta a alertar", () => {
    waitingTotal = 1;
    render();

    departmentId = SETOR_B;
    waitingTotal = 4;
    rerender();

    waitingTotal = 5;
    rerender();

    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(beep).toHaveBeenCalledTimes(1);
  });
});
