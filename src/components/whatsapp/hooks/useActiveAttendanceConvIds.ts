import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { fetchAllRows } from '@/lib/supabasePaginate';

export function useActiveAttendanceConvIds() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ['whatsapp', 'active-attendance-conv-ids', tid],
    enabled: !!tid,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const rows = await fetchAllRows<{ conversation_id: string }>(() =>
        (supabase.from('support_attendances' as any) as any)
          .select('conversation_id')
          .eq('tenant_id', tid)
          .in('status', ['waiting', 'in_progress'])
      );

      return [...new Set((rows ?? []).map((r) => r.conversation_id).filter(Boolean))].sort();
    },
  });
}
