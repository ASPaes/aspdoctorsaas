import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  quoted_message_id: string | null;
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
  return (
    message.message_type ??
    message.messageType ??
    message.type ??
    'text'
  );
};

const getIsFromMe = (message: Partial<Message> & Record<string, any>): boolean => {
  return Boolean(
    message.is_from_me ??
      message.isFromMe ??
      message.fromMe ??
      message.key?.fromMe ??
      message.key?.from_me ??
      false
  );
};

const getIsSystem = (message: Partial<Message> & Record<string, any>, rawType: string): boolean => {
  return Boolean(
    rawType === 'system' ||
      rawType === 'event' ||
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

// Lean select — only fields the UI needs
const MESSAGE_SELECT = [
  'id',
  'conversation_id',
  'message_id',
  'remote_jid',
  'content',
  'message_type',
  'media_url',
  'media_mimetype',
  'media_path',
  'media_filename',
  'media_ext',
  'media_size_bytes',
  'media_kind',
  'status',
  'is_from_me',
  'timestamp',
  'quoted_message_id',
  'metadata',
  'audio_transcription',
  'transcription_status',
  'sent_by_user_id',
  'instance_id',
  'sender_name',
  'sender_role',
  'delete_status',
  'delete_scope',
  'delete_error',
].join(',');

/**
 * Deduplicate and merge a new message into an existing list.
 * Replaces temp optimistic messages or exact ID/message_id matches.
 * Returns the new array (or the old one if nothing changed).
 */
export function mergeMessage(old: Message[], incoming: Message): Message[] {
  // Try to find an exact match by real id or message_id
  const exactIdx = old.findIndex(
    (m) =>
      m.id === incoming.id ||
      (incoming.message_id && m.message_id === incoming.message_id)
  );
  if (exactIdx !== -1) {
    const updated = [...old];
    updated[exactIdx] = incoming;
    return updated;
  }

  // Try to replace the OLDEST temp message for this conversation (FIFO reconciliation)
  const tempIdx = old.findIndex(
    (m) =>
      m.id?.startsWith?.('temp-') &&
      m.conversation_id === incoming.conversation_id
  );
  if (tempIdx !== -1) {
    const updated = [...old];
    updated[tempIdx] = incoming;
    return updated;
  }

  // No match — append
  return [...old, incoming];
}

export const useWhatsAppMessages = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const { data: messages = [] as Message[], isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];

      const { data, error } = await supabase
        .from('whatsapp_messages' as any)
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Array<Partial<Message> & Record<string, any>>).map(normalizeMessage);
    },
    enabled: !!conversationId,
  });

  // Mark conversation as read when opened
  useEffect(() => {
    if (conversationId) {
      supabase
        .from('whatsapp_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .then();
    }
  }, [conversationId]);

  // ── Realtime: single channel with filtered subscription ──
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Notify callback for new messages (used by ChatMessages for smart scroll)
  const newMessageCallbackRef = useRef<((msg: Message) => void) | null>(null);
  const onNewMessage = useCallback((cb: (msg: Message) => void) => {
    newMessageCallbackRef.current = cb;
  }, []);

  // Track last invalidation for fallback throttle
  const lastInvalidateRef = useRef(0);

  useEffect(() => {
    if (!conversationId) return;

    const uid = channelIdRef.current;
    const channelName = `msgs-${conversationId.slice(0, 8)}-${uid}`;

    if (import.meta.env.DEV) {
      console.log(`[realtime] subscribing messages conversationId=${conversationId}`);
    }

    const channel = supabase
      .channel(channelName)
      // PRIMARY: filtered INSERT on whatsapp_messages
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const incoming = normalizeMessage(payload.new as any);
        if (import.meta.env.DEV) {
          console.log(`[realtime] new message id=${incoming.id} conv=${conversationId}`);
        }
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: Message[] | undefined) => mergeMessage(old ?? [], incoming)
        );
        newMessageCallbackRef.current?.(incoming);
        patchConversationPreview(queryClient, conversationId, incoming);
      })
      // PRIMARY: filtered UPDATE on whatsapp_messages
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const updated = normalizeMessage(payload.new as any);
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: Message[] | undefined) => {
            if (!old) return old;
            return old.map((m) => (m.id === updated.id ? updated : m));
          }
        );
      })
      // FALLBACK: conversation update → invalidate messages if realtime INSERT was missed
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: `id=eq.${conversationId}`,
      }, () => {
        const now = Date.now();
        if (now - lastInvalidateRef.current > 2000) {
          lastInvalidateRef.current = now;
          if (import.meta.env.DEV) {
            console.log(`[realtime] fallback refetch conv=${conversationId}`);
          }
          queryClient.invalidateQueries({
            queryKey: ['whatsapp', 'messages', conversationId],
          });
        }
      })
      .subscribe((status) => {
        if (import.meta.env.DEV) {
          console.log(`[realtime] channel ${channelName} status: ${status}`);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[realtime] channel ${channelName} failed (${status}). Scheduling retry...`);
          retryCountRef.current += 1;
          if (retryCountRef.current <= 3) {
            const delay = retryCountRef.current * 3000;
            setTimeout(() => {
              if (!mountedRef.current) return;
              supabase.removeChannel(channel);
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', conversationId] });
            }, delay);
          }
        }
        if (status === 'SUBSCRIBED') {
          retryCountRef.current = 0;
        }
      });

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  // ── Independent fallback: separate channel on whatsapp_conversations ──
  // If the messages channel fails (CHANNEL_ERROR), this still works because
  // the sidebar's conversation updates use a simpler subscription that succeeds.
  const fallbackUidRef = useRef(Math.random().toString(36).slice(2, 10));
  const lastFallbackRef = useRef(0);

  useEffect(() => {
    if (!conversationId) return;

    const fbChannel = supabase
      .channel(`msgs-fb-${conversationId.slice(0, 8)}-${fallbackUidRef.current}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: `id=eq.${conversationId}`,
      }, () => {
        const now = Date.now();
        if (now - lastFallbackRef.current > 3000) {
          lastFallbackRef.current = now;
          if (import.meta.env.DEV) {
            console.log(`[realtime] independent fallback refetch conv=${conversationId}`);
          }
          queryClient.invalidateQueries({
            queryKey: ['whatsapp', 'messages', conversationId],
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(fbChannel); };
  }, [conversationId, queryClient]);

  return { messages, isLoading, error, onNewMessage };
};

/**
 * Lightweight helper to patch a conversation's preview/ordering in the sidebar cache
 * without triggering a full refetch. Called when a message INSERT arrives.
 */
function patchConversationPreview(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  msg: Message
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
      // Increment unread for non-from-me messages (unless this is the open conversation — handled by read marker)
      ...(msg.is_from_me ? {} : { unread_count: (patched[idx].unread_count || 0) + 1 }),
    };

    // Re-sort by most recent activity
    patched.sort((a: any, b: any) => {
      const tA = a.last_message_at || a.created_at || '';
      const tB = b.last_message_at || b.created_at || '';
      return tB.localeCompare(tA);
    });

    return { ...old, conversations: patched };
  });
}
