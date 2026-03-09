/**
 * Helpers for formatting dates using Intl.DateTimeFormat with timezone support.
 * No extra dependencies needed — uses native browser APIs.
 */

/** Format a timestamp to HH:mm in a given timezone */
export function formatTime(date: Date | string, timezone: string): string {
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(d);
  } catch {
    return "";
  }
}

/** Format a timestamp to dd/MM/yyyy in a given timezone */
export function formatDateLabel(date: Date | string, timezone: string): string {
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone,
    }).format(d);
  } catch {
    return "—";
  }
}

/** Format relative time (e.g. "2 min", "3 h", "ontem") in a given timezone */
export function formatRelativeTime(date: Date | string, timezone: string): string {
  try {
    const d = typeof date === "string" ? new Date(date) : date;

    // Get "now" in the target timezone by comparing formatted dates
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `${diffMin} min`;
    if (diffHours < 24) return `${diffHours} h`;
    if (diffDays === 1) return "ontem";
    if (diffDays < 7) return `${diffDays} d`;

    return formatDateLabel(d, timezone);
  } catch {
    return "";
  }
}
