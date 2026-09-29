import { describe, it, expect } from "vitest";
import { pedirReaberturaAoAbrir, consumirReaberturaPedida } from "./reaberturaPedida";

describe("reabertura pedida pela Nova conversa", () => {
  it("sem pedido não reabre: é a aba esquecida da DEM-0464", () => {
    expect(consumirReaberturaPedida("conv-sem-pedido")).toBe(false);
  });

  it("pedido vale uma abertura só", () => {
    pedirReaberturaAoAbrir("conv-a", 1_000);
    expect(consumirReaberturaPedida("conv-a", 2_000)).toBe(true);
    expect(consumirReaberturaPedida("conv-a", 2_000)).toBe(false);
  });

  it("pedido velho não reabre", () => {
    pedirReaberturaAoAbrir("conv-b", 0);
    expect(consumirReaberturaPedida("conv-b", 61_000)).toBe(false);
  });

  it("pedido de uma conversa não vale para outra", () => {
    pedirReaberturaAoAbrir("conv-c", 0);
    expect(consumirReaberturaPedida("conv-d", 0)).toBe(false);
    expect(consumirReaberturaPedida("conv-c", 0)).toBe(true);
  });
});
