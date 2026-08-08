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

// jsdom não tem PointerEvent; React só olha o type do evento, então MouseEvent serve.
const click = (el: Element, x = 10, y = 10) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: x, clientY: y }));
  });

describe("ZoomableImageLightbox — clique fora", () => {
  // Regressão: só o X fechava. O wrapper do react-zoom-pan-pinch cobre a tela
  // inteira, então o clique na lateral nunca chegava ao overlay como currentTarget.
  it("fecha ao clicar na área vazia ao lado da imagem", () => {
    const onClose = vi.fn();
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={onClose} />));

    const wrapper = container.querySelector(".react-transform-wrapper")!;
    expect(wrapper).toBeTruthy();
    click(wrapper);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("não fecha ao clicar na própria imagem", () => {
    const onClose = vi.fn();
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={onClose} />));

    click(container.querySelector("img")!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("não fecha ao usar os controles de zoom", () => {
    const onClose = vi.fn();
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={onClose} />));

    click(container.querySelector('[title="Aumentar zoom"]')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("não fecha quando o clique é um arrasto", () => {
    const onClose = vi.fn();
    act(() => root.render(<ZoomableImageLightbox src="blob:fake" onClose={onClose} />));

    const wrapper = container.querySelector(".react-transform-wrapper")!;
    act(() => {
      wrapper.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 })
      );
      wrapper.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 120 })
      );
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
