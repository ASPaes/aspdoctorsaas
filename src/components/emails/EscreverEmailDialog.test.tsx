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
}));

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
  return <EscreverEmailDialog pedido={p} onOpenChange={(a) => !a && setP(null)} />;
}

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
