import { describe, expect, it } from "vitest";
import {
  conjuntoQueFecha, explicar, janelaMovimentos, movimentoDoModulo, nomeDoMes,
  type FilialVariacao, type MovimentoDs,
} from "./oemVariacao";

// CASA DA PONTE, filial 31056, set/2026 contra ago/2026 — dado real.
const casaDaPonte: FilialVariacao = {
  filial: "31056", valorAtual: 154.31, valorAnterior: 140.13, diferenca: 14.18, percentual: 10.12,
  eventos: [
    { tipo: "upsell", modulo: "Servidor Legal", codigo: "72", qtdAntes: 0, qtdDepois: 1, valorAntes: 0, valorDepois: 15, delta: 15, dataAtivacao: "2026-09-22T10:24:29" },
    { tipo: "reajuste", modulo: "PDV/Comandas", codigo: "10", qtdAntes: 7, qtdDepois: 7, valorAntes: 84.82, valorDepois: 81, delta: -3.82, dataAtivacao: null },
    { tipo: "upsell", modulo: "Estoque", codigo: "16", qtdAntes: 0, qtdDepois: 1, valorAntes: 0, valorDepois: 3, delta: 3, dataAtivacao: "2026-09-17T11:08:14" },
  ],
};

const mov = (id: string, descricao: string, tipo = "upsell"): MovimentoDs => ({
  id, cliente_id: "c", tipo, data_movimento: "2026-09-24", valor_delta: 0, custo_delta: 0, descricao,
});

describe("explicar", () => {
  it("acha o Servidor Legal como o que falta na ficha do CASA DA PONTE", () => {
    // Ficha R$ 139,31, OEM R$ 154,31.
    const r = explicar(["31056"], 15, new Map([["31056", casaDaPonte]]), [
      mov("a", "ACRESCIMO DO SERVIDOR LEGAL, NÃO HOUVE AJUSTE NA MENSALIDADE", "venda_avulsa"),
      mov("b", "Adição de Estoque"),
    ]);
    expect(r.explicado).toBe(15);
    expect(r.eventos.filter((e) => e.faltaNaFicha).map((e) => e.modulo)).toEqual(["Servidor Legal"]);
    expect(r.eventos.find((e) => e.modulo === "Servidor Legal")?.movimento?.id).toBe("a");
    expect(r.eventos.find((e) => e.modulo === "Estoque")?.movimento?.id).toBe("b");
    expect(r.movimentosSemPar).toEqual([]);
  });

  it("diz que não fecha quando a diferença vem de antes do mês", () => {
    const r = explicar(["31056"], 40, new Map([["31056", casaDaPonte]]), []);
    expect(r.explicado).toBeNull();
    expect(r.eventos.every((e) => !e.faltaNaFicha)).toBe(true);
  });

  it("cliente sem variação no mês não tem evento", () => {
    const r = explicar(["999"], 10, new Map(), [mov("x", "Troca de adquirente")]);
    expect(r.eventos).toEqual([]);
    expect(r.explicado).toBeNull();
    expect(r.movimentosSemPar.map((m) => m.id)).toEqual(["x"]);
  });
});

describe("conjuntoQueFecha", () => {
  it("prefere o menor conjunto", () => {
    expect(conjuntoQueFecha([5, 10, 5], 10)).toEqual([1]);
  });
  it("compara no centavo, sem erro de ponto flutuante", () => {
    expect(conjuntoQueFecha([0.1, 0.2], 0.3)).toEqual([0, 1]);
  });
});

describe("movimentoDoModulo", () => {
  it("ignora acento e caixa, e casa parte de nome composto", () => {
    expect(movimentoDoModulo("PDV/Comandas", [mov("p", "mais 1 comanda... COMANDAS extra")])?.id).toBe("p");
    expect(movimentoDoModulo("Usuário Cloud", [mov("u", "usuario cloud adicional")])?.id).toBe("u");
  });
});

describe("janelaMovimentos", () => {
  it("vai do 1º dia do mês comparado ao último do analisado", () => {
    expect(janelaMovimentos({ competencia: "09/2026", comparadaCom: "08/2026" })).toEqual({ de: "2026-08-01", ate: "2026-09-30" });
    expect(janelaMovimentos({ competencia: "01/2027", comparadaCom: "12/2026" })).toEqual({ de: "2026-12-01", ate: "2027-01-31" });
  });
  it("nomeia o mês", () => expect(nomeDoMes("09/2026")).toBe("setembro"));
});
