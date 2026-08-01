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

/**
 * Etapas que estão FORA da janela contada de SLA.
 *
 * A janela vai da etapa que INICIA a contagem até a que ENCERRA (ambas incluídas).
 * Etapas antes do início ou depois do encerramento continuam existindo no quadro,
 * mas não entram no total nem no go-live — é a mesma regra que
 * `fn_onb_trilho_sla_min` aplica no banco. Se as duas divergirem, a tela mente.
 *
 * Sem `inicia_sla`, a janela começa na primeira etapa; sem `encerra_sla`, termina na
 * última. Config incoerente (encerra vindo antes de iniciar) degrada para "nada fora",
 * em vez de apagar o pipeline inteiro na tela: quem avisa é a faixa do trilho.
 */
export function foraDaJanelaIds(
  stages: Array<{ id: string; position: number; inicia_sla?: boolean | null; encerra_sla?: boolean | null }>,
): Set<string> {
  const fora = new Set<string>();
  if (!stages.length) return fora;

  const ord = [...stages].sort((a, b) => a.position - b.position);
  const idxIniBruto = ord.findIndex((s) => s.inicia_sla);
  const idxFimBruto = ord.findIndex((s) => s.encerra_sla);
  const idxIni = idxIniBruto === -1 ? 0 : idxIniBruto;
  const idxFim = idxFimBruto === -1 ? ord.length - 1 : idxFimBruto;

  if (idxFim < idxIni) return fora;

  ord.forEach((s, i) => {
    if (i < idxIni || i > idxFim) fora.add(s.id);
  });
  return fora;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
