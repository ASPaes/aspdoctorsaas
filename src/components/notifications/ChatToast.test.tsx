import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatToast } from "./ChatToast";

/** Sem @testing-library/react: o peer @testing-library/dom não está instalado. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatToast", () => {
  it("mostra o contato e a prévia da mensagem", () => {
    act(() => {
      root.render(
        <ChatToast
          title="João Silva · Financeiro"
          body="Bom dia, preciso de ajuda"
          onOpen={() => {}}
          onDismiss={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("João Silva · Financeiro");
    expect(container.textContent).toContain("Bom dia, preciso de ajuda");
  });

  it("com mais de uma mensagem, troca a prévia pelo contador", () => {
    act(() => {
      root.render(
        <ChatToast
          title="João Silva"
          body="terceira"
          unreadCount={3}
          onOpen={() => {}}
          onDismiss={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("3 mensagens");
    expect(container.textContent).not.toContain("terceira");
  });

  it("com uma mensagem só, não mostra contador", () => {
    act(() => {
      root.render(
        <ChatToast title="João" body="oi" unreadCount={1} onOpen={() => {}} onDismiss={() => {}} />,
      );
    });
    expect(container.textContent).not.toContain("mensagens");
    expect(container.textContent).toContain("oi");
  });

  it("clique no corpo chama onOpen", () => {
    const onOpen = vi.fn();
    act(() => {
      root.render(<ChatToast title="João" body="oi" onOpen={onOpen} onDismiss={() => {}} />);
    });
    const corpo = container.querySelector<HTMLElement>('[data-testid="chat-toast-body"]')!;
    act(() => corpo.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("clique no X fecha sem abrir a conversa", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    act(() => {
      root.render(<ChatToast title="João" body="oi" onOpen={onOpen} onDismiss={onDismiss} />);
    });
    const fechar = container.querySelector<HTMLElement>('[data-testid="chat-toast-close"]')!;
    act(() => fechar.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
