/**
 * Duração com segundos à mostra.
 *
 * O `fmtEspera` da aba Tempo Real arredonda para minuto e escondia tudo entre
 * 1s e 119s — inútil para latência, TMA e 1ª resposta, que são curtos.
 */
export function fmtDur(s: number | null | undefined): string {
  if (!s || s <= 0) return "—";
  if (s > 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${Math.round(s)}s`;
}
