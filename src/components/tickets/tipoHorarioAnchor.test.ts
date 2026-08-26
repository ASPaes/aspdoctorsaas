import { describe, it, expect } from "vitest";
import { ancoraTipoHorario, sugestaoAtendimentoEncerrado } from "./tipoHorarioAnchor";

describe("ancoraTipoHorario", () => {
  it("usa plantao_em quando o atendimento já tem trabalho fora do comercial", () => {
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: "2026-08-24T22:10:00Z" }))
      .toBe("2026-08-24T22:10:00Z");
  });

  it("devolve undefined quando plantao_em é nulo, para a RPC usar now()", () => {
    // trg_zz_set_plantao só grava plantao_em no FECHAMENTO; 73% dos tickets da
    // Digi nascem antes disso. Cair em opened_at é justamente o defeito que o
    // cliente reclamou.
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: null }))
      .toBeUndefined();
  });

  it("devolve undefined sem atendimento, para a RPC usar now()", () => {
    expect(ancoraTipoHorario({})).toBeUndefined();
  });
});

describe("sugestaoAtendimentoEncerrado", () => {
  it("caso 1: plantao_em preenchido manda consultar nesse instante, mesmo com plantao=false", () => {
    // plantao_em é o instante real do trabalho fora da janela; tem prioridade
    // sobre o booleano.
    expect(
      sugestaoAtendimentoEncerrado({
        plantao: false,
        plantao_em: "2026-08-20T22:10:00Z",
        closed_at: "2026-08-21T09:00:00Z",
      })
    ).toEqual({ modo: "consultar", at: "2026-08-20T22:10:00Z" });
  });

  it("caso 2: plantao=false sem plantao_em é resposta definitiva 'comercial', sem consultar nada", () => {
    // O gatilho já calculou e não houve trabalho fora do comercial. Não pode
    // cair no caso 3 e consultar por closed_at — closed_at é ignorado aqui.
    expect(
      sugestaoAtendimentoEncerrado({
        plantao: false,
        plantao_em: null,
        closed_at: "2026-08-21T09:00:00Z",
      })
    ).toEqual({ modo: "comercial" });
  });

  it("caso 3: plantao nulo (cálculo falhou ou linha antiga) consulta pelo closed_at", () => {
    expect(
      sugestaoAtendimentoEncerrado({
        plantao: null,
        plantao_em: null,
        closed_at: "2026-08-21T09:00:00Z",
      })
    ).toEqual({ modo: "consultar", at: "2026-08-21T09:00:00Z" });
  });

  it("caso 3: sem closed_at também, consulta sem 'at' (RPC usa now())", () => {
    expect(sugestaoAtendimentoEncerrado({ plantao: null, plantao_em: null, closed_at: null })).toEqual({
      modo: "consultar",
      at: undefined,
    });
  });

  it("caso 3: objeto vazio (linha antiga, sem nenhum dos 3 campos) consulta sem 'at'", () => {
    expect(sugestaoAtendimentoEncerrado({})).toEqual({ modo: "consultar", at: undefined });
  });
});
