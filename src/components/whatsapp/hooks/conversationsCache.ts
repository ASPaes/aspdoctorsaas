import type { QueryClient } from "@tanstack/react-query";

/**
 * Patch de UMA conversa no cache da sidebar.
 *
 * Desde o DEM-0234 (04/08/2026) a lista é `useInfiniteQuery`, então o cache tem
 * a forma `{ pages: ConversationWithContact[][], pageParams }`. Antes era
 * `{ conversations: [...] }` — e três funções continuaram escrevendo na forma
 * antiga com `if (!old?.conversations) return old`. Como `old.conversations`
 * passou a ser `undefined`, o guard casava sempre e **o patch virava um no-op
 * silencioso**: a bolha aparecia no chat na hora, mas o card da sidebar seguia
 * com a mensagem anterior até o refetch (até 60s), parecendo delay do sistema.
 *
 * Ordenação NÃO acontece aqui de propósito. A sidebar reordena por
 * `last_message_at` no próprio memo (`filters.sortBy`), e mover a conversa entre
 * páginas aqui bagunçaria a paginação do servidor.
 */
export function patchConversationInCache(
  queryClient: QueryClient,
  conversationId: string,
  patch: Record<string, any> | ((prev: any) => Record<string, any>),
): void {
  queryClient.setQueriesData({ queryKey: ["whatsapp", "conversations"] }, (old: any) => {
    if (!old?.pages) return old;

    let found = false;
    const pages = old.pages.map((page: any[]) => {
      const idx = page.findIndex((c: any) => c.id === conversationId);
      if (idx === -1) return page;
      found = true;
      const next = [...page];
      const prev = next[idx];
      next[idx] = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
      return next;
    });

    // Conversa fora das páginas carregadas: devolve a referência original para
    // não invalidar memos da sidebar à toa.
    return found ? { ...old, pages } : old;
  });
}

/**
 * Aplica uma transformação em TODAS as conversas em cache. Para patches que não
 * são por id de conversa — ex.: mudar um campo do contato em toda conversa dele.
 */
export function mapConversationsInCache(
  queryClient: QueryClient,
  mapFn: (conversation: any) => any,
): void {
  queryClient.setQueriesData({ queryKey: ["whatsapp", "conversations"] }, (old: any) => {
    if (!old?.pages) return old;
    return { ...old, pages: old.pages.map((page: any[]) => page.map(mapFn)) };
  });
}

/**
 * Remove uma conversa das páginas em cache (patch otimista de transferência).
 * As páginas ficam desiguais até o refetch — aceitável, é o mesmo comportamento
 * da lista plana de antes.
 */
export function removeConversationFromCache(
  queryClient: QueryClient,
  conversationId: string,
): void {
  queryClient.setQueriesData({ queryKey: ["whatsapp", "conversations"] }, (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: any[]) => page.filter((c: any) => c.id !== conversationId)),
    };
  });
}

/** Preview de saída para mensagem sem texto (anexo). Mesma convenção do evolution-webhook. */
export function outgoingMediaPreview(messageType: string): string {
  switch (messageType) {
    case "image": return "📷 Imagem";
    case "audio": return "🎵 Áudio";
    case "video": return "🎥 Vídeo";
    case "document": return "📄 Documento";
    default: return "Mensagem enviada";
  }
}
