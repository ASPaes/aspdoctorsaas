import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSenderMap } from './useSenderMap';

export interface Message {
  id: string;
  conversation_id: string;
  message_id: string;
  remote_jid: string;
  content: string;
  message_type: string;
  media_url: string | null;
  media_mimetype: string | null;
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
  'status',
  'is_from_me',
  'timestamp',
  'quoted_message_id',
  'audio_transcription',
  'transcription_status',
  'sent_by_user_id',
].join(',');

export const useWhatsAppMessages = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const { senderMap } = useSenderMap();

  const { data: rawMessages = [], isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];

      const { data, error } = await supabase
        .from('whatsapp_messages' as any)
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as any[];
    },
    enabled: !!conversationId,
  });

  // Enrich messages with sender info from the shared cache (no extra queries)
  const messages = useMemo(() => {
    if (!rawMessages.length) return [] as Message[];
    return rawMessages.map((m: any) => {
      const sender = m.sent_by_user_id && senderMap[m.sent_by_user_id];
      return {
        ...m,
        metadata: null, // not fetched in lean select
        sender_name: sender ? sender.nome : null,
        sender_role: sender ? sender.cargo : null,
      } as Message;
    });
  }, [rawMessages, senderMap]);

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

  // Realtime subscription for new and edited messages
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages-rt-${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', conversationId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return { messages, isLoading, error };
};
