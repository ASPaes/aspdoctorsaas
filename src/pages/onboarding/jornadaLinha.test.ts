import { describe, it, expect } from "vitest";
import { dataCurta, diasDeVida, rotuloSituacao, type LinhaJornada } from "./jornadaLinha";

function l(p: Partial<LinhaJornada> = {}): LinhaJornada {
  return {
    journeyId: "j1",
    cliente: "Cliente Teste",
    responsavel: "Fulano",
    situacao: "em_andamento",
    abertaEm: "2026-08-01T12:00:00Z",
    fechadaEm: null,
    ...p,
  };
}

describe("rotuloSituacao", () => {
  it("traduz as cinco situações da jornada", () => {
    expect(rotuloSituacao("nao_iniciado")).toBe("Não iniciada");
    expect(rotuloSituacao("em_andamento")).toBe("Em andamento");
    expect(rotuloSituacao("parado")).toBe("Parada");
    expect(rotuloSituacao("concluido")).toBe("Concluída");
    expect(rotuloSituacao("cancelado")).toBe("Cancelada");
  });

  /** Situação nova no banco não pode virar texto cru na tela do cliente. */
  it("mostra travessão para situação desconhecida ou nula", () => {
    expect(rotuloSituacao("situacao_nova_do_futuro")).toBe("—");
    expect(rotuloSituacao(null)).toBe("—");
  });
});

describe("diasDeVida", () => {
  it("conta da abertura até o desfecho", () => {
    expect(diasDeVida(l({ fechadaEm: "2026-08-11T12:00:00Z" }))).toBe(10);
  });

  it("conta até hoje quando a jornada segue aberta", () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(diasDeVida(l({ abertaEm: ontem }))).toBe(1);
  });

  /** Desfecho anterior à abertura existe no banco (carimbo corrigido a mão). Dia
   *  negativo na coluna seria só ruído — vira 0. */
  it("nunca devolve dias negativos", () => {
    expect(diasDeVida(l({ fechadaEm: "2026-07-01T12:00:00Z" }))).toBe(0);
  });

  it("devolve null quando não há data de abertura", () => {
    expect(diasDeVida(l({ abertaEm: null }))).toBeNull();
  });
});

describe("dataCurta", () => {
  it("formata em dd/mm/aa", () => {
    expect(dataCurta("2026-08-10T12:00:00Z")).toBe("10/08/26");
  });

  it("mostra travessão para data ausente ou inválida", () => {
    expect(dataCurta(null)).toBe("—");
    expect(dataCurta("nao-e-data")).toBe("—");
  });
});
