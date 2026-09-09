import type { VelocidadeTimelinePoint } from "./useAtendimentoVelocidadeTimeline";

/** As quatro métricas que o gráfico sabe desenhar. */
export const METRICAS_TIMELINE = ["sla_pct", "tme_p50", "frt_p50", "tmr_p50"] as const;
export type MetricKey = (typeof METRICAS_TIMELINE)[number];

/**
 * Zera as métricas dos dias em que a empresa estava fechada — feriado cadastrado
 * ou dia da semana fora do expediente.
 *
 * O motivo é amostra, não calendário: em dia fechado entram um ou dois chats de
 * plantão, e um único deles fora do alvo joga o dia inteiro para 0%. O gráfico
 * mostrava esse mergulho como se fosse queda de operação.
 *
 * Zera as QUATRO métricas, não só a que está selecionada: o tooltip mostra o
 * ponto inteiro, e deixar as outras preenchidas exibiria número que a linha se
 * recusou a desenhar. `volume` fica intacto de propósito — some a linha, não o
 * fato de que houve atendimento no feriado.
 */
export function prepararSerieTimeline(
  pontos: VelocidadeTimelinePoint[],
): VelocidadeTimelinePoint[] {
  return pontos.map((p) =>
    p.dia_fechado
      ? { ...p, sla_pct: null, tme_p50: null, frt_p50: null, tmr_p50: null }
      : p,
  );
}
