import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { isStaleChunkError, loadChunk, RELOAD_KEY } from "./staleChunkReload";

const erroDeChunk = (msg: string) => new Error(msg);
const CHROME = "Failed to fetch dynamically imported module: https://app.doctorsaas.com.br/assets/CadastroIncompletoTab-B3uT724r.js";

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => vi.restoreAllMocks());

const pendente = async (p: Promise<unknown>) => {
  const marca = Symbol("pendente");
  const r = await Promise.race([p.catch(() => "rejeitou"), Promise.resolve(marca)]);
  return r === marca;
};

describe("isStaleChunkError", () => {
  it("reconhece a mensagem dos quatro navegadores e a de CSS do Vite", () => {
    expect(isStaleChunkError(erroDeChunk(CHROME))).toBe(true);
    expect(isStaleChunkError(erroDeChunk("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(erroDeChunk("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(erroDeChunk("Unable to preload CSS for /assets/x.css"))).toBe(true);
  });

  it("não confunde com erro de aplicação", () => {
    expect(isStaleChunkError(erroDeChunk("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe("loadChunk", () => {
  it("devolve o módulo e não recarrega quando o import passa", async () => {
    const mod = { default: () => null };
    await expect(loadChunk(() => Promise.resolve(mod), 0)).resolves.toBe(mod);
    expect(reload).not.toHaveBeenCalled();
  });

  it("tenta de novo antes de recarregar — falha de rede passageira não derruba a tela", async () => {
    const mod = { default: () => null };
    const factory = vi.fn()
      .mockRejectedValueOnce(erroDeChunk(CHROME))
      .mockResolvedValueOnce(mod);
    await expect(loadChunk(factory, 0)).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("recarrega quando o chunk sumiu de verdade, e a promise fica pendente para não piscar erro", async () => {
    const p = loadChunk(() => Promise.reject(erroDeChunk(CHROME)), 0);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(await pendente(p)).toBe(true);
    expect(sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
  });

  it("não recarrega duas vezes: se o erro persistir depois do reload, o erro sobe para o ErrorBoundary", async () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    await expect(loadChunk(() => Promise.reject(erroDeChunk(CHROME)), 0)).rejects.toThrow(/Failed to fetch/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("erro de aplicação sobe direto, sem retry e sem reload", async () => {
    const factory = vi.fn().mockRejectedValue(erroDeChunk("boom no módulo"));
    await expect(loadChunk(factory, 0)).rejects.toThrow("boom no módulo");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("lazyWithReload", () => {
  it("monta o componente através do Suspense, como o React.lazy", async () => {
    const { createElement, Suspense } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { lazyWithReload } = await import("./staleChunkReload");

    const Tela = () => createElement("p", null, "carregou");
    const Lazy = lazyWithReload(() => Promise.resolve({ default: Tela }));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Suspense, { fallback: createElement("span", null, "...") }, createElement(Lazy)));
    });
    expect(host.textContent).toBe("carregou");
    await act(async () => root.unmount());
  });
});
