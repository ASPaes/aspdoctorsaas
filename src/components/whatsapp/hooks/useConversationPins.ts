import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { useAuth } from '@/contexts/AuthContext';
import type { ConversationWithContact } from './useWhatsAppConversations';

export const MAX_PINNED_CONVERSATIONS = 5;

export type PinnedConversation = ConversationWithContact & { pinned_at: string };

// ---------------------------------------------------------------------------
// DEM-0491 — conversas fixadas no topo da lista, POR USUÁRIO
// ---------------------------------------------------------------------------
//
// As fixadas vêm por RPC própria (whatsapp_list_pinned_conversations), não pela
// lista paginada: whatsapp_list_conversations só força por id conversa SEM
// mensagem, então uma fixada que caiu para a página 3 nunca subiria. São no
// máximo 5 linhas, por PK.
//
// A chave fica debaixo de ['whatsapp', 'conversations'] de propósito: toda
// invalidação que o Realtime faz na lista (mensagem nova, troca de bucket)
// atualiza as fixadas junto, sem canal próprio.
export function useConversationPins() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['whatsapp', 'conversations', 'pinned', tid, uid], [tid, uid]);

  const { data: pinned = [] } = useQuery({
    queryKey,
    enabled: !!tid && !!uid,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PinnedConversation[]> => {
      const { data, error } = await (supabase as any).rpc('whatsapp_list_pinned_conversations', {
        p_tenant_id: tid,
      });
      // Frontend publicado antes do SQL: sem fixadas, mas o chat segue de pé.
      if (error) {
        if (error.code !== 'PGRST202') console.warn('[DEM-0491] fixadas:', error.message);
        return [];
      }
      return ((data ?? []) as any[]).map((row) => ({
        ...row.conversation,
        contact: row.contact,
        bucket: row.bucket,
        pinned_at: row.pinned_at,
        unread_count: parseInt(String(row.conversation?.unread_count ?? 0), 10) || 0,
        last_message_at: row.conversation?.last_message_at || null,
        isLastMessageFromMe: row.conversation?.is_last_message_from_me ?? false,
      })) as PinnedConversation[];
    },
  });

  const pinnedAt = useMemo(
    () => new Map(pinned.map((c) => [c.id, c.pinned_at])),
    [pinned]
  );

  const togglePin = useCallback(async (conv: ConversationWithContact) => {
    if (!uid || !tid) return;
    const table = supabase.from('whatsapp_conversation_pins' as any) as any;
    const wasPinned = pinnedAt.has(conv.id);

    if (!wasPinned && pinnedAt.size >= MAX_PINNED_CONVERSATIONS) {
      toast.error(`Você já tem ${MAX_PINNED_CONVERSATIONS} conversas fixadas. Desafixe uma para fixar esta.`);
      return;
    }

    // Otimista: o alfinete responde no clique, o servidor confirma depois.
    const previous = queryClient.getQueryData<PinnedConversation[]>(queryKey);
    queryClient.setQueryData<PinnedConversation[]>(queryKey, (old = []) =>
      wasPinned
        ? old.filter((c) => c.id !== conv.id)
        : [{ ...conv, pinned_at: new Date().toISOString() }, ...old]
    );

    const { error } = wasPinned
      ? await table.delete().eq('user_id', uid).eq('conversation_id', conv.id)
      : await table.insert({ user_id: uid, conversation_id: conv.id, tenant_id: conv.tenant_id });

    if (error) {
      queryClient.setQueryData(queryKey, previous);
      toast.error(
        String(error.message ?? '').includes('LIMITE_FIXADAS')
          ? `Você já tem ${MAX_PINNED_CONVERSATIONS} conversas fixadas. Desafixe uma para fixar esta.`
          : wasPinned ? 'Não foi possível desafixar a conversa' : 'Não foi possível fixar a conversa'
      );
      return;
    }
    toast.success(wasPinned ? 'Conversa desafixada' : 'Conversa fixada no topo');
    queryClient.invalidateQueries({ queryKey });
  }, [uid, tid, pinnedAt, queryClient, queryKey]);

  return { pinned, pinnedAt, togglePin, isFull: pinnedAt.size >= MAX_PINNED_CONVERSATIONS };
}
