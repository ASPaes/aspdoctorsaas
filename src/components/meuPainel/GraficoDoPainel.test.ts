import { describe, it, expect } from "vitest";
import { pontosDoGrafico } from "./GraficoDoPainel";
import { entradaPorId, kpiCatalog } from "@/lib/kpiCatalog";

describe("pontosDoGrafico", () => {
  it("lista vira barras, da maior para a menor", () => {
    const e = entradaPorId("at.volume_canais")!;
    const p = pontosDoGrafico(e, {
      canais: [{ canal: "whatsapp", qtd: 3 }, { canal: "email", qtd: 9 }],
    });
    expect(p).toEqual([
      { rotulo: "email", valor: 9 },
      { rotulo: "whatsapp", valor: 3 },
    ]);
  });

  it("respeita o limite de barras", () => {
    const e = entradaPorId("at.volume_top_motivos")!;
    const dados = { top_motivos: Array.from({ length: 20 }, (_, i) => ({ tag: `t${i}`, qtd: i })) };
    expect(pontosDoGrafico(e, dados)).toHaveLength(6);
  });

  it("objeto {chave: número} vira barras", () => {
    const e = entradaPorId("cs.backlog_por_status")!;
    const p = pontosDoGrafico(e, { backlogPorStatus: { aberto: 4, fechado: 12 } });
    expect(p).toEqual([
      { rotulo: "fechado", valor: 12 },
      { rotulo: "aberto", valor: 4 },
    ]);
  });

  it("linha NÃO reordena — é série temporal, a ordem do banco é que vale", () => {
    const e = entradaPorId("fin.mrr_serie")!;
    const p = pontosDoGrafico(e, {
      mrrSeries: [
        { dataCorte: "2026-07", mrr: 400 },
        { dataCorte: "2026-08", mrr: 380 },
        { dataCorte: "2026-09", mrr: 440 },
      ],
    });
    expect(p.map((x) => x.rotulo)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("dado ausente ou de formato errado devolve lista vazia, não quebra", () => {
    const e = entradaPorId("at.volume_canais")!;
    expect(pontosDoGrafico(e, undefined)).toEqual([]);
    expect(pontosDoGrafico(e, { canais: "isso não é lista" })).toEqual([]);
    expect(pontosDoGrafico(e, {})).toEqual([]);
  });

  it("descarta linha cujo valor não é número", () => {
    const e = entradaPorId("at.volume_canais")!;
    const p = pontosDoGrafico(e, {
      canais: [{ canal: "a", qtd: 5 }, { canal: "b", qtd: null }, { canal: "c" }],
    });
    expect(p).toEqual([{ rotulo: "a", valor: 5 }]);
  });

  it("card não tem config de gráfico e devolve vazio", () => {
    const e = entradaPorId("at.frt")!;
    expect(pontosDoGrafico(e, { frt_p50: 108 })).toEqual([]);
  });
});

describe("catálogo de gráficos", () => {
  it("todo gráfico disponível declara como desenhar e a largura", () => {
    const quebrados = kpiCatalog
      .filter((e) => e.kind === "chart" && !e.pending)
      .filter((e) => !e.chart || !e.span)
      .map((e) => e.id);
    expect(quebrados).toEqual([]);
  });

  it("gráfico de lista declara os campos de rótulo e valor", () => {
    const semCampos = kpiCatalog
      .filter((e) => e.chart?.fonte === "lista")
      .filter((e) => !e.chart?.rotulo || !e.chart?.valor)
      .map((e) => e.id);
    expect(semCampos).toEqual([]);
  });

  it("existe gráfico selecionável — senão a opção some da tela sem aviso", () => {
    const disponiveis = kpiCatalog.filter((e) => e.kind === "chart" && !e.pending);
    expect(disponiveis.length).toBeGreaterThan(0);
  });
});
