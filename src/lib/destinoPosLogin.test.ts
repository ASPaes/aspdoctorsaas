import { beforeEach, describe, expect, it } from "vitest";
import { consumirDestinoPosLogin, destinoValido, ehLinkDeTicket, guardarDestinoPosLogin } from "./destinoPosLogin";

describe("destinoPosLogin", () => {
  beforeEach(() => sessionStorage.clear());

  it("guarda o link do ticket e devolve uma vez só", () => {
    guardarDestinoPosLogin("/tickets?ticket=abc");
    expect(consumirDestinoPosLogin()).toBe("/tickets?ticket=abc");
    expect(consumirDestinoPosLogin()).toBeNull();
  });

  it("não guarda página comum: o Sair continua levando ao destino padrão", () => {
    guardarDestinoPosLogin("/whatsapp");
    guardarDestinoPosLogin("/tickets");
    guardarDestinoPosLogin("/tickets?status=aberto");
    guardarDestinoPosLogin("/");
    expect(consumirDestinoPosLogin()).toBeNull();
  });

  it("aceita o ticket junto de outros parâmetros", () => {
    expect(ehLinkDeTicket("/tickets?aba=x&ticket=abc")).toBe(true);
  });

  it("recusa endereço de fora", () => {
    expect(destinoValido("//evil.com/x")).toBe(false);
    expect(destinoValido("/\\evil.com")).toBe(false);
    expect(destinoValido("https://evil.com")).toBe(false);
    sessionStorage.setItem("destino_pos_login", "//evil.com/tickets?ticket=1");
    expect(consumirDestinoPosLogin()).toBeNull();
  });
});
