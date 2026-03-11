import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  timestamp: string;
  quoted_message_id: string | null;
  metadata: Record<string, any> | null;
  audio_transcription: string | null;
  transcription_status: string | null;
  sent_by_user_id: string | null;
  sender_name: string | null;
  sender_role: string | null;
  instance_id: string | null;
}

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
      return ((data ?? []) as unknown as Message[]).map((m) => ({
        ...m,
        metadata: null, // not fetched in lean select
      }));
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
        const newMsg = payload.new as any;
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: any[] | undefined) => {
            if (!old) return [newMsg];

            // Check for exact id/message_id match OR a temp optimistic entry
            const isTempMatch = (m: any) =>
              m.id.startsWith?.('temp-') &&
              m.is_from_me === true &&
              m.conversation_id === newMsg.conversation_id;

            const isExactMatch = (m: any) =>
              m.id === newMsg.id ||
              (newMsg.message_id && m.message_id === newMsg.message_id);

            const hasMatch = old.some((m) => isExactMatch(m) || isTempMatch(m));

            if (hasMatch) {
              // Replace the first matching entry (temp → real, or exact update)
              let replaced = false;
              return old.map((m) => {
                if (!replaced && (isExactMatch(m) || isTempMatch(m))) {
                  replaced = true;
                  return newMsg;
                }
                return m;
              });
            }
            return [...old, newMsg];
          }
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const updated = payload.new as any;
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: any[] | undefined) => {
            if (!old) return old;
            return old.map((m) => m.id === updated.id ? updated : m);
          }
        );
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return { messages, isLoading, error };
};
