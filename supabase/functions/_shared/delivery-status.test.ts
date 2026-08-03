// A escada existe para uma coisa só: impedir que um ack atrasado, ou o ack de UM
// dispositivo/participante, derrube o status de uma mensagem que já chegou.
// Errar aqui faz o operador reenviar mensagem que o cliente já leu.
import { describe, it, expect } from "vitest";
import { statusRank, decideStatusUpdate } from "./delivery-status.ts";

describe("statusRank", () => {
  it("ordena do menos para o mais confirmado", () => {
    expect(statusRank("pending")).toBeLessThan(statusRank("error"));
    expect(statusRank("error")).toBeLessThan(statusRank("sent"));
    expect(statusRank("sent")).toBeLessThan(statusRank("delivered"));
    expect(statusRank("delivered")).toBeLessThan(statusRank("read"));
  });

  it("põe failed no mesmo posto de error, para permitir auto-cura", () => {
    expect(statusRank("failed")).toBe(statusRank("error"));
  });

  it("devolve 0 para status desconhecido ou nulo", () => {
    expect(statusRank("banana")).toBe(0);
    expect(statusRank(null)).toBe(0);
    expect(statusRank(undefined)).toBe(0);
  });
});

describe("decideStatusUpdate", () => {
  it("NÃO rebaixa: error depois de read é ignorado", () => {
    const d = decideStatusUpdate("read", "error");
    expect(d.write).toBe(false);
    expect(d.setLastErrorAt).toBe(true); // ainda registra para diagnóstico
    expect(d.setDeliveryConfirmedAt).toBe(false);
  });

  it("NÃO rebaixa: error depois de sent é ignorado", () => {
    expect(decideStatusUpdate("sent", "error").write).toBe(false);
  });

  it("sobe: delivered depois de error grava e confirma entrega", () => {
    const d = decideStatusUpdate("error", "delivered");
    expect(d.write).toBe(true);
    expect(d.status).toBe("delivered");
    expect(d.setDeliveryConfirmedAt).toBe(true);
  });

  it("auto-cura: delivered depois de failed grava", () => {
    const d = decideStatusUpdate("failed", "delivered");
    expect(d.write).toBe(true);
    expect(d.status).toBe("delivered");
  });

  it("não desfaz o veredito: error depois de failed é ignorado", () => {
    expect(decideStatusUpdate("failed", "error").write).toBe(false);
  });

  it("grava: error em cima de pending", () => {
    const d = decideStatusUpdate("pending", "error");
    expect(d.write).toBe(true);
    expect(d.status).toBe("error");
    expect(d.setLastErrorAt).toBe(true);
  });

  it("ack repetido é no-op", () => {
    expect(decideStatusUpdate("read", "read").write).toBe(false);
  });

  it("status desconhecido do provedor é ignorado, não gravado cru", () => {
    const d = decideStatusUpdate("sent", "PLAYED_BACKWARDS");
    expect(d.write).toBe(false);
    expect(d.setLastErrorAt).toBe(false);
  });

  it("mensagem sem status ainda aceita o primeiro ack", () => {
    expect(decideStatusUpdate(null, "sent").write).toBe(true);
  });

  it("read confirma entrega tanto quanto delivered", () => {
    expect(decideStatusUpdate("sent", "read").setDeliveryConfirmedAt).toBe(true);
  });
});
