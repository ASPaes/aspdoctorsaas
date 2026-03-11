import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
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

const normalizeMessage = (message: Partial<Message> & Record<string, any>): Message => {
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

  // Realtime subscription — append/update messages in cache instead of full refetch
  // Use a unique channel name per hook instance to avoid conflicts when multiple
  // components call this hook with the same conversationId (e.g. ChatAreaFull + ChatMessages)
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 10));

  useEffect(() => {
    if (!conversationId) return;

    const channelName = `messages-rt-${conversationId}-${channelIdRef.current}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const normalizedNewMsg = normalizeMessage(payload.new as any);
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: any[] | undefined) => {
            if (!old) return [normalizedNewMsg];

            // Check for exact id/message_id match OR a temp optimistic entry
            const isTempMatch = (m: any) =>
              m.id?.startsWith?.('temp-') &&
              getIsFromMe(m) === true &&
              m.conversation_id === normalizedNewMsg.conversation_id;

            const isExactMatch = (m: any) =>
              m.id === normalizedNewMsg.id ||
              (normalizedNewMsg.message_id && m.message_id === normalizedNewMsg.message_id);

            const hasMatch = old.some((m) => isExactMatch(m) || isTempMatch(m));

            if (hasMatch) {
              // Replace the first matching entry (temp → real, or exact update)
              let replaced = false;
              return old.map((m) => {
                if (!replaced && (isExactMatch(m) || isTempMatch(m))) {
                  replaced = true;
                  return normalizedNewMsg;
                }
                return m;
              });
            }
            return [...old, normalizedNewMsg];
          }
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const normalizedUpdated = normalizeMessage(payload.new as any);
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: any[] | undefined) => {
            if (!old) return old;
            return old.map((m) => (m.id === normalizedUpdated.id ? normalizedUpdated : m));
          }
        );
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return { messages, isLoading, error };
};
