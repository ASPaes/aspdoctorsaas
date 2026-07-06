import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subscribeSharedChannel } from '@/lib/realtimeChannelPool';

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
  status: string;
  is_from_me: boolean;
  isFromMe?: boolean;
  fromMe?: boolean;
  timestamp: string;
  edited_at: string | null;
  quoted_message_id: string | null;
  mentions: string[] | null;
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
  'media_size_bytes', 'media_kind', 'status', 'is_from_me', 'timestamp', 'edited_at',
  'quoted_message_id', 'metadata', 'audio_transcription', 'transcription_status',
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

export const useWhatsAppMessages = (conversationId: string | null) => {
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
    if (conversationId) {
      // Zerar unread_count na conversa (badge da sidebar)
      supabase
        .from('whatsapp_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .then();

      // Dispensar todas as notificações dessa conversa (sino)
      supabase
        .rpc('dismiss_conversation_notifications' as any, { p_conversation_id: conversationId })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
        });
    }
  }, [conversationId, queryClient]);

  
  const newMessageCallbackRef = useRef<((msg: Message) => void) | null>(null);
  const lastInvalidateRef = useRef(0);

  const onNewMessage = useCallback((cb: (msg: Message) => void) => {
    newMessageCallbackRef.current = cb;
  }, []);

  useEffect(() => {
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
            supabase
              .from('whatsapp_conversations')
              .update({ unread_count: 0 })
              .eq('id', conversationId)
              .then();
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
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[realtime] channel ${channelName} failed (${status})`);
          queryClient.invalidateQueries({
            queryKey: ['whatsapp', 'messages', conversationId],
          });
        }
      }
    );
  }, [conversationId, queryClient]);

  return { messages, isLoading, error, onNewMessage, fetchNextPage, hasNextPage, isFetchingNextPage };
};

function patchConversationPreview(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  msg: Message,
  isViewing = false
) {
  queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
    if (!old?.conversations) return old;
    const idx = old.conversations.findIndex((c: any) => c.id === conversationId);
    if (idx === -1) return old;
    const patched = [...old.conversations];
    const now = msg.timestamp || new Date().toISOString();
    patched[idx] = {
      ...patched[idx],
      last_message_at: now,
      last_message_preview: msg.content?.substring(0, 100) || patched[idx].last_message_preview,
      is_last_message_from_me: msg.is_from_me,
      isLastMessageFromMe: msg.is_from_me,
      ...(msg.is_from_me || isViewing ? {} : { unread_count: (patched[idx].unread_count || 0) + 1 }),
      ...(isViewing ? { unread_count: 0 } : {}),
    };
    patched.sort((a: any, b: any) => {
      const tA = a.last_message_at || a.created_at || '';
      const tB = b.last_message_at || b.created_at || '';
      return tB.localeCompare(tA);
    });
    return { ...old, conversations: patched };
  });
}
