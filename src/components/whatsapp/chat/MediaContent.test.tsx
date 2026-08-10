import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MediaContent } from "./MediaContent";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  },
}));

// IntersectionObserver controlável: guarda os elementos observados e dispara
// interseção sob demanda.
type FakeIO = { cb: (entries: unknown[]) => void; els: Element[] };
let observers: FakeIO[] = [];

function fireIntersection() {
  act(() => {
    for (const io of observers) {
      if (io.els.length === 0) continue;
      io.cb(io.els.map((target) => ({ isIntersecting: true, target })));
    }
  });
}

class MockIntersectionObserver {
  private entry: FakeIO;
  constructor(cb: (entries: unknown[]) => void) {
    this.entry = { cb, els: [] };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.els.push(el);
  }
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  observers = [];
  (globalThis as any).IntersectionObserver = MockIntersectionObserver;
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["bytes"]),
  }));
  (URL as any).createObjectURL = vi.fn(() => "blob:fake-url");
  (URL as any).revokeObjectURL = vi.fn();

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
});

function renderWith(mediaUrl: string | null) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MediaContent
          messageId="msg-1"
          messageType="image"
          mediaUrl={mediaUrl as unknown as string}
          mediaPath={mediaUrl}
          mediaMimetype="image/jpeg"
        />
      </QueryClientProvider>
    );
  });
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("MediaContent — mídia que chega depois da mensagem", () => {
  it("baixa a imagem quando media_url é preenchido pelo webhook DEPOIS do INSERT", async () => {
    // 1) A mensagem entra sem media_url (o evolution-webhook grava primeiro e só
    //    depois baixa a mídia quando o fileLength não vem no payload).
    renderWith(null);
    expect(container.textContent).toContain("Não foi possível baixar este arquivo");

    // 2) A bolha está na tela do atendente.
    fireIntersection();

    // 3) O UPDATE do webhook chega pelo Realtime com o caminho no Storage.
    renderWith("wa/tenant/msg-1.jpg");
    fireIntersection();
    await flush();

    // Sem isto o atendente fica olhando um spinner até dar F5.
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("baixa a imagem quando media_url já vem no INSERT", async () => {
    renderWith("wa/tenant/msg-1.jpg");
    fireIntersection();
    await flush();

    expect(container.querySelector("img")).not.toBeNull();
  });
});
