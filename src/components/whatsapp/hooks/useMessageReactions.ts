import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Reaction {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id: string;
  emoji: string;
  reactor_jid: string;
  is_from_me: boolean;
  created_at: string;
}

export const useMessageReactions = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const { data: reactions = [], isLoading } = useQuery({
    queryKey: ['whatsapp', 'reactions', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from('whatsapp_reactions' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Reaction[];
    },
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`reactions-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_reactions', filter: `conversation_id=eq.${conversationId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'reactions', conversationId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  const reactionsByMessage = useMemo(() => {
    const grouped: Record<string, Reaction[]> = {};
    reactions.forEach(r => {
      if (!grouped[r.message_id]) grouped[r.message_id] = [];
      grouped[r.message_id].push(r);
    });
    return grouped;
  }, [reactions]);

  return { reactions, reactionsByMessage, isLoading };
};
