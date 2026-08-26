import { describe, it, expect } from "vitest";
import { ancoraTipoHorario } from "./tipoHorarioAnchor";

describe("ancoraTipoHorario", () => {
  it("usa plantao_em quando o atendimento já tem trabalho fora do comercial", () => {
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: "2026-08-24T22:10:00Z" }))
      .toBe("2026-08-24T22:10:00Z");
  });

  it("cai em opened_at quando plantao_em ainda é nulo", () => {
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: null }))
      .toBe("2026-08-24T19:00:00Z");
  });

  it("devolve undefined sem atendimento, para a RPC usar now()", () => {
    expect(ancoraTipoHorario({})).toBeUndefined();
  });
});
