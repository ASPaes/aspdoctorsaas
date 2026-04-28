import { useQuery } from '@tanstack/react-query';
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

  return queryResult;
};
