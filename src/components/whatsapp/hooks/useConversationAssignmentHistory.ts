import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSenderMap } from './useSenderMap';
import { useMemo } from 'react';

export interface AssignmentEvent {
  id: string;
  conversation_id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  reason: string | null;
  created_at: string;
  agent_name: string | null;
  agent_role: string | null;
}

export const useConversationAssignmentHistory = (conversationId: string | null) => {
  const { senderMap } = useSenderMap();

  const { data: rawAssignments, isLoading, error } = useQuery({
    queryKey: ['conversation-assignment-history', conversationId],
    queryFn: async (): Promise<any[]> => {
      if (!conversationId) return [];

      const { data, error } = await supabase
        .from('conversation_assignments')
        .select('id, conversation_id, assigned_to, assigned_by, reason, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!conversationId,
  });

  // Enrich with sender names from shared cache — zero extra queries
  const data = useMemo((): AssignmentEvent[] => {
    if (!rawAssignments) return [];
    return rawAssignments.map((a: any) => {
      const sender = a.assigned_to && senderMap[a.assigned_to];
      return {
        id: a.id,
        conversation_id: a.conversation_id,
        assigned_to: a.assigned_to,
        assigned_by: a.assigned_by,
        reason: a.reason,
        created_at: a.created_at,
        agent_name: sender ? sender.nome : null,
        agent_role: sender ? sender.cargo : null,
      };
    });
  }, [rawAssignments, senderMap]);

  return { data, isLoading, error };
};
