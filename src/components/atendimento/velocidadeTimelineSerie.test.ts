import { describe, it, expect } from "vitest";
import { prepararSerieTimeline } from "./velocidadeTimelineSerie";
import type { VelocidadeTimelinePoint } from "./useAtendimentoVelocidadeTimeline";

const ponto = (p: Partial<VelocidadeTimelinePoint>): VelocidadeTimelinePoint => ({
  bucket: "2026-09-08",
  volume: 47,
  sla_total: 44,
  sla_dentro: 39,
  sla_pct: 88.6,
  tme_p50: 120,
  frt_p50: 90,
  tmr_p50: 2400,
  dia_fechado: false,
  fechado_motivo: null,
  ...p,
});

describe("prepararSerieTimeline", () => {
  /** O caso que motivou a mudança: 07/09 na ASP teve 2 atendimentos, 1 medido,
   *  fora do alvo — e o gráfico desenhava um mergulho a 0% como se fosse queda
   *  de operação. */
  it("zera as métricas do feriado para a linha quebrar no dia", () => {
    const [feriado] = prepararSerieTimeline([
      ponto({
        bucket: "2026-09-07",
        volume: 2,
        sla_total: 1,
        sla_dentro: 0,
        sla_pct: 0,
        dia_fechado: true,
        fechado_motivo: "Independência do Brasil",
      }),
    ]);
    expect(feriado.sla_pct).toBeNull();
    expect(feriado.tme_p50).toBeNull();
    expect(feriado.frt_p50).toBeNull();
    expect(feriado.tmr_p50).toBeNull();
  });

  /** Some a linha, não o dia: a barra de volume tem que continuar mostrando que
   *  dois clientes foram atendidos no feriado. */
  it("preserva volume, contagens e motivo do dia fechado", () => {
    const [feriado] = prepararSerieTimeline([
      ponto({
        volume: 2,
        sla_total: 1,
        sla_dentro: 0,
        dia_fechado: true,
        fechado_motivo: "Independência do Brasil",
      }),
    ]);
    expect(feriado.volume).toBe(2);
    expect(feriado.sla_total).toBe(1);
    expect(feriado.sla_dentro).toBe(0);
    expect(feriado.fechado_motivo).toBe("Independência do Brasil");
  });

  it("não mexe em dia aberto, mesmo com percentual baixo", () => {
    // Sábado 05/09 da ASP: 57,1% com 7 atendimentos. Sábado é dia útil no
    // cadastro dela, então o ponto CONTINUA no gráfico — é queda de verdade.
    const [sabado] = prepararSerieTimeline([
      ponto({ bucket: "2026-09-05", volume: 9, sla_total: 7, sla_dentro: 4, sla_pct: 57.1 }),
    ]);
    expect(sabado.sla_pct).toBe(57.1);
    expect(sabado.tme_p50).toBe(120);
  });

  it("não altera a lista original", () => {
    const original = [ponto({ dia_fechado: true, sla_pct: 0 })];
    prepararSerieTimeline(original);
    expect(original[0].sla_pct).toBe(0);
  });

  it("devolve os pontos na mesma ordem e quantidade", () => {
    const serie = prepararSerieTimeline([
      ponto({ bucket: "2026-09-05" }),
      ponto({ bucket: "2026-09-07", dia_fechado: true }),
      ponto({ bucket: "2026-09-08" }),
    ]);
    expect(serie.map((p) => p.bucket)).toEqual(["2026-09-05", "2026-09-07", "2026-09-08"]);
  });
});
