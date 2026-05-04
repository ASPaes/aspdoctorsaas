import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MetaWindowState {
  isMeta: boolean;
  windowOpen: boolean;
  requiresTemplate: boolean;
  lastInboundAt: string | null;
  hoursRemaining: number | null;
  instanceId: string | null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function useMetaWindow(conversationId: string | null | undefined) {
  return useQuery<MetaWindowState>({
    queryKey: ['meta-window', conversationId],
    enabled: !!conversationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: conv, error: convErr } = await supabase
        .from('whatsapp_conversations')
        .select('id, instance_id, whatsapp_instances!inner(provider_type)')
        .eq('id', conversationId!)
        .single();
      if (convErr) throw convErr;

      const providerType = (conv as any)?.whatsapp_instances?.provider_type;
      const isMeta = providerType === 'meta_cloud';

      if (!isMeta) {
        return {
          isMeta: false,
          windowOpen: true,
          requiresTemplate: false,
          lastInboundAt: null,
          hoursRemaining: null,
          instanceId: conv?.instance_id ?? null,
        };
      }

      const { data: lastInbound } = await supabase
        .from('whatsapp_messages')
        .select('timestamp')
        .eq('conversation_id', conversationId!)
        .eq('is_from_me', false)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastInboundAt = lastInbound?.timestamp ?? null;
      let windowOpen = false;
      let hoursRemaining: number | null = null;

      if (lastInboundAt) {
        const elapsed = Date.now() - new Date(lastInboundAt).getTime();
        if (elapsed < WINDOW_MS) {
          windowOpen = true;
          hoursRemaining = Math.max(0, (WINDOW_MS - elapsed) / (60 * 60 * 1000));
        }
      }

      return {
        isMeta: true,
        windowOpen,
        requiresTemplate: !windowOpen,
        lastInboundAt,
        hoursRemaining,
        instanceId: conv?.instance_id ?? null,
      };
    },
  });
}
