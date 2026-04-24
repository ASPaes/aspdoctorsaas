import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportConfig } from '@/hooks/useSupportConfig';
import { supabase } from '@/integrations/supabase/client';

export interface AgentAvailability {
  current: number;
  limit: number | null;
  ratio: number;
  status: 'ok' | 'warn' | 'full' | 'unlimited';
  isEnabled: boolean;
  isLoading: boolean;
}

export function useAgentAvailability(): AgentAvailability {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: supportConfig } = useSupportConfig();

  const distributionEnabled =
    (supportConfig as any)?.distribution_enabled_globally === true;

  const { data, isLoading } = useQuery({
    queryKey: ['agent-availability', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [currentRes, limitRes] = await Promise.all([
        supabase.rpc('fn_current_chat_count' as any, { p_user_id: user!.id }),
        supabase.rpc('fn_effective_chat_limit' as any, { p_user_id: user!.id }),
      ]);

      if (currentRes.error) throw currentRes.error;
      if (limitRes.error) throw limitRes.error;

      const current = Number(currentRes.data ?? 0);
      const rawLimit = limitRes.data;
      const limit: number | null =
        rawLimit === null || rawLimit === undefined ? null : Number(rawLimit);

      return { current, limit };
    },
  });

  // Realtime invalidation
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('agent-availability-' + user.id)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'support_attendances',
          filter: `assigned_to=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['agent-availability', user.id],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const current = data?.current ?? 0;
  const limit = data?.limit ?? null;

  let status: AgentAvailability['status'];
  let ratio: number;

  if (limit == null) {
    status = 'unlimited';
    ratio = 0;
  } else {
    ratio = limit > 0 ? current / limit : 0;
    if (current >= limit) status = 'full';
    else if (ratio >= 0.7) status = 'warn';
    else status = 'ok';
  }

  const isEnabled = distributionEnabled || limit !== null;

  return {
    current,
    limit,
    ratio,
    status,
    isEnabled,
    isLoading,
  };
}
