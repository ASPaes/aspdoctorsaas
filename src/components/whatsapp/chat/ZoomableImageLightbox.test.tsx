import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ZoomableImageLightbox } from "./ZoomableImageLightbox";
import { hasOpenEscLayer } from "@/lib/escapeLayers";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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

const pressEscape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

describe("ZoomableImageLightbox — ESC", () => {
  it("fecha a imagem no ESC", () => {
    const onClose = vi.fn();
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={onClose} />));

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regressão: o ESC fechava a imagem E a conversa no mesmo evento, porque o guard
  // do ChatAreaFull só reconhecia overlay do Radix ([data-state="open"]) e o lightbox
  // é um <div> puro. Agora ele se anuncia via data-esc-layer.
  it("se anuncia como camada de ESC enquanto está aberto", () => {
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={() => {}} />));

    expect(hasOpenEscLayer()).toBe(true);

    act(() => root.render(null));

    expect(hasOpenEscLayer()).toBe(false);
  });
});
