import { describe, expect, it } from "vitest";
import { calcularNota, faixaDaNota, fmtTempo, iniciais, posicao, statusAoVivo, vsTime, type Metricas360 } from "./colaborador360Calc";

const base = (over: Partial<Metricas360> = {}): Metricas360 => ({
  user_id: "u", elegivel: true, grupo: "setor", encerrados: 100, frt_p50: 60, tma_p50: 900,
  csat: 4.8, csat_n: 30, csat_satisfeitos: 28, csat_enviados: 60, fcr_pct: 70, fcr_n: 70, fcr_base: 100, ia_n: 90,
  reabertura_pct: 2, qualidade: 80, sent_pos: 60, sent_neu: 30, sent_neg: 10, tk_resolvidos: 10, tk_dias_medio: 1.5,
  n: 5, pct: { csat: 1, frt: 0.8, fcr: 0.6, encerrados: 1, qualidade: 0.4 }, pos: {}, ...over,
});

describe("calcularNota", () => {
  it("pondera as 5 dimensões com os pesos padrão", () => {
    // (100*25 + 80*20 + 60*20 + 100*20 + 40*15) / 100 = 79
    const r = calcularNota(base());
    expect(r.nota).toBe(79);
    expect(r.faixa?.rotulo).toBe("No ritmo");
  });

  it("dimensão sem dado sai da conta e o peso se redistribui", () => {
    const r = calcularNota(base({ pct: { csat: null, frt: 0.8, fcr: 0.6, encerrados: 1, qualidade: 0.4 } }));
    // (80*20 + 60*20 + 100*20 + 40*15) / 75 = 72
    expect(r.nota).toBe(72);
    expect(r.fatores.find((f) => f.chave === "satisfacao")?.pesoEfetivo).toBe(0);
    expect(r.fatores.find((f) => f.chave === "agilidade")?.pesoEfetivo).toBe(27);
  });

  it("sem atendimentos suficientes não dá nota", () => {
    expect(calcularNota(base({ elegivel: false })).nota).toBeNull();
    expect(calcularNota(null).nota).toBeNull();
  });

  it("todas as dimensões sem dado não dá nota", () => {
    expect(calcularNota(base({ pct: {} })).nota).toBeNull();
  });
});

describe("faixas e formatos", () => {
  it("faixas cobrem 0 a 100", () => {
    expect(faixaDaNota(100).rotulo).toBe("Destaque");
    expect(faixaDaNota(80).rotulo).toBe("Destaque");
    expect(faixaDaNota(79).rotulo).toBe("No ritmo");
    expect(faixaDaNota(40).rotulo).toBe("Atenção");
    expect(faixaDaNota(0).rotulo).toBe("Precisa de apoio");
  });

  it("vsTime respeita a direção", () => {
    expect(vsTime(120, 100)).toEqual({ pct: 20, melhor: true, igual: false });
    expect(vsTime(60, 100, true)).toEqual({ pct: 40, melhor: true, igual: false });
    expect(vsTime(150, 100, true)?.melhor).toBe(false);
    expect(vsTime(null, 100)).toBeNull();
    expect(vsTime(10, 0)).toBeNull();
  });

  it("fmtTempo", () => {
    expect(fmtTempo(52)).toBe("52s");
    expect(fmtTempo(108)).toBe("1m 48s");
    expect(fmtTempo(960)).toBe("16 min");
    expect(fmtTempo(3900)).toBe("1h 05m");
    expect(fmtTempo(null)).toBe("sem dado");
  });

  it("posicao e iniciais", () => {
    expect(posicao(2, 6)).toBe("2º de 6");
    expect(posicao(null, 6)).toBeNull();
    expect(iniciais("Carla Menezes Souza")).toBe("CS");
    expect(iniciais("Carla")).toBe("C");
    expect(iniciais(null)).toBe("?");
  });

  it("statusAoVivo: ativo sem sinal recente não é online", () => {
    const agora = new Date("2026-09-28T15:00:00Z");
    expect(statusAoVivo("active", "2026-09-28T14:58:00Z", agora).rotulo).toBe("Online");
    expect(statusAoVivo("active", "2026-09-28T14:00:00Z", agora).rotulo).toBe("Sem sinal");
    expect(statusAoVivo("paused", null, agora).rotulo).toBe("Em pausa");
    expect(statusAoVivo(null, null, agora).rotulo).toBe("Offline");
  });
});
