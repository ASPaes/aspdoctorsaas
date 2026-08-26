/**
 * Descarte manual do risco de churn (admin/head).
 *
 * Fonte única da regra no frontend — o backend faz a mesma comparação em
 * `fn_churn_descarte_ativo`. Reimplementar isso em cada tela é como o sinal
 * some de um lugar e sobra em outro.
 *
 * O descarte é ancorado no atendimento ativo na hora em que foi feito: vale
 * enquanto aquele ainda for o atendimento ativo da conversa. Quando o chat
 * encerra e o cliente volta, o atendimento é outro, a âncora deixa de bater e
 * a IA volta a poder sinalizar — sem cron, sem rotina de limpeza.
 */

type SentimentDismissFields = {
  churn_dismissed_at?: string | null;
  churn_dismissed_attendance_id?: string | null;
} | null | undefined;

export function isChurnDismissed(
  sentiment: SentimentDismissFields,
  activeAttendanceId: string | null | undefined
): boolean {
  if (!sentiment?.churn_dismissed_at) return false;
  return (sentiment.churn_dismissed_attendance_id ?? null) === (activeAttendanceId ?? null);
}

type SentimentTicketFields = (SentimentDismissFields & {
  needs_cs_ticket?: boolean | null;
  cs_ticket_created_id?: string | null;
}) | null | undefined;

/** A IA pediu ticket CS, ninguém abriu ainda e ninguém descartou. */
export function showsCSTicketAlert(
  sentiment: SentimentTicketFields,
  activeAttendanceId: string | null | undefined
): boolean {
  if (!sentiment?.needs_cs_ticket) return false;
  if (sentiment.cs_ticket_created_id) return false;
  return !isChurnDismissed(sentiment, activeAttendanceId);
}
