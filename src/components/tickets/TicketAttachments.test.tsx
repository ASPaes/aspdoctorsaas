import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TicketAttachments } from "./TicketAttachments";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANEXOS = [
  {
    id: "a1", file_name: "contrato_assinado.pdf", file_path: "t/1/contrato.pdf",
    file_size: 1258291, file_type: "application/pdf", uploaded_by: "u1",
    created_at: "2026-08-02T17:32:00Z", title: "Contrato assinado",
  },
  {
    id: "a2", file_name: "WhatsApp Image 2026-07-14.jpeg", file_path: "t/1/wa.jpeg",
    file_size: 348160, file_type: "image/jpeg", uploaded_by: "u2",
    created_at: "2026-08-01T12:14:00Z", title: null,
  },
];

let umAnexoSo = false;

// Lista de anexos e mapa de nomes: o mock roteia por tabela.
vi.mock("@/integrations/supabase/client", () => {
  const anexosChain: any = {
    select: () => anexosChain,
    eq: () => anexosChain,
    order: () => Promise.resolve({ data: umAnexoSo ? [ANEXOS[0]] : ANEXOS, error: null }),
  };
  const from = (tabela: string) => {
    if (tabela === "support_ticket_attachments") return anexosChain;
    return {
      select: () => ({
        in: (_c: string, _ids: any[]) =>
          tabela === "profiles"
            ? Promise.resolve({ data: [{ user_id: "u1", funcionario_id: 10 }, { user_id: "u2", funcionario_id: 11 }], error: null })
            : Promise.resolve({ data: [{ id: 10, nome: "Alexandre" }, { id: 11, nome: "Marcos" }], error: null }),
      }),
    };
  };
  return {
    supabase: { from, auth: { getSession: () => Promise.resolve({ data: { session: null } }) }, functions: { invoke: vi.fn() } },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const auth = { user: { id: "u1" }, profile: { role: "user", is_super_admin: false } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

async function render(variant?: "ticket" | "onboarding") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <TicketAttachments ticketId="tk1" tenantId="t1" variant={variant} />
      </QueryClientProvider>
    );
  });
  // Anexos e, em seguida, os nomes dos autores: esperar por timer, não por microtask.
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return host;
}

beforeEach(() => {
  auth.profile = { role: "user", is_super_admin: false };
  umAnexoSo = false;
  document.body.innerHTML = "";
});

describe("TicketAttachments — leitura no onboarding", () => {
  it("mostra o título como linha principal e o arquivo abaixo", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("Contrato assinado");
    expect(host.textContent).toContain("contrato_assinado.pdf");
  });

  it("marca 'sem título' quando não há título", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("sem título");
  });

  it("mostra quem anexou", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("Alexandre");
    expect(host.textContent).toContain("Marcos");
  });
});

describe("TicketAttachments — suporte (variant padrão)", () => {
  it("não mostra título nem autoria", async () => {
    const host = await render();
    expect(host.textContent).not.toContain("Contrato assinado");
    expect(host.textContent).not.toContain("sem título");
    expect(host.textContent).not.toContain("Alexandre");
    expect(host.textContent).toContain("contrato_assinado.pdf");
  });
});

function inputBusca(): HTMLInputElement {
  const el = document.querySelector('input[type="search"]');
  if (!el) throw new Error("campo de busca não encontrado");
  return el as HTMLInputElement;
}

async function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TicketAttachments — busca", () => {
  it("filtra pelo título", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "contrato");
    expect(host.textContent).toContain("contrato_assinado.pdf");
    expect(host.textContent).not.toContain("WhatsApp Image");
  });

  it("filtra pela extensão", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "jpeg");
    expect(host.textContent).toContain("WhatsApp Image");
    expect(host.textContent).not.toContain("contrato_assinado.pdf");
  });

  it("mostra o contador enquanto filtra", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "contrato");
    expect(host.textContent).toContain("1 de 2");
  });

  it("avisa quando nada corresponde", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "boleto");
    expect(host.textContent).toContain("Nenhum anexo corresponde");
  });

  it("não mostra busca no Suporte", async () => {
    await render();
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });

  it("não mostra busca com um anexo só", async () => {
    umAnexoSo = true;
    await render("onboarding");
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });
});

function lapis(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button[title="Editar título"]')] as HTMLButtonElement[];
}

describe("TicketAttachments — edição de título", () => {
  it("operador comum só edita o que ele mesmo subiu", async () => {
    // auth.user.id = "u1"; a1 é de u1, a2 é de u2.
    await render("onboarding");
    expect(lapis()).toHaveLength(1);
  });

  it("head edita qualquer anexo", async () => {
    auth.profile = { role: "head", is_super_admin: false };
    await render("onboarding");
    expect(lapis()).toHaveLength(2);
  });

  it("não há lápis no Suporte", async () => {
    auth.profile = { role: "admin", is_super_admin: true };
    await render();
    expect(lapis()).toHaveLength(0);
  });
});
