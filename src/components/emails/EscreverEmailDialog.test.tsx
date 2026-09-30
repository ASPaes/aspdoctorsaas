import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

/**
 * Guarda do bug de 16/09/2026: o Encaminhar saía só com a mensagem nova. Os
 * anexos iam, o texto do original não, porque o editor montava junto com a
 * janela, recebia o corpo vazio da renderização anterior e o devolvia pelo
 * onChange por cima do original já preparado. Este teste monta a tela REAL
 * (só banco e login são dublês) e confere o que fica no editor.
 */
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, auth: {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { is_super_admin: false } }) }));
vi.mock("@/contexts/TenantFilterContext", () => ({ useTenantFilter: () => ({ effectiveTenantId: "t1" }) }));
vi.mock("./useEmailsEnviados", () => ({ useOpcoesFiltro: () => ({ contas: [{ id: "c1", email: "suporte@x.com", rotulo: "Suporte" }] }) }));
vi.mock("@/components/whatsapp/chat/email/useEmailChatDados", () => ({
  useContasDeEnvio: () => ({ data: { contas: [{ id: "c1", email: "suporte@x.com", rotulo: "Suporte" }] }, isLoading: false }),
  contaInicial: (contas: { id: string }[]) => (contas.length === 1 ? contas[0].id : ""),
}));
// e-mail novo: a busca de cliente vira dois botões, e os e-mails de cada cliente são fixos
const EMAILS_DO_CLIENTE: Record<string, { email: string; rotulo: string }[]> = {
  a: [{ email: "fin@a.com", rotulo: "Cadastro do cliente" }, { email: "socia@a.com", rotulo: "Sócia" }],
  b: [{ email: "adm@b.com", rotulo: "Cadastro do cliente" }],
};
vi.mock("./useEmailsDoCliente", () => ({
  useEmailsDoCliente: (_t: string | null, id: string | null) => ({ data: id ? EMAILS_DO_CLIENTE[id] : undefined, isLoading: false }),
}));
vi.mock("@/components/whatsapp/contatos/ClienteSearchSelect", () => ({
  ClienteSearchSelect: ({ value, onChange }: any) => (
    <div>
      <span data-testid="cliente">{value?.label ?? ""}</span>
      <button onClick={() => onChange({ id: "a", label: "Cliente A" })}>escolher-a</button>
      <button onClick={() => onChange({ id: "b", label: "Cliente B" })}>escolher-b</button>
      <button onClick={() => onChange(null)}>tirar</button>
    </div>
  ),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EscreverEmailDialog, type PedidoEscrita } from "./EscreverEmailDialog";

const pedido: PedidoEscrita = {
  modo: "encaminhar",
  original: {
    id: "e1",
    tipo: "recebido",
    de: "cliente@y.com",
    deNome: "Cliente",
    para: ["suporte@x.com"],
    assunto: "Proposta",
    quando: "2026-09-15T11:12:00-03:00",
    corpoTexto: "Texto do original",
    anexos: [{ nome: "a.pdf", mime: "application/pdf", tamanho: 10, caminho: "t1/email/abc-1-a.pdf" }],
  },
};

let definir: (p: PedidoEscrita | null) => void = () => {};
function Pai() {
  const [p, setP] = useState<PedidoEscrita | null>(null);
  definir = setP;
  return (
    <QueryClientProvider client={new QueryClient()}>
      <EscreverEmailDialog pedido={p} onOpenChange={(a) => !a && setP(null)} />
    </QueryClientProvider>
  );
}

const clicar = (texto: string) =>
  act(async () => {
    const botao = [...document.body.querySelectorAll("button")].find((b) => b.textContent === texto);
    if (!botao) throw new Error(`botão ${texto} não achado`);
    botao.click();
  });

/** chips do campo Destinatário */
const destinatarios = () =>
  (document.body.querySelector("#escrever-para")?.parentElement?.textContent ?? "").replace(/Cco|Cc/g, "");

const textoDoEditor = () => document.body.querySelector(".ProseMirror")?.textContent ?? "";

/** confere de 50 em 50 ms, até 3 s: com a máquina ocupada, espera fixa deu falso negativo */
const esperar = (condicao: () => boolean = () => true) =>
  act(async () => {
    for (let i = 0; i < 60 && !condicao(); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));
  });

describe("tela de encaminhar", () => {
  it("abre com o original no editor, e de novo depois de fechar e reabrir o mesmo e-mail", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<Pai />);
    });

    await act(async () => definir(pedido));
    await esperar(() => textoDoEditor().includes("Texto do original"));
    expect(textoDoEditor()).toContain("Mensagem encaminhada");
    expect(textoDoEditor()).toContain("Texto do original");
    expect(document.body.textContent).toContain("a.pdf");

    await act(async () => definir(null));
    // o editor precisa sumir antes, senão a conferência abaixo leria o editor da abertura anterior
    await esperar(() => !document.body.querySelector(".ProseMirror"));
    expect(document.body.querySelector(".ProseMirror")).toBeNull();
    await act(async () => definir(pedido));
    await esperar(() => textoDoEditor().includes("Texto do original"));
    expect(textoDoEditor()).toContain("Texto do original");
  }, 15_000);
});

describe("e-mail novo (botão Escrever e-mail)", () => {
  it("abre em branco, o cliente puxa o e-mail dele e trocar de cliente tira só o que veio do anterior", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // fecha a janela que o teste anterior deixou aberta
    await act(async () => definir(null));
    await esperar(() => !document.body.querySelector(".ProseMirror"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<Pai />);
    });

    await act(async () => definir({ modo: "novo", id: "n1" }));
    await esperar(() => !!document.body.querySelector(".ProseMirror"));
    expect(document.body.textContent).toContain("Novo e-mail");
    expect(textoDoEditor()).toBe("");
    expect(destinatarios()).toBe("");

    await clicar("escolher-a");
    await esperar(() => destinatarios().includes("fin@a.com"));
    expect(destinatarios()).toContain("fin@a.com");
    // o contato do cliente é sugestão, não entra sozinho
    expect(destinatarios()).not.toContain("socia@a.com");

    await clicar("escolher-b");
    await esperar(() => destinatarios().includes("adm@b.com"));
    expect(destinatarios()).toContain("adm@b.com");
    expect(destinatarios()).not.toContain("fin@a.com");

    await clicar("tirar");
    await esperar(() => !destinatarios().includes("adm@b.com"));
    expect(destinatarios()).toBe("");
  }, 15_000);
});
