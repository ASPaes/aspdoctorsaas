import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { useAcessoFastComposer } from "./useAcessoFastComposer";
import { openAcessoFast, ACESSOFAST_ORIGIN } from "@/lib/acessofast";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = "a0000000-0000-0000-0000-000000000001";
const CONV = "11111111-2222-3333-4444-555555555555";

/** A "janelinha" que abrimos. `e.source` precisa ser exatamente esta referência. */
const janelinha = { focus: () => {} } as unknown as Window;
const intruso = {} as unknown as Window;

let container: HTMLDivElement;
let root: Root;
let recebidos: string[];

function montar() {
  recebidos = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Componente = () => {
    useAcessoFastComposer((t) => recebidos.push(t));
    return null;
  };
  act(() => { root.render(createElement(Componente)); });
}

function postar(data: unknown, opts: { origin?: string; source?: Window } = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: opts.origin ?? ACESSOFAST_ORIGIN,
        source: (opts.source ?? janelinha) as MessageEventSource,
      }),
    );
  });
}

const msg = (texto: unknown) => ({ tipo: "acessofast:enviar_mensagem", texto });

describe("useAcessoFastComposer", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn(() => janelinha));
    openAcessoFast(TENANT, CONV, {}); // registra a janelinha como a nossa
    montar();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("entrega o texto da nossa janelinha", () => {
    postar(msg("Baixe o AcessoFast em ..."));
    expect(recebidos).toEqual(["Baixe o AcessoFast em ..."]);
  });

  it("IGNORA outra origem — senão qualquer site manda WhatsApp em nome da empresa", () => {
    postar(msg("pix para a conta 123"), { origin: "https://site-malicioso.com" });
    expect(recebidos).toEqual([]);
  });

  it("IGNORA outra janela, mesmo com a origem certa", () => {
    postar(msg("pix para a conta 123"), { source: intruso });
    expect(recebidos).toEqual([]);
  });

  it("ignora mensagem de outro tipo", () => {
    postar({ tipo: "outra:coisa", texto: "x" });
    expect(recebidos).toEqual([]);
  });

  it("ignora payload sem texto string", () => {
    postar(msg(42));
    postar(msg(null));
    postar(null);
    postar("texto solto");
    expect(recebidos).toEqual([]);
  });

  it("ignora texto só de espaços", () => {
    postar(msg("   \n  "));
    expect(recebidos).toEqual([]);
  });

  it("corta texto absurdo em 4000 caracteres", () => {
    postar(msg("a".repeat(9000)));
    expect(recebidos[0].length).toBe(4000);
  });

  it("para de ouvir depois de desmontar", () => {
    act(() => { root.unmount(); });
    postar(msg("depois do unmount"));
    expect(recebidos).toEqual([]);
    // remonta para o afterEach não desmontar duas vezes
    montar();
  });
});
