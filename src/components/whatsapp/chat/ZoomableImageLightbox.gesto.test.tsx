import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ZoomableImageLightbox } from "./ZoomableImageLightbox";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 *
 * O que está sob teste é o gesto de FECHAR, não o zoom: o primeiro toque do
 * gesto de ampliar fechava a imagem, e quem tentava dar dois toques como no
 * WhatsApp via a foto sumir no primeiro.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A biblioteca de zoom mede layout de verdade e não roda em jsdom; aqui ela é
// só um passa-adiante para o overlay existir.
vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: any) => (
    <div>
      {typeof children === "function"
        ? children({ zoomIn: () => {}, zoomOut: () => {}, resetTransform: () => {} })
        : children}
    </div>
  ),
  TransformComponent: ({ children }: any) => <div>{children}</div>,
}));

let container: HTMLDivElement;
let root: Root;

function montar(onClose: () => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ZoomableImageLightbox src="blob:teste" alt="Imagem" downloadName="i.png" onClose={onClose} />
    );
  });
  return container.querySelector("[data-esc-layer]") as HTMLElement;
}

function toque(alvo: HTMLElement, x: number, y: number, tipo: "pointerdown" | "pointerup") {
  act(() => {
    alvo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y }));
  });
}

function tocar(alvo: HTMLElement, x = 10, y = 10) {
  toque(alvo, x, y, "pointerdown");
  toque(alvo, x, y, "pointerup");
}

describe("fechar a imagem por toque", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("um toque em área vazia fecha", () => {
    const onClose = vi.fn();
    const fundo = montar(onClose);
    tocar(fundo);
    // ainda não: está esperando para ver se vem o segundo toque
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dois toques seguidos NÃO fecham, porque é o gesto de ampliar", () => {
    const onClose = vi.fn();
    const fundo = montar(onClose);
    tocar(fundo);
    act(() => { vi.advanceTimersByTime(120); }); // dentro da janela do duplo toque
    tocar(fundo);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("arrastar não fecha", () => {
    const onClose = vi.fn();
    const fundo = montar(onClose);
    toque(fundo, 10, 10, "pointerdown");
    toque(fundo, 90, 10, "pointerup");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
