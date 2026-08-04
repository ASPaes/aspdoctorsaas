import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { subscribeSharedChannel } from '@/lib/realtimeChannelPool';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';


export interface ConversationWithContact {
  id: string;
  contact_id: string;
  instance_id: string | null;
  department_id: string | null;
  status: string;
  category: string | null;
  priority: string | null;
  assigned_to: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
  tenant_id: string;
  is_last_message_from_me: boolean;
  auto_reply_disabled?: boolean;
  auto_reply_disabled_at?: string | null;
  auto_reply_disabled_by?: string | null;
  auto_reply_disabled_reason?: string | null;
  opened_out_of_hours?: boolean;
  opened_out_of_hours_at?: string | null;
  sender_signature_mode?: string;
  sender_ticket_code?: string | null;
  /** Bucket calculado NO SERVIDOR por wa_conversation_bucket. Não recalcular no cliente. */
  bucket?: string;
  contact: {
    id: string;
    name: string | null;
    phone_number: string;
    profile_picture_url: string | null;
    notes: string | null;
    instance_id: string;
    is_group: boolean;
    tags: string[] | null;
    tenant_id: string;
    created_at: string;
    updated_at: string;
  };
  isLastMessageFromMe?: boolean;
  sentiment?: { needs_cs_ticket: boolean | null; cs_ticket_created_id: string | null } | null;
}

export interface ConversationsFilters {
  instanceId?: string;
  instanceIds?: string[];
  departmentId?: string;
  isGroup?: boolean;
  /**
   * Pill ativa: 'waiting' | 'in_progress' | 'after_hours' | 'closed'.
   * undefined = todos os buckets. O filtro é aplicado no SERVIDOR — não refazer
   * no cliente, senão a página volta a encolher depois de paginada (DEM-0234).
   */
  bucket?: string;
  status?: string;
  assignedTo?: string;
  unassigned?: boolean;
  unreadOnly?: boolean;
  pageSize?: number;
  includeIds?: string[];
  /**
   * Operador comum: restringe encerradas às que foram dele. Passar undefined
   * para admin/head/super admin. Mesma regra vale na contagem das pills.
   */
  closedVisibleTo?: string;
  autoReplyDisabledOnly?: boolean;
  rulesDisabledOnly?: boolean;
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// useWhatsAppConversations — lista paginada, filtrada por bucket no servidor
// ---------------------------------------------------------------------------
//
// Antes desta versão a lista carregava uma janela fixa das 100 conversas mais
// recentes e a pill era aplicada no navegador. Conversa encerrada fora dessa
// janela virava inalcançável — nenhuma ação da UI trazia ela de volta — enquanto
// a contagem da pill, vinda do servidor sobre o tenant inteiro, seguia mostrando
// o número cheio. Era o DEM-0234 (WAYRA SURF BAR / ADEGA FG, posições 128 e 166).
//
// Agora o bucket e a paginação são do servidor, via whatsapp_list_conversations,
// que compartilha wa_conversation_bucket com whatsapp_pill_counts. Lista e
// contagem saem da mesma expressão e não têm como divergir.
export const useWhatsAppConversations = (filters?: ConversationsFilters) => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const pageSize = filters?.pageSize ?? DEFAULT_PAGE_SIZE;

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['whatsapp', 'conversations', filters, tid],
    initialPageParam: 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage: ConversationWithContact[], allPages) =>
      lastPage.length < pageSize
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
    queryFn: async ({ pageParam }): Promise<ConversationWithContact[]> => {
      const { data: rows, error: rpcError } = await (supabase as any).rpc(
        'whatsapp_list_conversations',
        {
          p_tenant_id: tid,
          p_bucket: filters?.bucket ?? null,
          p_department_id: filters?.departmentId ?? null,
          p_instance_id: filters?.instanceId ?? null,
          p_instance_ids: filters?.instanceIds?.length ? filters.instanceIds : null,
          p_status: filters?.status ?? null,
          p_assigned_to: filters?.assignedTo ?? null,
          p_unassigned: filters?.unassigned ?? false,
          p_unread_only: filters?.unreadOnly ?? false,
          // undefined = grupos e 1:1 juntos (pill "Todos"); false = só 1:1; true = só grupos
          p_is_group: filters?.isGroup === undefined ? null : filters.isGroup,
          p_include_ids: filters?.includeIds?.length ? filters.includeIds : null,
          p_closed_visible_to: filters?.closedVisibleTo ?? null,
          p_auto_reply_disabled_only: filters?.autoReplyDisabledOnly ?? false,
          p_rules_disabled_only: filters?.rulesDisabledOnly ?? false,
          p_limit: pageSize,
          p_offset: pageParam as number,
        }
      );
      if (rpcError) throw rpcError;

      const result = ((rows ?? []) as any[]).map((row) => ({
        ...row.conversation,
        contact: row.contact,
        bucket: row.bucket,
        unread_count: parseInt(String(row.conversation?.unread_count ?? 0), 10) || 0,
        last_message_at: row.conversation?.last_message_at || null,
        isLastMessageFromMe: row.conversation?.is_last_message_from_me ?? false,
      })) as ConversationWithContact[];

      const ids = result.map((c) => c.id);
      if (ids.length === 0) return result;

      const { data: sData } = await (supabase.from('whatsapp_sentiment_analysis' as any) as any)
        .select('conversation_id, needs_cs_ticket, cs_ticket_created_id')
        .in('conversation_id', ids);
      const sentimentMap = new Map((sData ?? []).map((s: any) => [s.conversation_id, s]));
      return result.map((c) => ({ ...c, sentiment: (sentimentMap.get(c.id) as any) ?? null }));
    },
    enabled: !!tid,
  });

  const conversations = useMemo(
    () => (data?.pages ?? []).flat() as ConversationWithContact[],
    [data]
  );

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Realtime: canal compartilhado com ref-count para não colidir entre montagens
  useEffect(() => {
    const channelName = `conversations-rt-${tid ?? 'none'}`;
    return subscribeSharedChannel(channelName, (channel) => {
      let pillCountsTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidatePillCounts = () => {
        if (pillCountsTimer) clearTimeout(pillCountsTimer);
        pillCountsTimer = setTimeout(() => {
          pillCountsTimer = null;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'pill-counts'] });
        }, 1000);
      };

      // Refetch da lista coalescido. Com paginação no servidor um refetch refaz
      // todas as páginas carregadas, então a janela de coalescing importa mais
      // do que antes — nada de invalidar por evento.
      let listRefetchTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidateList = () => {
        if (listRefetchTimer) return;
        listRefetchTimer = setTimeout(() => {
          listRefetchTimer = null;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
        }, 2000);
      };

      channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        const updated = payload.new as any;
        invalidatePillCounts();
        if (updated?.is_group === true) {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'group-counts'] });
        }

        queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
          if (!old?.pages) return old;

          let existing: any = null;
          for (const page of old.pages) {
            const hit = page.find((c: any) => c.id === updated.id);
            if (hit) { existing = hit; break; }
          }

          // Fora das páginas carregadas: pode ter entrado no bucket ativo agora.
          if (!existing) { invalidateList(); return old; }

          // assigned_to / department_id / status mudaram → o bucket ou a
          // elegibilidade podem ter mudado, e isso é decisão do servidor.
          if (
            existing.assigned_to !== updated.assigned_to ||
            existing.department_id !== updated.department_id ||
            existing.status !== updated.status
          ) {
            invalidateList();
            return old;
          }

          // Patch normal. A ordenação final é do consumidor (sortBy da sidebar).
          return {
            ...old,
            pages: old.pages.map((page: any[]) => {
              const idx = page.findIndex((c: any) => c.id === updated.id);
              if (idx === -1) return page;
              const patched = [...page];
              patched[idx] = {
                ...patched[idx],
                ...updated,
                unread_count:
                  parseInt(String(updated.unread_count ?? patched[idx].unread_count ?? 0), 10) || 0,
              };
              return patched;
            }),
          };
        });
      });

      channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        const inserted = payload.new as any;
        invalidatePillCounts();
        if (inserted?.is_group === true) {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'group-counts'] });
        }
        invalidateList();
      });

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_sentiment_analysis',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      } as any, () => {
        invalidateList();
      });

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'support_attendances',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      } as any, () => {
        invalidatePillCounts();
        // Abrir/fechar/assumir atendimento move a conversa de bucket, e o bucket
        // agora é filtro do servidor — sem isto ela ficaria na pill errada até o
        // refetch de 60s.
        invalidateList();
      });
    });
  }, [queryClient, tid]);

  return {
    conversations,
    isLoading,
    error,
    loadMore,
    hasMore: !!hasNextPage,
    isLoadingMore: isFetchingNextPage,
  };
};
