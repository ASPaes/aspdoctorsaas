import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subscribeSharedChannel } from '@/lib/realtimeChannelPool';
import { patchConversationInCache } from './conversationsCache';

export type MessageUiType = 'text' | 'media' | 'audio' | 'document' | 'image' | 'system' | string;

export interface Message {
  id: string;
  conversation_id: string;
  message_id: string;
  remote_jid: string;
  content: string;
  message_type: string;
  media_url: string | null;
  media_mimetype: string | null;
  media_path: string | null;
  media_filename: string | null;
  media_ext: string | null;
  media_size_bytes: number | null;
  media_kind: string | null;
  media_purged_at: string | null;
  status: string;
  is_from_me: boolean;
  isFromMe?: boolean;
  fromMe?: boolean;
  timestamp: string;
  edited_at: string | null;
  quoted_message_id: string | null;
  mentions: string[] | null;
  mentions_everyone?: boolean | null;
  metadata: Record<string, any> | null;
  audio_transcription: string | null;
  transcription_status: string | null;
  sent_by_user_id: string | null;
  sender_name: string | null;
  sender_role: string | null;
  instance_id: string | null;
  isSystem?: boolean;
  type?: MessageUiType;
  key?: { fromMe?: boolean; from_me?: boolean };
  protocolMessage?: { type?: string | number };
  delete_status?: string | null;
  delete_scope?: string | null;
  delete_error?: string | null;
}

const getRawType = (message: Partial<Message> & Record<string, any>): string => {
  return message.message_type ?? message.messageType ?? message.type ?? 'text';
};

const getIsFromMe = (message: Partial<Message> & Record<string, any>): boolean => {
  return Boolean(
    message.is_from_me ?? message.isFromMe ?? message.fromMe ??
    message.key?.fromMe ?? message.key?.from_me ?? false
  );
};

const getIsSystem = (message: Partial<Message> & Record<string, any>, rawType: string): boolean => {
  return Boolean(
    rawType === 'system' || rawType === 'event' ||
    message.metadata?.system === true ||
    message.protocolMessage?.type === 'REVOKE' ||
    message.metadata?.protocolMessage?.type === 'REVOKE'
  );
};

const toUiType = (rawType: string, isSystem: boolean): MessageUiType => {
  if (isSystem) return 'system';
  if (rawType === 'audio') return 'audio';
  if (rawType === 'document') return 'document';
  if (rawType === 'image') return 'image';
  if (rawType === 'video' || rawType === 'sticker') return 'media';
  if (rawType === 'text') return 'text';
  return rawType;
};

export const normalizeMessage = (message: Partial<Message> & Record<string, any>): Message => {
  const rawType = getRawType(message);
  const isFromMe = getIsFromMe(message);
  const isSystem = getIsSystem(message, rawType);
  return {
    ...(message as Message),
    message_type: rawType,
    is_from_me: isFromMe,
    isFromMe,
    isSystem,
    type: toUiType(rawType, isSystem),
    metadata: message.metadata ?? null,
  };
};

const MESSAGE_SELECT = [
  'id', 'conversation_id', 'message_id', 'remote_jid', 'content', 'message_type',
  'media_url', 'media_mimetype', 'media_path', 'media_filename', 'media_ext',
  'media_size_bytes', 'media_kind', 'media_purged_at', 'status', 'is_from_me', 'timestamp', 'edited_at',
  'quoted_message_id', 'mentions', 'mentions_everyone', 'metadata', 'audio_transcription', 'transcription_status',
  'sent_by_user_id', 'instance_id', 'sender_name', 'sender_role',
  'delete_status', 'delete_scope', 'delete_error',
].join(',');

const PAGE_SIZE = 100;
type MsgCursor = { ts: string; id: string } | null;
export type MsgPages = InfiniteData<Message[]>;

// Insere/atualiza uma mensagem na estrutura de páginas (páginas em ordem DESC).
export function upsertInfinite(data: MsgPages | undefined, msg: Message): MsgPages {
  if (!data || !data.pages?.length) {
    return { pages: [[msg]], pageParams: [null] };
  }
  const pages = data.pages.map((pg) => [...pg]);
  for (let p = 0; p < pages.length; p++) {
    const idx = pages[p].findIndex(
      (m) => m.id === msg.id || (msg.message_id && m.message_id && m.message_id === msg.message_id)
    );
    if (idx !== -1) { pages[p][idx] = msg; return { ...data, pages }; }
  }
  const tempIdx = pages[0].findIndex(
    (m) => m.id?.startsWith?.('temp-') && m.conversation_id === msg.conversation_id
  );
  if (tempIdx !== -1) { pages[0][tempIdx] = msg; return { ...data, pages }; }
  pages[0] = [msg, ...pages[0]];
  return { ...data, pages };
}

// Aplica um patch nas mensagens que casarem o predicado.
export function patchInfinite(
  data: MsgPages | undefined,
  predicate: (m: Message) => boolean,
  patch: Partial<Message>
): MsgPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((pg) => pg.map((m) => (predicate(m) ? { ...m, ...patch } : m))) };
}

export function mergeMessage(old: Message[], incoming: Message): Message[] {
  const exactIdx = old.findIndex(
    (m) => m.id === incoming.id || (incoming.message_id && m.message_id === incoming.message_id)
  );
  if (exactIdx !== -1) {
    const updated = [...old];
    updated[exactIdx] = incoming;
    return updated;
  }
  const tempIdx = old.findIndex(
    (m) => m.id?.startsWith?.('temp-') && m.conversation_id === incoming.conversation_id
  );
  if (tempIdx !== -1) {
    const updated = [...old];
    updated[tempIdx] = incoming;
    return updated;
  }
  return [...old, incoming];
}

// Zerar o badge é escrita em `whatsapp_conversations`, que está na publication
// do Realtime: TODO update vira WAL + fanout para todos os browsers do tenant.
// Medido em 04/08/2026, a decodificação de WAL era o 2º maior custo do banco,
// com pico de 12,9 s — é o que faz a mensagem demorar a aparecer mesmo tendo
// entrado no banco em 1,2 s.
//
// Duas economias, sem mudar o que o usuário vê:
//  - `.gt('unread_count', 0)`: se já está zerado, o Postgres não atualiza linha
//    nenhuma e não gera WAL. É o caso comum — trocar de conversa já lida
//    disparava um UPDATE inútil a cada clique.
//  - throttle por conversa: uma rajada de mensagens gerava um UPDATE por
//    mensagem; agora no máximo um por janela.
const clearUnreadTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearUnreadCount(conversationId: string, throttleMs = 0) {
  const run = () => {
    clearUnreadTimers.delete(conversationId);
    void supabase
      .from('whatsapp_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .gt('unread_count', 0)
      .then();
  };

  if (throttleMs <= 0) {
    run();
    return;
  }
  // Throttle de borda final: se já existe passada agendada, esta rajada entra
  // nela. Debounce (reagendar) seria errado — num fluxo contínuo nunca dispararia.
  if (clearUnreadTimers.has(conversationId)) return;
  clearUnreadTimers.set(conversationId, setTimeout(run, throttleMs));
}

export const useWhatsAppMessages = (
  conversationId: string | null,
  options?: { readOnly?: boolean }
) => {
  const readOnly = options?.readOnly ?? false;
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['whatsapp', 'messages', conversationId],
    enabled: !!conversationId,
    initialPageParam: null as MsgCursor,
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return [] as Message[];
      let q = (supabase.from('whatsapp_messages' as any) as any)
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        q = q.or(`timestamp.lt.${pageParam.ts},and(timestamp.eq.${pageParam.ts},id.lt.${pageParam.id})`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Array<Partial<Message> & Record<string, any>>).map(normalizeMessage);
    },
    getNextPageParam: (lastPage): MsgCursor | undefined => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const oldest = lastPage[lastPage.length - 1];
      return { ts: new Date(oldest.timestamp).toISOString(), id: oldest.id };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  });

  const messages = useMemo<Message[]>(() => {
    const asc = (data?.pages ?? []).flat().reverse();
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of asc) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [data]);

  useEffect(() => {
    if (readOnly) return;
    if (conversationId) {
      // Zerar unread_count na conversa (badge da sidebar). Imediato: o atendente
      // acabou de abrir e o badge tem que sumir na hora.
      clearUnreadCount(conversationId);

      // Dispensar todas as notificações dessa conversa (sino).
      //
      // A RPC devolve QUANTAS foram dispensadas — e só invalidamos se houve
      // alguma. Invalidar incondicionalmente refazia a lista de notificações (50
      // linhas com join, ~25 ms) a cada conversa aberta, e atendente troca de
      // conversa o tempo todo: 579 mil chamadas e 4,1 h de tempo de banco, o 3º
      // maior custo do pg_stat_statements medido em 04/08/2026. Na maioria
      // esmagadora dos cliques não há nada pendente para dispensar, então o
      // refetch era puro desperdício. Pular quando nada mudou é estritamente
      // correto: o cache continua válido.
      supabase
        .rpc('dismiss_conversation_notifications' as any, { p_conversation_id: conversationId })
        .then(({ data: dismissedCount }) => {
          if (!dismissedCount) return;
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
        });
    }
  }, [conversationId, queryClient, readOnly]);

  
  const newMessageCallbackRef = useRef<((msg: Message) => void) | null>(null);
  const lastInvalidateRef = useRef(0);

  const onNewMessage = useCallback((cb: (msg: Message) => void) => {
    newMessageCallbackRef.current = cb;
  }, []);

  // ── Recuperação: buscar o que o Realtime não entregou ──────────────────────
  //
  // `postgres_changes` NÃO tem replay. Se a conexão cai (rede oscilando, máquina
  // suspensa, aba em segundo plano por muito tempo), tudo que aconteceu no
  // intervalo some para sempre — o canal reassina e segue como se nada tivesse
  // faltado. Era o relato do atendente: "às vezes não atualiza a msg, só quando
  // dá F5 ou entra na conversa".
  //
  // E não havia rede de segurança: o fallback do ChatMessages depende do
  // `lastMessageAt`, que vem do `selected` da página, atualizado SÓ pelo
  // Realtime. Realtime fora do ar derrubava o plano B junto com o plano A. F5 e
  // reabrir a conversa funcionavam porque remontam a query.
  //
  // Um refetch resolveria, mas a query é infinita: `invalidateQueries` refaz
  // TODAS as páginas carregadas — quem rolou o histórico pagaria caro e repetido.
  // Esta busca é incremental e de custo constante: pega só o que é mais novo do
  // que a mensagem mais recente em cache.
  const catchUpInFlightRef = useRef(false);

  const catchUpMessages = useCallback(async () => {
    if (!conversationId || catchUpInFlightRef.current) return;

    const cached = queryClient.getQueryData<MsgPages>(['whatsapp', 'messages', conversationId]);
    const known = (cached?.pages ?? []).flat();
    if (known.length === 0) return; // sem carga inicial ainda — a query normal cuida

    let newestIso: string | null = null;
    let newestMs = -Infinity;
    for (const m of known) {
      const ms = new Date(m.timestamp).getTime();
      if (Number.isFinite(ms) && ms > newestMs) { newestMs = ms; newestIso = m.timestamp; }
    }
    if (!newestIso) return;

    catchUpInFlightRef.current = true;
    try {
      // `gte` e não `gt`: mensagens no mesmo segundo existem, e `gt` perderia as
      // irmãs da mais recente. O reprocesso da própria é inofensivo — o
      // upsertInfinite deduplica por id/message_id.
      const { data, error } = await (supabase.from('whatsapp_messages' as any) as any)
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .gte('timestamp', newestIso)
        .order('timestamp', { ascending: true })
        .limit(PAGE_SIZE);

      if (error || !data?.length) return;

      const knownIds = new Set(known.map((m) => m.id));
      for (const raw of data as Array<Partial<Message> & Record<string, any>>) {
        const msg = normalizeMessage(raw);
        if (knownIds.has(msg.id)) continue; // já tínhamos: nada a anunciar
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', conversationId],
          (old) => upsertInfinite(old, msg)
        );
        // Mesmo tratamento do Realtime: rola para o fim se já estava no fim, ou
        // acende "Novas mensagens" se o atendente estava lendo mais acima.
        newMessageCallbackRef.current?.(msg);
        patchConversationPreview(queryClient, conversationId, msg, true);
      }
    } finally {
      catchUpInFlightRef.current = false;
    }
  }, [conversationId, queryClient]);

  // Gatilhos independentes do Realtime — é o ponto: se dependessem dele, não
  // serviriam justamente quando ele falha. Voltar para a aba é o que o atendente
  // fazia manualmente com F5.
  useEffect(() => {
    if (readOnly || !conversationId) return;

    const onBack = () => {
      if (document.visibilityState === 'visible') void catchUpMessages();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    // Último recurso, e só com a aba à vista: aba em segundo plano não gera
    // carga nenhuma no banco.
    const timer = setInterval(onBack, 30_000);

    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
      clearInterval(timer);
    };
  }, [conversationId, readOnly, catchUpMessages]);

  useEffect(() => {
    if (readOnly) return;
    if (!conversationId) return;

    const channelName = `msgs-${conversationId}`;

    return subscribeSharedChannel(
      channelName,
      (channel) => {
        channel.on('postgres_changes' as any, {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `conversation_id=eq.${conversationId}`,
        }, (payload: any) => {
          const incoming = normalizeMessage(payload.new as any);
          queryClient.setQueryData<MsgPages>(
            ['whatsapp', 'messages', conversationId],
            (old) => upsertInfinite(old, incoming)
          );
          newMessageCallbackRef.current?.(incoming);
          patchConversationPreview(queryClient, conversationId, incoming, true);
          if (!incoming.is_from_me) {
            // Throttle: o cache local já mostra a conversa como lida (patch
            // acima), então atrasar a escrita 1,5s não muda nada na tela e
            // colapsa a rajada num único UPDATE.
            clearUnreadCount(conversationId, 1500);
          }
        });
        channel.on('postgres_changes' as any, {
          event: 'UPDATE',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `conversation_id=eq.${conversationId}`,
        }, (payload: any) => {
          const updated = normalizeMessage(payload.new as any);
          queryClient.setQueryData<MsgPages>(
            ['whatsapp', 'messages', conversationId],
            (old) => upsertInfinite(old, updated)
          );
        });
      },
      (status) => {
        // SUBSCRIBED cobre a REASSINATURA depois de uma queda, que é o caso
        // perigoso: o canal volta calado e o intervalo perdido não chega nunca.
        // Na primeira assinatura o catch-up não faz nada (cache vazio).
        if (status === 'SUBSCRIBED') {
          void catchUpMessages();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[realtime] channel ${channelName} caiu (${status})`);
          // Busca incremental em vez de invalidateQueries: a query é infinita e
          // invalidar refaria TODAS as páginas carregadas.
          void catchUpMessages();
        }
      }
    );
  }, [conversationId, queryClient, readOnly, catchUpMessages]);

  return { messages, isLoading, error, onNewMessage, fetchNextPage, hasNextPage, isFetchingNextPage };
};

function patchConversationPreview(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  msg: Message,
  isViewing = false
) {
  const now = msg.timestamp || new Date().toISOString();
  patchConversationInCache(queryClient, conversationId, (prev) => ({
    last_message_at: now,
    last_message_preview: msg.content?.substring(0, 100) || prev.last_message_preview,
    is_last_message_from_me: msg.is_from_me,
    isLastMessageFromMe: msg.is_from_me,
    ...(msg.is_from_me || isViewing ? {} : { unread_count: (prev.unread_count || 0) + 1 }),
    ...(isViewing ? { unread_count: 0 } : {}),
  }));
}
