import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
  return useQuery({
    queryKey: ['conversation-assignment-history', conversationId],
    queryFn: async (): Promise<AssignmentEvent[]> => {
      if (!conversationId) return [];

      const { data, error } = await supabase
        .from('conversation_assignments')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const assignments = (data ?? []) as any[];

      // Resolve agent names
      const userIds = [...new Set(assignments.filter(a => a.assigned_to).map(a => a.assigned_to))];
      let nameMap: Record<string, { nome: string; cargo: string | null }> = {};

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, funcionario_id')
          .in('user_id', userIds);

        if (profiles && profiles.length > 0) {
          const funcIds = profiles.filter((p: any) => p.funcionario_id).map((p: any) => p.funcionario_id);
          if (funcIds.length > 0) {
            const { data: funcs } = await supabase
              .from('funcionarios')
              .select('id, nome, cargo')
              .in('id', funcIds);

            const funcMap: Record<number, { nome: string; cargo: string | null }> = {};
            (funcs ?? []).forEach((f: any) => { funcMap[f.id] = { nome: f.nome, cargo: f.cargo }; });

            (profiles as any[]).forEach(p => {
              if (p.funcionario_id && funcMap[p.funcionario_id]) {
                nameMap[p.user_id] = funcMap[p.funcionario_id];
              }
            });
          }
        }
      }

      return assignments.map(a => ({
        id: a.id,
        conversation_id: a.conversation_id,
        assigned_to: a.assigned_to,
        assigned_by: a.assigned_by,
        reason: a.reason,
        created_at: a.created_at,
        agent_name: a.assigned_to && nameMap[a.assigned_to] ? nameMap[a.assigned_to].nome : null,
        agent_role: a.assigned_to && nameMap[a.assigned_to] ? nameMap[a.assigned_to].cargo : null,
      }));
    },
    enabled: !!conversationId,
  });
};
