import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AttachmentTitlesDialog } from "./AttachmentTitlesDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const arquivos = [
  new File(["a"], "contrato_assinado.pdf", { type: "application/pdf" }),
  new File(["b"], "print_erro.png", { type: "image/png" }),
];

function botao(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`botão "${texto}" não encontrado`);
  return b as HTMLButtonElement;
}

async function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    createRoot(host).render(
      <AttachmentTitlesDialog open files={arquivos} onCancel={onCancel} onConfirm={onConfirm} />
    );
  });
  return { onConfirm, onCancel };
}

function camposDeTitulo(): HTMLInputElement[] {
  return [...document.querySelectorAll('input[data-titulo="1"]')] as HTMLInputElement[];
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("AttachmentTitlesDialog", () => {
  it("um campo por arquivo, com o nome sem extensão no placeholder", () => {
    render();
    const campos = camposDeTitulo();
    expect(campos).toHaveLength(2);
    expect(campos[0].placeholder).toBe("contrato_assinado");
    expect(campos[1].placeholder).toBe("print_erro");
  });

  it("começa vazio — o título é opcional, não pré-preenchido", () => {
    render();
    expect(camposDeTitulo().every((c) => c.value === "")).toBe(true);
  });

  it("envia os títulos digitados junto dos arquivos", async () => {
    const { onConfirm } = render();
    await digitar(camposDeTitulo()[0], "Contrato assinado");
    await act(async () => { botao("Enviar").click(); });
    expect(onConfirm).toHaveBeenCalledWith([
      { file: arquivos[0], title: "Contrato assinado" },
      { file: arquivos[1], title: "" },
    ]);
  });

  it("permite enviar tudo sem título", async () => {
    const { onConfirm } = render();
    await act(async () => { botao("Enviar").click(); });
    expect(onConfirm).toHaveBeenCalledWith([
      { file: arquivos[0], title: "" },
      { file: arquivos[1], title: "" },
    ]);
  });

  it("cancelar não envia nada", async () => {
    const { onConfirm, onCancel } = render();
    await act(async () => { botao("Cancelar").click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
