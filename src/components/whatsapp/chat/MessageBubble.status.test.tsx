import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageBubble } from "./MessageBubble";

/**
 * O ✓ do balão em conversa de grupo (DEM-0373).
 *
 * Em grupo o WhatsApp não devolve confirmação de entrega para este tipo de conexão:
 * 0 de 2.367 mensagens de saída em grupo chegaram a `delivered` em 14 dias de
 * produção. Emprestar o ✓ cheio do 1:1 fazia o operador ler entrega onde não há
 * informação nenhuma. Estes casos travam as três leituras possíveis.
 *
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), channel: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("@/hooks/useAppTimezone", () => ({
  useAppTimezone: () => ({ timezone: "America/Sao_Paulo" }),
}));
vi.mock("../hooks/useEditMessage", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Componentes de mídia arrastam o client real; a mensagem destes casos é texto.
vi.mock("./MediaContent", () => ({ MediaContent: () => null }));
vi.mock("./ContactCard", () => ({ ContactCard: () => null }));
vi.mock("./LocationCard", () => ({ LocationCard: () => null }));

const TITULO_SEM_CONFIRMACAO = "Enviado ao WhatsApp. Em conversa de grupo não há confirmação";

function mensagem(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    message_id: "3EB0457ADCD3C5907C7E54",
    conversation_id: "c1",
    content: "os fatores estão errados?",
    message_type: "text",
    is_from_me: true,
    status: "pending",
    timestamp: "2026-08-31T19:24:50.845Z",
    metadata: null,
    ...over,
  } as never;
}

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactElement) {
  act(() => { root.render(node); });
}

/** o ✓ "sem confirmação" carrega a tinta reduzida; o cheio, não. */
const achaCheckFraco = () =>
  container.querySelector('svg[class*="text-emerald-950/70"]');
const achaTituloExplicativo = () =>
  Array.from(container.querySelectorAll("[title]")).find((el) =>
    (el.getAttribute("title") ?? "").startsWith(TITULO_SEM_CONFIRMACAO),
  );

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("MessageBubble — ✓ de entrega", () => {
  it("em GRUPO, mensagem sem ack mostra o ✓ atenuado e explica o motivo", () => {
    render(<MessageBubble msg={mensagem()} isGroup />);

    expect(achaCheckFraco()).not.toBeNull();
    const titulo = achaTituloExplicativo();
    expect(titulo).toBeDefined();
    expect(titulo?.getAttribute("title")).toContain("não tem como saber se chegou");
  });

  it("em conversa DIRETA, o mesmo `pending` continua com o ✓ cheio e sem ressalva", () => {
    render(<MessageBubble msg={mensagem()} isGroup={false} />);

    expect(achaCheckFraco()).toBeNull();
    expect(achaTituloExplicativo()).toBeUndefined();
    // o ✓ cheio segue lá, com a tinta original
    expect(container.querySelector('svg[class*="text-emerald-950"]')).not.toBeNull();
  });

  it("se o ack de grupo um dia chegar, o ✓✓ ganha da ressalva", () => {
    render(<MessageBubble msg={mensagem({ status: "delivered" })} isGroup />);

    expect(achaCheckFraco()).toBeNull();
    expect(achaTituloExplicativo()).toBeUndefined();
    expect(container.querySelector("svg.lucide-check-check")).not.toBeNull();
  });

  it("falha confirmada continua vermelha em grupo, a ressalva não a engole", () => {
    render(<MessageBubble msg={mensagem({ status: "failed" })} isGroup />);

    expect(achaCheckFraco()).toBeNull();
    expect(achaTituloExplicativo()).toBeUndefined();
  });
});

/** o relogio de retencao se identifica pelo texto do title, nao pela cor */
const achaMarcaDeRetencao = () =>
  Array.from(container.querySelectorAll('[title]')).find((el) =>
    (el.getAttribute('title') ?? '').includes('ficou parada na fila do aparelho'),
  );

describe('MessageBubble — mensagem de grupo que ficou retida (DEM-0373)', () => {
  // o caso real do print: enviada 31/08, retorno do provedor em 08/09
  const OITO_DIAS_DEPOIS = '2026-09-08T12:52:32.975Z';

  it('marca a mensagem e diz quanto tempo o retorno demorou', () => {
    render(<MessageBubble msg={mensagem({ last_error_at: OITO_DIAS_DEPOIS })} isGroup />);

    const marca = achaMarcaDeRetencao();
    expect(marca).toBeDefined();
    expect(marca?.getAttribute('title')).toContain('8 dias depois do envio');
    // nao vira falha: a mensagem provavelmente chegou, so atrasada
    expect(achaTituloExplicativo()).toBeUndefined();
  });

  it('quem decide e o backend: a tela marca qualquer erro tardio que ele tenha absolvido', () => {
    // 3 min de atraso. A tela marca assim mesmo, e isso NAO e bug: em grupo,
    // `pending` + `last_error_at` so existe porque a verify-failed-deliveries
    // absolveu (erro imediato vira `failed`, e antes da decisao a linha esta em
    // `error`). Refazer o corte de 10 min aqui era ter dois lugares decidindo o
    // mesmo, e o dia em que um mudasse sozinho produziria mensagem absolvida no
    // backend que a tela nao marcaria, calada. Se o corte mudar la, a tela segue.
    const tresMin = new Date(Date.parse('2026-08-31T19:24:50.845Z') + 3 * 60000).toISOString();
    render(<MessageBubble msg={mensagem({ last_error_at: tresMin })} isGroup />);

    const marca = achaMarcaDeRetencao();
    expect(marca).toBeDefined();
    expect(marca?.getAttribute('title')).toContain('3 minutos depois do envio');
  });

  it('carimbo invertido (erro antes do envio) nao marca nada', () => {
    const antes = new Date(Date.parse('2026-08-31T19:24:50.845Z') - 60000).toISOString();
    render(<MessageBubble msg={mensagem({ last_error_at: antes })} isGroup />);

    expect(achaMarcaDeRetencao()).toBeUndefined();
    expect(achaCheckFraco()).not.toBeNull();
  });

  it('mensagem de grupo sem nenhum erro segue no ✓ atenuado', () => {
    render(<MessageBubble msg={mensagem()} isGroup />);

    expect(achaMarcaDeRetencao()).toBeUndefined();
    expect(achaCheckFraco()).not.toBeNull();
  });

  it('conversa direta nao ganha a marca, mesmo com erro antigo', () => {
    render(<MessageBubble msg={mensagem({ last_error_at: OITO_DIAS_DEPOIS })} isGroup={false} />);

    expect(achaMarcaDeRetencao()).toBeUndefined();
    expect(achaCheckFraco()).toBeNull();
  });
});
