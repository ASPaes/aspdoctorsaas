import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { supabase } from '@/integrations/supabase/client';

export function useConversationQueue(
  departmentId: string | null | undefined
): { count: number; isLoading: boolean } {
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();

  const queryKey = ['sector-queue', effectiveTenantId, departmentId ?? 'all'];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: !!effectiveTenantId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase
        .from('support_attendances' as any)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', effectiveTenantId as string)
        .eq('status', 'waiting')
        .is('assigned_to', null);

      if (departmentId) {
        q = q.eq('department_id', departmentId);
      }

      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!effectiveTenantId) return;

    const channel = supabase
      .channel(
        'sector-queue-' +
          (effectiveTenantId || 'none') +
          '-' +
          (departmentId || 'all')
      )
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'support_attendances',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTenantId, departmentId, queryClient]);

  return {
    count: data ?? 0,
    isLoading,
  };
}
