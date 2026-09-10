import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSenderMap } from './useSenderMap';
import { useMemo } from 'react';

/**
 * Nem toda linha de `conversation_assignments` e uma transferencia:
 *  - `auto`              distribuicao automatica (assigned_by NULL)
 *  - `claim`             o proprio agente assumiu (reason "Assumido manualmente")
 *  - `department`        troca de setor (assigned_to NULL — o setor destino nao e gravado)
 *  - `transfer`          agente A passou para o agente B
 *  - `transfer_unknown`  transferencia anterior a 10/09/2026, quando a RPC gravava o
 *                        autor nas duas colunas: o destinatario se perdeu.
 */
export type AssignmentKind = 'auto' | 'claim' | 'department' | 'transfer' | 'transfer_unknown';

export interface AssignmentEvent {
  id: string;
  conversation_id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  reason: string | null;
  created_at: string;
  kind: AssignmentKind;
  agent_name: string | null;
  agent_role: string | null;
  by_name: string | null;
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
      const author = a.assigned_by && senderMap[a.assigned_by];
      const isClaim = (a.reason ?? '').toLowerCase().startsWith('assumido manualmente');

      let kind: AssignmentKind;
      if (!a.assigned_by) kind = 'auto';
      else if (!a.assigned_to) kind = 'department';
      else if (isClaim) kind = 'claim';
      else if (a.assigned_to === a.assigned_by) kind = 'transfer_unknown';
      else kind = 'transfer';

      return {
        id: a.id,
        conversation_id: a.conversation_id,
        assigned_to: a.assigned_to,
        assigned_by: a.assigned_by,
        reason: a.reason,
        created_at: a.created_at,
        kind,
        agent_name: sender ? sender.nome : null,
        agent_role: sender ? sender.cargo : null,
        by_name: author ? author.nome : null,
      };
    });
  }, [rawAssignments, senderMap]);

  return { data, isLoading, error };
};
