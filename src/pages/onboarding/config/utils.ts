/**
 * Helpers de SLA: converter minutos <-> {dias, horas, minutos} para UI amigável.
 * Armazenamos sempre minutos no banco.
 *
 * O SLA do onboarding é medido em HORÁRIO ÚTIL (expediente do setor do pipeline),
 * não em tempo corrido. Por isso 1 "dia" de SLA vale uma jornada de trabalho de 8h,
 * e não 24h. Ver docs/superpowers/specs/2026-07-26-onboarding-sla-horario-util-e-etapa-gatilho-design.md
 */

/** Minutos de expediente equivalentes a 1 dia útil. */
export const MIN_POR_DIA_UTIL = 480;

export function minutesToParts(total: number | null | undefined): { dias: number; horas: number; minutos: number } {
  const t = Math.max(0, Math.floor(total ?? 0));
  const dias = Math.floor(t / MIN_POR_DIA_UTIL);
  const horas = Math.floor((t % MIN_POR_DIA_UTIL) / 60);
  const minutos = t % 60;
  return { dias, horas, minutos };
}

export function partsToMinutes(dias: number, horas: number, minutos: number): number {
  return Math.max(0, Math.floor(dias) * MIN_POR_DIA_UTIL + Math.floor(horas) * 60 + Math.floor(minutos));
}

export function formatSlaHuman(total: number | null | undefined): string {
  if (total == null || total <= 0) return "—";
  const { dias, horas, minutos } = minutesToParts(total);
  const parts: string[] = [];
  if (dias) parts.push(`${dias}d`);
  if (horas) parts.push(`${horas}h`);
  if (minutos) parts.push(`${minutos}m`);
  return parts.join(" ") || "0m";
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
