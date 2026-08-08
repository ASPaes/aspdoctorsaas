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
  total_card: 175,
  total_sem_resposta: 88,
  total_respondido: 80,
  total_ticket: 7,
  total_contatos: 2,
  truncado: false,
  contatos: [
    {
      contato: "Padaria do Zé", telefone: "5511999990000",
      cliente_id: null, cliente_nome: null, qtd: 3, qtd_sem_resposta: 1,
      ultimo_at: "2026-06-30T12:00:00.000Z",
      chats: [
        { attendance_id: "a1", attendance_code: "AT-1", conversation_id: "c1",
          opened_at: "2026-06-30T12:00:00.000Z", closed_at: "2026-06-30T13:00:00.000Z",
          departamento: "Suporte", msg_customer_count: 4, msg_agent_count: 0,
          motivo: "sem_resposta", aberto_seg: 3600 },
        { attendance_id: "a3", attendance_code: "AT-3", conversation_id: "c3",
          opened_at: "2026-06-28T09:00:00.000Z", closed_at: "2026-06-28T09:20:00.000Z",
          departamento: "Suporte", msg_customer_count: 2, msg_agent_count: 1,
          motivo: "respondido", aberto_seg: 1200 },
      ],
    },
    {
      contato: "Mercado Central", telefone: "5511888880000",
      cliente_id: "cli-1", cliente_nome: "MERCADO CENTRAL LTDA", qtd: 1, qtd_sem_resposta: 0,
      ultimo_at: "2026-06-29T10:00:00.000Z",
      chats: [
        { attendance_id: "a2", attendance_code: "AT-2", conversation_id: "c2",
          opened_at: "2026-06-29T10:00:00.000Z", closed_at: "2026-06-29T10:30:00.000Z",
          departamento: null, msg_customer_count: 1, msg_agent_count: 2,
          motivo: "ticket", aberto_seg: 1800 },
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
  /** O card e a lista têm que falar o mesmo número — foi o que motivou a 2ª volta
   *  do DEM-0153. O total no título é o total_card, sem recorte. */
  it("mostra no título o mesmo total que o card", () => {
    renderDialog();
    expect(texto()).toContain("175 atendimentos");
  });

  it("quebra o total nos motivos de não ter sido assumido", () => {
    renderDialog();
    const linha = document.body.querySelector('[data-testid="resumo"]')?.textContent ?? "";
    expect(linha).toContain("88 sem nenhuma resposta");
    expect(linha).toContain("80 responderam mas ninguém assumiu");
    expect(linha).toContain("7 viraram ticket");
  });

  it("omite o resumo quando todos caem no mesmo motivo", () => {
    hookState = {
      isLoading: false, isError: false,
      data: payload({ total_card: 88, total_sem_resposta: 88, total_respondido: 0, total_ticket: 0 }),
    };
    renderDialog();
    expect(document.body.querySelector('[data-testid="resumo"]')).toBeNull();
  });

  it("marca cada chat com o motivo — o que separa o vácuo do resto", () => {
    renderDialog();
    clicar(botaoComTexto(/Padaria do Zé/));
    expect(texto()).toContain("sem resposta");
    expect(texto()).toContain("respondido, sem assumir");
    clicar(botaoComTexto(/Mercado Central/));
    expect(texto()).toContain("virou ticket");
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
      data: payload({
        total_card: 0, total_sem_resposta: 0, total_respondido: 0, total_ticket: 0,
        total_contatos: 0, contatos: [],
      }),
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

  /** Sem o código do atendimento não dá para rastrear de onde saiu a linha — foi
   *  exatamente o que faltou quando um item da lista foi contestado (DEM-0153). */
  it("mostra o código do atendimento em cada chat", () => {
    renderDialog();
    clicar(botaoComTexto(/Padaria do Zé/));
    expect(texto()).toContain("AT-1");
  });

  it("leva para o WhatsApp na conversa certa", () => {
    renderDialog();
    clicar(botaoComTexto(/Padaria do Zé/));
    clicar(botaoPorLabel("Abrir no WhatsApp"));
    expect(navigate).toHaveBeenCalledWith("/whatsapp?conversation=c1");
  });
});
