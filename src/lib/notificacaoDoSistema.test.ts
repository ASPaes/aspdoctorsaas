import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mostrarNotificacaoDoSistema, marcarIconeDoApp } from "./notificacaoDoSistema";

/**
 * O que este teste protege: no Android `new Notification(...)` lança
 * "Illegal constructor", então o aviso TEM que sair pelo service worker. Era
 * esse o defeito — a exceção caía num catch silencioso e o telefone nunca
 * mostrava nada na barra.
 */

const original = {
  Notification: (globalThis as any).Notification,
  serviceWorker: (globalThis.navigator as any)?.serviceWorker,
};

function fingirPermissao(permissao: NotificationPermission) {
  (globalThis as any).Notification = function () {
    throw new TypeError("Illegal constructor"); // igual ao Chrome Android
  } as unknown as typeof Notification;
  (globalThis as any).Notification.permission = permissao;
}

function fingirServiceWorker(registro: any) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    value: registro === null ? { getRegistration: async () => undefined } : { getRegistration: async () => registro },
  });
}

describe("notificação do sistema", () => {
  beforeEach(() => vi.restoreAllMocks());

  afterEach(() => {
    (globalThis as any).Notification = original.Notification;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: original.serviceWorker,
    });
  });

  it("usa o service worker, e não o construtor", async () => {
    fingirPermissao("granted");
    const showNotification = vi.fn().mockResolvedValue(undefined);
    fingirServiceWorker({ showNotification });

    const ok = await mostrarNotificacaoDoSistema({
      titulo: "Luiz Felipe",
      corpo: "Bom dia",
      tag: "chat-42",
      url: "/whatsapp?c=42",
    });

    expect(ok).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [titulo, opcoes] = showNotification.mock.calls[0];
    expect(titulo).toBe("Luiz Felipe");
    expect(opcoes.tag).toBe("chat-42");
    // o clique precisa saber para onde ir: quem lê isso é o sw.js
    expect(opcoes.data).toEqual({ url: "/whatsapp?c=42" });
  });

  it("sem permissão, não tenta nada", async () => {
    fingirPermissao("default");
    const showNotification = vi.fn();
    fingirServiceWorker({ showNotification });

    expect(await mostrarNotificacaoDoSistema({ titulo: "x" })).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("sem service worker registrado, não quebra", async () => {
    fingirPermissao("granted");
    fingirServiceWorker(null);
    // o construtor lança, como no Android: a função devolve false em vez de subir o erro
    await expect(mostrarNotificacaoDoSistema({ titulo: "x" })).resolves.toBe(false);
  });
});

describe("número no ícone do app", () => {
  it("marca com a contagem e limpa no zero", () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { setAppBadge, clearAppBadge });

    marcarIconeDoApp(7);
    expect(setAppBadge).toHaveBeenCalledWith(7);

    marcarIconeDoApp(0);
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("onde a API não existe, não quebra", () => {
    Object.assign(navigator, { setAppBadge: undefined, clearAppBadge: undefined });
    expect(() => marcarIconeDoApp(3)).not.toThrow();
  });
});
