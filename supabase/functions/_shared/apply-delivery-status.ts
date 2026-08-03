import { decideStatusUpdate } from "./delivery-status.ts";

// Tradução de cada provedor para o vocabulário único da escada.
// `failed` da Meta e da Z-API entra como `error`: quem promove a `failed` é só o
// verificador, depois de confirmar. Assim os três provedores passam pela mesma garantia.
const PROVIDER_MAP: Record<string, string> = {
  ERROR: "error",
  FAILED: "error",
  PENDING: "pending",
  SERVER_ACK: "sent",
  SENT: "sent",
  DELIVERY_ACK: "delivered",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
};

export interface ApplyResult {
  changed: boolean;
  /** virou `error` agora — dispara o caminho rápido de verificação */
  confirmedFailureCandidate: boolean;
}

export async function applyDeliveryStatus(
  supabase: any,
  args: { tenantId: string; messageId: string; providerStatus: string },
): Promise<ApplyResult> {
  const bruto = String(args.providerStatus ?? "");
  const normalizado = PROVIDER_MAP[bruto.toUpperCase()] ?? bruto.toLowerCase();

  const { data: atual } = await supabase
    .from("whatsapp_messages")
    .select("status")
    .eq("tenant_id", args.tenantId)
    .eq("message_id", args.messageId)
    .maybeSingle();

  if (!atual) return { changed: false, confirmedFailureCandidate: false };

  const d = decideStatusUpdate(atual.status, normalizado);
  if (!d.write && !d.setLastErrorAt) return { changed: false, confirmedFailureCandidate: false };

  const agora = new Date().toISOString();
  const payload: Record<string, unknown> = {};
  if (d.write) payload.status = d.status;
  if (d.setLastErrorAt) payload.last_error_at = agora;
  if (d.setDeliveryConfirmedAt) payload.delivery_confirmed_at = agora;

  await supabase
    .from("whatsapp_messages")
    .update(payload)
    .eq("tenant_id", args.tenantId)
    .eq("message_id", args.messageId);

  return {
    changed: d.write,
    confirmedFailureCandidate: d.write && d.status === "error",
  };
}
