import { describe, it, expect } from "vitest";
import {
  MAX_ITENS, MAX_SECOES, LAYOUT_VAZIO,
  contarItens, parseLayout, validarLayout, resolverPeriodo, separarConhecidos,
  type DashboardLayout, type LayoutSecao,
} from "./dashboardLayout";

function secao(nome: string, itens: string[]): LayoutSecao {
  return {
    id: nome,
    nome,
    area: "atendimento",
    filtros: {},
    itens: itens.map((id) => ({ id })),
  };
}

describe("contarItens", () => {
  it("soma os itens de todas as seções, gráfico incluído", () => {
    const l: DashboardLayout = {
      versao: 1,
      secoes: [secao("a", ["at.volume_total", "at.frt"]), secao("b", ["at.latencia_histograma"])],
    };
    expect(contarItens(l)).toBe(3);
  });

  it("painel vazio conta zero", () => {
    expect(contarItens(LAYOUT_VAZIO)).toBe(0);
  });
});

describe("validarLayout", () => {
  it("aceita um painel dentro dos limites", () => {
    const l: DashboardLayout = { versao: 1, secoes: [secao("a", ["at.volume_total"])] };
    expect(validarLayout(l)).toEqual({ ok: true });
  });

  it("recusa mais de 15 itens", () => {
    const ids = Array.from({ length: MAX_ITENS + 1 }, (_, i) => `at.i${i}`);
    const r = validarLayout({ versao: 1, secoes: [secao("a", ids)] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("15");
  });

  it("aceita exatamente 15 itens", () => {
    const ids = Array.from({ length: MAX_ITENS }, (_, i) => `at.i${i}`);
    expect(validarLayout({ versao: 1, secoes: [secao("a", ids)] })).toEqual({ ok: true });
  });

  it("conta os 15 no painel inteiro, não por seção", () => {
    const oito = Array.from({ length: 8 }, (_, i) => `at.a${i}`);
    const outrosOito = Array.from({ length: 8 }, (_, i) => `at.b${i}`);
    const r = validarLayout({ versao: 1, secoes: [secao("a", oito), secao("b", outrosOito)] });
    expect(r.ok).toBe(false);
  });

  it("recusa mais de 5 seções", () => {
    const secoes = Array.from({ length: MAX_SECOES + 1 }, (_, i) => secao(`s${i}`, []));
    const r = validarLayout({ versao: 1, secoes });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("5");
  });

  it("recusa seção sem nome", () => {
    const r = validarLayout({ versao: 1, secoes: [{ ...secao("a", []), nome: "  " }] });
    expect(r.ok).toBe(false);
  });

  it("recusa o mesmo indicador duas vezes na mesma seção", () => {
    const r = validarLayout({
      versao: 1,
      secoes: [secao("a", ["at.volume_total", "at.volume_total"])],
    });
    expect(r.ok).toBe(false);
  });

  it("aceita o mesmo indicador em seções diferentes", () => {
    const r = validarLayout({
      versao: 1,
      secoes: [secao("a", ["at.volume_total"]), secao("b", ["at.volume_total"])],
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("parseLayout", () => {
  it("devolve painel vazio para lixo", () => {
    expect(parseLayout(null)).toEqual(LAYOUT_VAZIO);
    expect(parseLayout("texto")).toEqual(LAYOUT_VAZIO);
    expect(parseLayout({ versao: 99 })).toEqual(LAYOUT_VAZIO);
    expect(parseLayout({ versao: 1, secoes: "nao é lista" })).toEqual(LAYOUT_VAZIO);
  });

  it("descarta seção malformada e mantém as boas", () => {
    const r = parseLayout({
      versao: 1,
      secoes: [secao("boa", ["at.volume_total"]), { nome: "sem area" }],
    });
    expect(r.secoes).toHaveLength(1);
    expect(r.secoes[0].nome).toBe("boa");
  });

  it("descarta seção com área inexistente", () => {
    const r = parseLayout({
      versao: 1,
      secoes: [{ id: "x", nome: "x", area: "marketing", filtros: {}, itens: [] }],
    });
    expect(r.secoes).toHaveLength(0);
  });

  it("descarta item sem id e mantém o resto da seção", () => {
    const r = parseLayout({
      versao: 1,
      secoes: [{ id: "s", nome: "s", area: "atendimento", filtros: {}, itens: [{ id: "at.frt" }, {}, null] }],
    });
    expect(r.secoes[0].itens).toEqual([{ id: "at.frt" }]);
  });
});

describe("separarConhecidos", () => {
  it("separa item que existe no catálogo do que sumiu", () => {
    const r = separarConhecidos(secao("a", ["at.volume_total", "at.foi_removido"]));
    expect(r.conhecidos.map((e) => e.id)).toEqual(["at.volume_total"]);
    expect(r.desconhecidos).toEqual(["at.foi_removido"]);
  });
});

describe("padrão da seção", () => {
  it("seção nova nasce em 'Mês atual', não em 'hoje'", async () => {
    const { FILTROS_PADRAO } = await import("@/components/meuPainel/filtrosDaSecao");
    expect(FILTROS_PADRAO.periodo).toBe("mes_atual");
  });
});

describe("resolverPeriodo", () => {
  const agora = new Date(2026, 8, 9, 15, 30, 0); // 09/09/2026 15:30 local

  it("'hoje' resolve o dia da leitura, não o da gravação", () => {
    const r = resolverPeriodo("hoje", agora);
    expect(r.from.getDate()).toBe(9);
    expect(r.from.getHours()).toBe(0);
    expect(r.to.getDate()).toBe(9);
    expect(r.to.getHours()).toBe(23);

    const amanha = new Date(2026, 8, 10, 9, 0, 0);
    expect(resolverPeriodo("hoje", amanha).from.getDate()).toBe(10);
  });

  it("'ontem' é o dia anterior inteiro", () => {
    const r = resolverPeriodo("ontem", agora);
    expect(r.from.getDate()).toBe(8);
    expect(r.to.getDate()).toBe(8);
    expect(r.to.getHours()).toBe(23);
  });

  it("'7d' cobre sete dias terminando hoje", () => {
    const r = resolverPeriodo("7d", agora);
    expect(r.from.getDate()).toBe(3);
    expect(r.to.getDate()).toBe(9);
  });

  it("'mes_atual' começa no dia 1 do mês corrente", () => {
    const r = resolverPeriodo("mes_atual", agora);
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getMonth()).toBe(8);
  });

  it("'mes_anterior' cobre agosto inteiro", () => {
    const r = resolverPeriodo("mes_anterior", agora);
    expect(r.from.getMonth()).toBe(7);
    expect(r.from.getDate()).toBe(1);
    expect(r.to.getMonth()).toBe(7);
    expect(r.to.getDate()).toBe(31);
  });

  it("vira o ano corretamente em janeiro", () => {
    const janeiro = new Date(2026, 0, 15, 10, 0, 0);
    const r = resolverPeriodo("mes_anterior", janeiro);
    expect(r.from.getFullYear()).toBe(2025);
    expect(r.from.getMonth()).toBe(11);
    expect(r.to.getDate()).toBe(31);
  });

  it("intervalo absoluto é devolvido como está", () => {
    const r = resolverPeriodo({ de: "2026-01-01T00:00:00", ate: "2026-01-31T23:59:59" }, agora);
    expect(r.from.getFullYear()).toBe(2026);
    expect(r.from.getMonth()).toBe(0);
    expect(r.to.getDate()).toBe(31);
  });
});
