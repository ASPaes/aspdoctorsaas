import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PdfPreviewLightbox } from "./PdfPreviewLightbox";
import { hasOpenEscLayer } from "@/lib/escapeLayers";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proxyBlob = vi.hoisted(() => ({
  state: { data: "blob:fake-pdf" as string | undefined, isError: false, isFetching: false },
  refetch: vi.fn(),
}));

// O hook real fala com o whatsapp-media-proxy; aqui só interessa o que a UI faz
// com cada estado dele.
vi.mock("@/components/whatsapp/hooks/useProxyBlob", () => ({
  useProxyBlob: () => ({ ...proxyBlob.state, refetch: proxyBlob.refetch }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  proxyBlob.state = { data: "blob:fake-pdf", isError: false, isFetching: false };
  proxyBlob.refetch.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props?: Partial<React.ComponentProps<typeof PdfPreviewLightbox>>) =>
  act(() =>
    root.render(
      <PdfPreviewLightbox
        messageId="msg-1"
        filename="boleto-08-2026.pdf"
        onClose={() => {}}
        onOpenNewTab={() => {}}
        {...props}
      />
    )
  );

describe("PdfPreviewLightbox", () => {
  it("mostra o PDF num iframe com o blob do proxy", () => {
    render();

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("blob:fake-pdf");
  });

  it("fecha no ESC", () => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Mesmo motivo do lightbox de imagem: sem se anunciar, o ESC fecharia o preview
  // E a conversa no mesmo evento (guard do ChatAreaFull).
  it("se anuncia como camada de ESC enquanto está aberto", () => {
    render();
    expect(hasOpenEscLayer()).toBe(true);

    act(() => root.render(null));
    expect(hasOpenEscLayer()).toBe(false);
  });

  it("enquanto carrega não mostra iframe nem botão de baixar", () => {
    proxyBlob.state = { data: undefined, isError: false, isFetching: true };
    render();

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a[download]")).toBeNull();
  });

  it("erro oferece tentar de novo em vez de tela preta", () => {
    proxyBlob.state = { data: undefined, isError: true, isFetching: false };
    render();

    const retry = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tentar de novo")
    );
    expect(retry).toBeDefined();

    act(() => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(proxyBlob.refetch).toHaveBeenCalledTimes(1);
  });

  // O nome do card vira "Documento" quando o WhatsApp não manda fileName — sem
  // isso o arquivo era salvo sem extensão e o Windows não sabia abrir.
  it("garante a extensão .pdf no download", () => {
    render({ filename: "Documento" });
    expect(container.querySelector("a[download]")?.getAttribute("download")).toBe("Documento.pdf");

    render({ filename: "nota.pdf" });
    expect(container.querySelector("a[download]")?.getAttribute("download")).toBe("nota.pdf");
  });
});
