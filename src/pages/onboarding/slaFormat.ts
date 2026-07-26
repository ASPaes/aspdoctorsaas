/**
 * Formatação de duração no módulo de Onboarding.
 *
 * O SLA do onboarding é medido em HORÁRIO ÚTIL (expediente do setor do pipeline).
 * Por isso existem duas bases e elas NÃO podem ser trocadas uma pela outra:
 *
 *  - formatMinUtil → minutos de expediente. 1 dia útil = 8h, a mesma base do cadastro
 *    de SLA (ver config/utils.ts MIN_POR_DIA_UTIL). Use para sla_*_util_min,
 *    sla_*_pausado_min, etapa_atual_min, onboarding_stages.sla_minutos e
 *    onboarding_stage_history.duracao_util_minutos.
 *
 *  - formatMinCal → minutos de calendário (relógio de parede). 1 dia = 24h.
 *    Use para sla_*_corrido_min, onboarding_stage_history.duracao_minutos e
 *    qualquer duração que não seja de SLA (tempos de atendimento, por exemplo).
 */

/** Minutos de EXPEDIENTE. 1 dia útil = 8h. */
export function formatMinUtil(min?: number | null): string {
  if (min == null || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 8) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 8);
  const rh = h % 8;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Minutos de CALENDÁRIO (relógio de parede). 1 dia = 24h. */
export function formatMinCal(min?: number | null): string {
  if (min == null || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
