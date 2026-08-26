import { describe, it, expect } from "vitest";
import { ancoraTipoHorario } from "./tipoHorarioAnchor";

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
