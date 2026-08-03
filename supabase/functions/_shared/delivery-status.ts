// Fonte única da ordem dos status de entrega. Ninguém reimplementa local — é a mesma
// regra do phone.ts e do supabasePaginate.ts.
//
// Por que existe: os acks do WhatsApp chegam POR DISPOSITIVO (`...:26@lid`) e, em grupo,
// POR PARTICIPANTE. Gravar o último que chegar faz um ERROR de um aparelho apagar o
// DELIVERY_ACK de outro. A escada resolve isso sem precisar guardar ack por dispositivo.
//
// `failed` compartilha o posto de `error` de propósito: assim um DELIVERY_ACK atrasado
// ainda consegue curar uma mensagem que o verificador já tinha condenado, e um ERROR
// repetido não reabre o caso.

const RANK: Record<string, number> = {
  pending: 1,
  error: 2,
  failed: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

const CONFIRMA_ENTREGA = new Set(["delivered", "read"]);

export interface StatusDecision {
  /** true = pode gravar `status` no banco */
  write: boolean;
  /** o status normalizado a gravar; null quando write=false */
  status: string | null;
  /** marca last_error_at, mesmo quando o status não é gravado */
  setLastErrorAt: boolean;
  /** marca delivery_confirmed_at — prova de que chegou a alguém */
  setDeliveryConfirmedAt: boolean;
}

export function statusRank(s: string | null | undefined): number {
  return RANK[String(s ?? "").toLowerCase()] ?? 0;
}

export function decideStatusUpdate(
  current: string | null | undefined,
  incoming: string,
): StatusDecision {
  const novo = String(incoming ?? "").toLowerCase();
  const rankNovo = RANK[novo];

  // Status que a escada não conhece não entra no banco. O código antigo gravava
  // `raw.toLowerCase()` cru, e era assim que lixo do provedor virava status.
  if (rankNovo === undefined) {
    return { write: false, status: null, setLastErrorAt: false, setDeliveryConfirmedAt: false };
  }

  const sobe = rankNovo > statusRank(current);

  return {
    write: sobe,
    status: sobe ? novo : null,
    setLastErrorAt: novo === "error",
    setDeliveryConfirmedAt: sobe && CONFIRMA_ENTREGA.has(novo),
  };
}
