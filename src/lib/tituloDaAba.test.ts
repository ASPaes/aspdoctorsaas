import { describe, it, expect } from "vitest";
import { tituloDaAba } from "./tituloDaAba";

describe("tituloDaAba", () => {
  it("põe o nome da tela antes da marca", () => {
    expect(tituloDaAba("/whatsapp")).toBe("Chat - DoctorSaaS");
    expect(tituloDaAba("/tickets")).toBe("Tickets - DoctorSaaS");
  });

  it("separa rotas que começam igual", () => {
    expect(tituloDaAba("/whatsapp/contatos")).toBe("Contatos - DoctorSaaS");
    expect(tituloDaAba("/clientes/novo")).toBe("Novo cliente - DoctorSaaS");
    expect(tituloDaAba("/clientes/123")).toBe("Cliente - DoctorSaaS");
    expect(tituloDaAba("/onboarding-implantacao/config")).toBe("Configuração de Implantação - DoctorSaaS");
  });

  it("ignora barra no fim", () => {
    expect(tituloDaAba("/tickets/")).toBe("Tickets - DoctorSaaS");
  });

  it("rota desconhecida fica só com a marca", () => {
    expect(tituloDaAba("/")).toBe("DoctorSaaS");
    expect(tituloDaAba("/nao-existe")).toBe("DoctorSaaS");
  });
});
