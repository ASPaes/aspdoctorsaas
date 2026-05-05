import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RelevantAttendance {
  attendanceId: string | null;
  isClosed: boolean;
  isLoading: boolean;
}

const CLOSED_STATUSES = ['closed', 'inactive_closed'];

/**
 * Retorna o atendimento "relevante" para a conversa:
 *  - Se houver atendimento ativo (status NOT IN closed/inactive_closed) → retorna o mais recente
 *  - Senão → retorna o último encerrado
 *  - Senão → null
 *
 * O flag isClosed informa se o que foi retornado está encerrado (read-only para não-admins).
 */
export const useRelevantAttendance = (conversationId: string | null): RelevantAttendance => {
  const query = useQuery({
    queryKey: ['relevant-attendance', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;

      // 1. Tenta achar atendimento ativo
      const { data: active, error: activeErr } = await supabase
        .from('support_attendances')
        .select('id, status')
        .eq('conversation_id', conversationId)
        .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeErr) throw activeErr;
      if (active) return { id: active.id, isClosed: false };

      // 2. Senão, pega o mais recente fechado
      const { data: lastClosed, error: closedErr } = await supabase
        .from('support_attendances')
        .select('id, status')
        .eq('conversation_id', conversationId)
        .in('status', CLOSED_STATUSES)
        .order('closed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (closedErr) throw closedErr;
      if (lastClosed) return { id: lastClosed.id, isClosed: true };

      return null;
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  });

  return {
    attendanceId: query.data?.id ?? null,
    isClosed: query.data?.isClosed ?? false,
    isLoading: query.isLoading,
  };
};
