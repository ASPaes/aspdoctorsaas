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

      // Fetch messages
      const { data, error } = await supabase
        .from('whatsapp_messages' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      const messages = (data ?? []) as unknown as any[];

      // Collect unique sent_by_user_ids to resolve sender names
      const userIds = [...new Set(messages.filter(m => m.sent_by_user_id).map(m => m.sent_by_user_id))];
      let senderMap: Record<string, { nome: string; cargo: string | null }> = {};

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, funcionario_id')
          .in('user_id', userIds);

        if (profiles && profiles.length > 0) {
          const funcIds = profiles.filter(p => p.funcionario_id).map(p => p.funcionario_id);
          if (funcIds.length > 0) {
            const { data: funcs } = await supabase
              .from('funcionarios')
              .select('id, nome, cargo')
              .in('id', funcIds);

            const funcMap: Record<number, { nome: string; cargo: string | null }> = {};
            (funcs ?? []).forEach((f: any) => { funcMap[f.id] = { nome: f.nome, cargo: f.cargo }; });

            (profiles as any[]).forEach(p => {
              if (p.funcionario_id && funcMap[p.funcionario_id]) {
                senderMap[p.user_id] = funcMap[p.funcionario_id];
              }
            });
          }
        }
      }

      return messages.map(m => ({
        ...m,
        sender_name: m.sent_by_user_id && senderMap[m.sent_by_user_id]
          ? senderMap[m.sent_by_user_id].nome
          : null,
        sender_role: m.sent_by_user_id && senderMap[m.sent_by_user_id]
          ? senderMap[m.sent_by_user_id].cargo
          : null,
      })) as Message[];
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
