import { describe, it, expect } from "vitest";
import { foraDaJanelaIds, formatSlaHuman, partsToMinutes } from "./utils";

/**
 * A janela contada é do `inicia_sla` até o `encerra_sla`. Etapas fora dela aparecem no
 * cadastro mas não entram no total nem no go-live — a mesma regra que
 * fn_onb_trilho_sla_min aplica no banco. Se as duas divergirem, a tela mente.
 */
const s = (id: string, position: number, extra: Partial<{ inicia_sla: boolean; encerra_sla: boolean }> = {}) =>
  ({ id, position, inicia_sla: false, encerra_sla: false, ...extra });

describe("foraDaJanelaIds", () => {
  it("sem marcação nenhuma, nada fica fora", () => {
    const fora = foraDaJanelaIds([s("a", 1), s("b", 2), s("c", 3)]);
    expect(fora.size).toBe(0);
  });

  it("etapas depois da que encerra ficam fora", () => {
    const fora = foraDaJanelaIds([s("a", 1), s("b", 2, { encerra_sla: true }), s("c", 3)]);
    expect([...fora]).toEqual(["c"]);
  });

  it("a própria etapa que encerra fica DENTRO", () => {
    const fora = foraDaJanelaIds([s("a", 1), s("b", 2, { encerra_sla: true })]);
    expect(fora.has("b")).toBe(false);
  });

  it("etapas antes da que inicia ficam fora", () => {
    const fora = foraDaJanelaIds([s("a", 1), s("b", 2, { inicia_sla: true }), s("c", 3)]);
    expect([...fora]).toEqual(["a"]);
  });

  it("corta dos dois lados quando inicia e encerra estão no meio", () => {
    const fora = foraDaJanelaIds([
      s("a", 1), s("b", 2, { inicia_sla: true }), s("c", 3, { encerra_sla: true }), s("d", 4),
    ]);
    expect([...fora].sort()).toEqual(["a", "d"]);
  });

  it("ordena por position, não pela ordem do array", () => {
    const fora = foraDaJanelaIds([s("c", 3), s("a", 1), s("b", 2, { encerra_sla: true })]);
    expect([...fora]).toEqual(["c"]);
  });

  it("config incoerente (encerra antes de iniciar) não joga tudo fora", () => {
    // Sem guarda, ini=2 e fim=1 deixariam a janela vazia e a tela apagaria o pipeline
    // inteiro. Preferimos degradar para "nada fora" e deixar o aviso do trilho falar.
    const fora = foraDaJanelaIds([s("a", 1, { encerra_sla: true }), s("b", 2, { inicia_sla: true })]);
    expect(fora.size).toBe(0);
  });

  it("lista vazia não quebra", () => {
    expect(foraDaJanelaIds([]).size).toBe(0);
  });
});

describe("formatSlaHuman (base 8h, já existente — guarda de regressão)", () => {
  it("3720 min vira 7d 6h", () => {
    expect(formatSlaHuman(3720)).toBe("7d 6h");
  });
  it("partsToMinutes usa 480 por dia", () => {
    expect(partsToMinutes(1, 0, 0)).toBe(480);
  });
});
