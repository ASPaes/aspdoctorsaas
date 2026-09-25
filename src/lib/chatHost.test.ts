import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isChatHost } from "./chatHost";

/** jsdom não deixa escrever em location: troca o objeto inteiro. */
function comUrl(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, href, hostname: url.hostname, search: url.search },
  });
}

describe("isChatHost", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("liga no subdominio da versao de telefone", () => {
    comUrl("https://mobile.doctorsaas.com.br/");
    expect(isChatHost()).toBe(true);
  });

  // O endereco antigo continua valendo: app instalado guarda o endereco da
  // instalacao, e quem instalou pelo chat. abriria um endereco morto.
  it("continua ligando no endereco antigo do chat", () => {
    comUrl("https://chat.doctorsaas.com.br/");
    expect(isChatHost()).toBe(true);
  });

  it("fica desligado no endereco do app", () => {
    comUrl("https://app.doctorsaas.com.br/whatsapp");
    expect(isChatHost()).toBe(false);
  });

  it("nao confunde host que so contem 'chat' no meio", () => {
    comUrl("https://meuchat.doctorsaas.com.br/");
    expect(isChatHost()).toBe(false);
  });

  it("?chat=1 liga no localhost e continua valendo na navegacao seguinte", () => {
    comUrl("http://localhost:8080/?chat=1");
    expect(isChatHost()).toBe(true);

    // Rota interna, sem o parametro na URL: o sessionStorage segura a decisao.
    comUrl("http://localhost:8080/whatsapp");
    expect(isChatHost()).toBe(true);
  });

  it("?chat=0 desliga mesmo no subdominio do chat", () => {
    comUrl("https://chat.doctorsaas.com.br/?chat=0");
    expect(isChatHost()).toBe(false);
  });

  it("cai no hostname quando o sessionStorage esta bloqueado", () => {
    comUrl("https://chat.doctorsaas.com.br/");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(isChatHost()).toBe(true);
  });
});
