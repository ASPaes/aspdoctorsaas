import { describe, it, expect } from "vitest";
import {
  lerCaminho, formatarValor, formatarDuracao, valorNumerico, resolverIndicador, SEM_VALOR,
} from "./valorDoIndicador";
import { entradaPorId } from "@/lib/kpiCatalog";

/** Intl separa "R$" do numero com espaco NAO-QUEBRAVEL. Escrever um espaco
 *  comum faz o teste falhar mostrando duas strings visualmente identicas. */
const NBSP = "\u00A0";

describe("lerCaminho", () => {
  it("lê campo raso e aninhado", () => {
    expect(lerCaminho({ total: 34 }, "total")).toBe(34);
    expect(lerCaminho({ totais: { clientes: 7 } }, "totais.clientes")).toBe(7);
  });

  it("devolve undefined em vez de explodir quando o caminho não existe", () => {
    expect(lerCaminho({ a: 1 }, "b")).toBeUndefined();
    expect(lerCaminho({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(lerCaminho(null, "a")).toBeUndefined();
    expect(lerCaminho(undefined, "a")).toBeUndefined();
  });

  it("não confunde zero com ausente", () => {
    expect(lerCaminho({ total: 0 }, "total")).toBe(0);
  });
});

describe("formatarDuracao", () => {
  it("segundos, minutos e horas", () => {
    expect(formatarDuracao(42)).toBe("42s");
    expect(formatarDuracao(108)).toBe("1m48s");
    expect(formatarDuracao(3900)).toBe("1h05m");
  });

  it("negativo vira zero em vez de texto estranho", () => {
    expect(formatarDuracao(-5)).toBe("0s");
  });
});

describe("formatarValor", () => {
  it("nulo e indefinido viram travessão", () => {
    expect(formatarValor(null, "integer")).toBe(SEM_VALOR);
    expect(formatarValor(undefined, "currency")).toBe(SEM_VALOR);
  });

  it("zero NÃO vira travessão", () => {
    expect(formatarValor(0, "integer")).toBe("0");
    // Intl separa "R$" do número com espaço NÃO-QUEBRÁVEL (U+00A0), não com
    // espaço comum. Escrever " " aqui faz o teste falhar mostrando duas
    // strings visualmente idênticas — já mordeu este projeto antes.
    expect(formatarValor(0, "currency")).toBe("R$ 0");
  });

  it("lista vira a contagem — é o que a tela de origem mostra", () => {
    expect(formatarValor([{ a: 1 }, { a: 2 }, { a: 3 }], "integer")).toBe("3");
    expect(formatarValor([], "integer")).toBe("0");
  });

  it("percentual não arrasta ,00 à toa", () => {
    expect(formatarValor(100, "percent")).toBe("100%");
    expect(formatarValor(99.82, "percent")).toBe("99,82%");
  });

  it("razão infinita vira o símbolo, como no Quick Ratio da tela", () => {
    expect(formatarValor(Infinity, "ratio")).toBe("∞");
  });

  it("texto vazio vira travessão", () => {
    expect(formatarValor("   ", "text")).toBe(SEM_VALOR);
    expect(formatarValor("Cliente X", "text")).toBe("Cliente X");
  });

  it("texto que não é número vira travessão nos formatos numéricos", () => {
    expect(formatarValor("abc", "currency")).toBe(SEM_VALOR);
  });
});

describe("valorNumerico", () => {
  it("devolve o número para a barra de benchmark, e o tamanho para lista", () => {
    expect(valorNumerico(4.6)).toBe(4.6);
    expect(valorNumerico([1, 2])).toBe(2);
    expect(valorNumerico("nada")).toBeUndefined();
  });
});

describe("resolverIndicador", () => {
  it("resolve um indicador real do catálogo ponta a ponta", () => {
    const e = entradaPorId("at.frt")!;
    const r = resolverIndicador(e, { frt_p50: 108 });
    expect(r.texto).toBe("1m48s");
    expect(r.numero).toBe(108);
    expect(r.ausente).toBe(false);
  });

  it("caminho aninhado do catálogo funciona", () => {
    const e = entradaPorId("at.cli_mrr")!;
    const r = resolverIndicador(e, { totais: { mrr_coberto: 12345 } });
    expect(r.texto).toBe(`R$${NBSP}12.345`);
  });

  it("dado que não chegou marca ausente sem quebrar", () => {
    const e = entradaPorId("fin.mrr")!;
    const r = resolverIndicador(e, undefined);
    expect(r.ausente).toBe(true);
    expect(r.texto).toBe(SEM_VALOR);
  });
});
