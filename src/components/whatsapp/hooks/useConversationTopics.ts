import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ConversationMetadata {
  topics?: string[];
  primary_topic?: string;
  ai_confidence?: number;
  categorized_at?: string;
  ai_reasoning?: string;
  custom_topics?: string[];
  categorization_model?: string;
}

export const useConversationTopics = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const queryResult = useQuery({
    queryKey: ['conversation-topics', conversationId],
    queryFn: async (): Promise<ConversationMetadata | null> => {
      if (!conversationId) return null;
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();
      if (error) throw error;
      return (data?.metadata as ConversationMetadata) || null;
    },
    enabled: !!conversationId,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`topics-${conversationId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_conversations' }, (payload) => {
        if ((payload.new as any)?.id === conversationId) {
          queryClient.invalidateQueries({ queryKey: ['conversation-topics', conversationId] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return queryResult;
};
