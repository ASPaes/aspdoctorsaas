import { afterEach, describe, expect, it } from "vitest";
import { linkDoTicket } from "./linkDoTicket";

describe("linkDoTicket", () => {
  afterEach(() => sessionStorage.clear());

  it("usa o endereço atual no app completo", () => {
    sessionStorage.setItem("ds_chat_host", "0");
    expect(linkDoTicket("abc", "http://localhost:8080")).toBe("http://localhost:8080/tickets?ticket=abc");
  });

  it("no endereço de telefone aponta para o app completo", () => {
    sessionStorage.setItem("ds_chat_host", "1");
    expect(linkDoTicket("abc", "https://mobile.doctorsaas.com.br")).toBe("https://app.doctorsaas.com.br/tickets?ticket=abc");
  });
});
