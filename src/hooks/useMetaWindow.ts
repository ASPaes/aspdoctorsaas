import { useQuery, type QueryClient } from '@tanstack/react-query';
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

export const metaWindowQueryKey = (conversationId: string | null | undefined) =>
  ['meta-window', conversationId] as const;

// Abre a janela de 24h no MESMO instante em que a mensagem do cliente aparece no
// chat, em vez de esperar o proximo ciclo de 60s do refetch.
//
// O atendente via a resposta chegar e continuava com o campo travado em "Janela
// de 24h fechada" por ate um minuto; so o F5 adiantava. Quem sabe primeiro que a
// janela abriu e o Realtime, entao e ele quem tem que contar.
//
// Patch de cache e nao invalidate: invalidar refaria as duas consultas (conversa
// + ultima inbound) so para descobrir o que a mensagem recebida ja diz, e o campo
// continuaria travado ate a ida ao banco voltar.
//
// O criterio aqui e o mesmo do queryFn (is_from_me = false, sem filtro de tipo)
// de proposito: divergir faria o campo destravar e travar de novo assim que o
// refetch seguinte chegasse.
export function patchMetaWindowFromInbound(
  queryClient: QueryClient,
  conversationId: string | null | undefined,
  inboundAt: string | null | undefined,
) {
  if (!conversationId || !inboundAt) return;
  const inboundMs = new Date(inboundAt).getTime();
  if (!Number.isFinite(inboundMs)) return;

  queryClient.setQueryData<MetaWindowState>(
    metaWindowQueryKey(conversationId),
    (prev) => {
      // Sem cache ainda, ou instancia que nao e Meta: nada a destravar. Devolver
      // prev (inclusive undefined) faz o setQueryData desistir sem escrever.
      if (!prev || !prev.isMeta) return prev;

      const knownMs = prev.lastInboundAt ? new Date(prev.lastInboundAt).getTime() : -Infinity;
      if (!(inboundMs > knownMs)) return prev; // mais velha que a inbound ja conhecida

      const elapsed = Date.now() - inboundMs;
      if (elapsed >= WINDOW_MS) return prev; // historico antigo chegando pelo catch-up

      return {
        ...prev,
        windowOpen: true,
        requiresTemplate: false,
        lastInboundAt: inboundAt,
        hoursRemaining: Math.max(0, (WINDOW_MS - elapsed) / (60 * 60 * 1000)),
      };
    },
  );
}

export function useMetaWindow(conversationId: string | null | undefined) {
  return useQuery<MetaWindowState>({
    queryKey: metaWindowQueryKey(conversationId),
    enabled: !!conversationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: conv, error: convErr } = await supabase
        .from('whatsapp_conversations')
        .select('id, instance_id, whatsapp_instances!whatsapp_conversations_instance_id_fkey(provider_type)')
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
