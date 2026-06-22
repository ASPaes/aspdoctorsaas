export interface HealthSnapshot {
  top_slow_query_ms?: number | null;
  dead_tuples_whatsapp_messages?: number | null;
}

/**
 * Saúde técnica da plataforma (0–100). Fonte ÚNICA para os cards
 * "Saúde do Sistema" (Detalhes) e "Saúde da Plataforma" (Visão Geral).
 * Considera apenas infra acionável: lentidão de query, dead tuples e alertas pendentes.
 * NÃO penaliza instâncias WhatsApp offline (estado do cliente, não da plataforma).
 */
export function computeHealthScore(
  snap: HealthSnapshot | null | undefined,
  pendingAlerts: number,
): number {
  const slow = snap?.top_slow_query_ms ?? 0;
  const dead = snap?.dead_tuples_whatsapp_messages ?? 0;
  return Math.max(
    0,
    Math.round(
      100 -
        (slow > 3000 ? 8 : slow > 1000 ? 4 : 0) -
        (dead > 2000 ? 5 : dead > 500 ? 2 : 0) -
        (pendingAlerts || 0) * 2,
    ),
  );
}
