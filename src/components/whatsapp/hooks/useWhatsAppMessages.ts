import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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

export const useWhatsAppMessages = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];

      const { data, error } = await supabase
        .from('whatsapp_messages' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as Message[];
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

  // Realtime subscription for new and edited messages
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        queryClient.setQueryData(['whatsapp', 'messages', conversationId], (old: Message[] = []) => {
          const exists = old.some(msg => msg.id === (payload.new as any).id);
          if (exists) return old;
          return [...old, payload.new as unknown as Message];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        queryClient.setQueryData(['whatsapp', 'messages', conversationId], (old: Message[] = []) => {
          return old.map(msg =>
            msg.id === (payload.new as any).id ? { ...msg, ...(payload.new as unknown as Message) } : msg
          );
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return { messages, isLoading, error };
};
