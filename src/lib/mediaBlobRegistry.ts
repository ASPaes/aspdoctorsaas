import type { QueryClient } from "@tanstack/react-query";

/**
 * Ciclo de vida dos blob URLs de mídia do WhatsApp.
 *
 * `MediaContent` baixa a mídia pelo `whatsapp-media-proxy` e publica um
 * `URL.createObjectURL(blob)` no cache do react-query. Esse objeto NUNCA era
 * revogado: cada áudio, imagem ou vídeo aberto durante o turno ficava preso na
 * memória da aba até o reload. Numa jornada de atendimento a aba incha e tudo
 * fica lento — inclusive digitar e enviar, que não têm nada a ver com mídia.
 *
 * Revogar no unmount do componente não serve: o cache continua guardando a
 * string, e um remount (rolar a conversa, reabrir o chat) reaproveitaria um blob
 * já morto e mostraria mídia quebrada. O dono do blob é a ENTRADA DE CACHE, não
 * o componente — então o revoke acompanha o cache: quando o react-query descarta
 * a entrada (gcTime) ou troca o valor dela, o blob antigo é liberado.
 */

export const MEDIA_BLOB_KEY_ROOT = ["whatsapp", "media-blob"] as const;

export type MediaProxyMode = "inline" | "attachment";

export function mediaBlobKey(messageId: string, mode: MediaProxyMode) {
  return [...MEDIA_BLOB_KEY_ROOT, messageId, mode];
}

function isMediaBlobKey(key: readonly unknown[]): boolean {
  return key[0] === MEDIA_BLOB_KEY_ROOT[0] && key[1] === MEDIA_BLOB_KEY_ROOT[1];
}

function asBlobUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("blob:") ? value : null;
}

let registered = false;

/**
 * Registra o revoker no cache do QueryClient. Chamar UMA vez, junto da criação
 * do client (ver `src/App.tsx`). Idempotente.
 */
export function registerMediaBlobRevoker(queryClient: QueryClient): () => void {
  if (registered) return () => {};
  registered = true;

  // queryHash -> blob URL atualmente publicado por aquela entrada de cache.
  const live = new Map<string, string>();

  return queryClient.getQueryCache().subscribe((event) => {
    const query = (event as { query?: { queryKey: readonly unknown[]; queryHash: string; state: { data: unknown } } }).query;
    if (!query || !isMediaBlobKey(query.queryKey)) return;

    const hash = query.queryHash;
    const prev = live.get(hash);
    const next = asBlobUrl(query.state.data);

    if (event.type === "removed") {
      if (prev) URL.revokeObjectURL(prev);
      if (next && next !== prev) URL.revokeObjectURL(next);
      live.delete(hash);
      return;
    }

    // Refetch publicou um blob novo: o anterior não é mais alcançável.
    if (next !== prev) {
      if (prev) URL.revokeObjectURL(prev);
      if (next) live.set(hash, next);
      else live.delete(hash);
    }
  });
}
