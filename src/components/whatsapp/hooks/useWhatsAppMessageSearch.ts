import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useWhatsAppMessageSearch = (searchQuery: string) => {
  return useQuery({
    queryKey: ['whatsapp-message-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.trim().length < 3) return [];
      const { data, error } = await supabase
        .from('whatsapp_messages' as any)
        .select('conversation_id, content, timestamp')
        .ilike('content', `%${searchQuery.trim()}%`)
        .order('timestamp', { ascending: false })
        .limit(200);
      if (error) throw error;
      const uniqueConversationIds = [...new Set((data as any[]).map((msg: any) => msg.conversation_id))];
      return uniqueConversationIds;
    },
    enabled: searchQuery.trim().length >= 3,
    staleTime: 30000,
  });
};
