/**
 * Helpers de SLA: converter minutos <-> {dias, horas, minutos} para UI amigável.
 * Armazenamos sempre minutos no banco.
 */

export function minutesToParts(total: number | null | undefined): { dias: number; horas: number; minutos: number } {
  const t = Math.max(0, Math.floor(total ?? 0));
  const dias = Math.floor(t / (60 * 24));
  const horas = Math.floor((t % (60 * 24)) / 60);
  const minutos = t % 60;
  return { dias, horas, minutos };
}

export function partsToMinutes(dias: number, horas: number, minutos: number): number {
  return Math.max(0, Math.floor(dias) * 24 * 60 + Math.floor(horas) * 60 + Math.floor(minutos));
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
