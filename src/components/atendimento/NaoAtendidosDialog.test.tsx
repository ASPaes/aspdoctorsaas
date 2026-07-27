import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NaoAtendidosDialog } from "./NaoAtendidosDialog";
import type { AtendimentoNaoAtendidos } from "./useAtendimentoNaoAtendidos";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 * O Dialog do Radix renderiza em portal, então as consultas são no document.body.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hookState: {
  data?: AtendimentoNaoAtendidos;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
} = { isLoading: false, isError: false };

let agentId: string | null = null;
const navigate = vi.fn();

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
/** fmtEspera vem de TempoRealTab, que arrasta o client real do Supabase — sem
 *  este mock o auth-js tenta abrir sessão no jsdom e derruba a suíte. */
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), channel: vi.fn() },
}));
vi.mock("./useAtendimentoNaoAtendidos", () => ({
  useAtendimentoNaoAtendidos: () => hookState,
}));
vi.mock("@/contexts/AtendimentoFilterContext", () => ({
  useAtendimentoFilter: () => ({ agentId }),
}));
vi.mock("@/components/tickets/AttendanceChatHistoryModal", () => ({
  AttendanceChatHistoryModal: () => null,
}));

const payload = (over: Partial<AtendimentoNaoAtendidos> = {}): AtendimentoNaoAtendidos => ({
  total_sem_resposta: 88,
  total_card: 175,
  total_contatos: 2,
  truncado: false,
  contatos: [
    {
      contato: "Padaria do Zé", telefone: "5511999990000",
      cliente_id: null, cliente_nome: null, qtd: 3,
      ultimo_at: "2026-06-30T12:00:00.000Z",
      chats: [
        { attendance_id: "a1", attendance_code: "AT-1", conversation_id: "c1",
          opened_at: "2026-06-30T12:00:00.000Z", closed_at: "2026-06-30T13:00:00.000Z",
          departamento: "Suporte", msg_customer_count: 4, aberto_seg: 3600 },
      ],
    },
    {
      contato: "Mercado Central", telefone: "5511888880000",
      cliente_id: "cli-1", cliente_nome: "MERCADO CENTRAL LTDA", qtd: 1,
      ultimo_at: "2026-06-29T10:00:00.000Z",
      chats: [
        { attendance_id: "a2", attendance_code: "AT-2", conversation_id: "c2",
          opened_at: "2026-06-29T10:00:00.000Z", closed_at: "2026-06-29T10:30:00.000Z",
          departamento: null, msg_customer_count: 1, aberto_seg: 1800 },
      ],
    },
  ],
  ...over,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderDialog() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<NaoAtendidosDialog open onOpenChange={() => {}} />);
  });
}

const texto = () => document.body.textContent ?? "";

function botaoComTexto(re: RegExp): HTMLButtonElement {
  const achado = Array.from(document.body.querySelectorAll("button")).find((b) =>
    re.test(b.textContent ?? ""),
  );
  if (!achado) throw new Error(`botão não encontrado: ${re}`);
  return achado as HTMLButtonElement;
}

function botaoPorLabel(label: string): HTMLButtonElement {
  const achado = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!achado) throw new Error(`botão não encontrado: ${label}`);
  return achado;
}

const clicar = (el: HTMLElement) => act(() => { el.click(); });

beforeEach(() => {
  agentId = null;
  navigate.mockReset();
  hookState = { isLoading: false, isError: false, data: payload() };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("NaoAtendidosDialog", () => {
  it("explica a diferença entre a lista e o número do card", () => {
    renderDialog();
    const linha = document.body.querySelector('[data-testid="reconciliacao"]')?.textContent ?? "";
    expect(linha).toContain("88");
    expect(linha).toContain("87"); // 175 - 88
    expect(linha).toContain("175");
  });

  it("omite a linha de reconciliação quando não há diferença", () => {
    hookState = { isLoading: false, isError: false, data: payload({ total_card: 88 }) };
    renderDialog();
    expect(document.body.querySelector('[data-testid="reconciliacao"]')).toBeNull();
  });

  it("lista um item por contato, com o contador de reincidência", () => {
    renderDialog();
    expect(texto()).toContain("Padaria do Zé");
    expect(texto()).toContain("Mercado Central");
    expect(texto()).toContain("3 chats");
    expect(texto()).not.toContain("1 chats"); // contador só aparece com qtd > 1
  });

  it("mostra o nome do cliente quando existe e o telefone quando não existe", () => {
    renderDialog();
    expect(texto()).toContain("MERCADO CENTRAL LTDA");
    expect(texto()).toContain("5511999990000");
  });

  it("explica o vazio quando o filtro de agente está ativo", () => {
    agentId = "algum-agente";
    hookState = {
      isLoading: false, isError: false,
      data: payload({ total_sem_resposta: 0, total_contatos: 0, total_card: 0, contatos: [] }),
    };
    renderDialog();
    expect(texto()).toMatch(/filtro de agente/i);
  });

  it("avisa quando a lista foi truncada, em vez de cortar em silêncio", () => {
    hookState = {
      isLoading: false, isError: false,
      data: payload({ truncado: true, total_contatos: 260 }),
    };
    renderDialog();
    expect(texto()).toMatch(/258 contatos a mais/i);
  });

  it("expande o contato e mostra os chats só depois do clique", () => {
    renderDialog();
    expect(texto()).not.toContain("4 msg do cliente");
    clicar(botaoComTexto(/Padaria do Zé/));
    expect(texto()).toContain("4 msg do cliente");
  });

  it("leva para o WhatsApp na conversa certa", () => {
    renderDialog();
    clicar(botaoComTexto(/Padaria do Zé/));
    clicar(botaoPorLabel("Abrir no WhatsApp"));
    expect(navigate).toHaveBeenCalledWith("/whatsapp?conversation=c1");
  });
});
