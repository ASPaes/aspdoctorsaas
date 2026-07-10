import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
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
  
  status?: string;
  assignedTo?: string;
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
  includeIds?: string[];
}

export interface ConversationsResult {
  conversations: ConversationWithContact[];
  totalCount: number;
  totalPages: number;
  unreadCount: number;
  waitingCount: number;
}

// ---------------------------------------------------------------------------
// Helper: build Supabase filter chains reused by both hooks
// ---------------------------------------------------------------------------

function applyBaseFilter(q: any, tid: string | null, filters?: ConversationsFilters) {
  if (tid) q = q.eq('tenant_id', tid);
  if (filters?.departmentId) {
    q = q.or(`department_id.eq.${filters.departmentId},department_id.is.null`);
  } else if (filters?.instanceIds && filters.instanceIds.length > 0) {
    q = q.in('instance_id', filters.instanceIds);
  } else if (filters?.instanceId) {
    q = q.eq('instance_id', filters.instanceId);
  }
  return q;
}

function applyFullFilter(q: any, tid: string | null, filters?: ConversationsFilters) {
  q = applyBaseFilter(q, tid, filters);
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.assignedTo) {
    // Filtra conversas atribuídas ao operador OU grupos monitorados por ele.
    // A fila (assigned_to IS NULL) é visível pela pill "Fila" sem necessidade
    // de incluir aqui — o hook carrega a fila via query sem filtro de operador.
    q = q.or(`assigned_to.eq.${filters.assignedTo},monitor_user_id.eq.${filters.assignedTo}`);
  }
  if (filters?.unassigned) q = q.is('assigned_to', null);
  if (filters?.isGroup === true) q = q.eq('is_group', true).eq('group_enabled', true);
  if (filters?.isGroup === false) q = q.eq('is_group', false);
  return q;
}

// ---------------------------------------------------------------------------
// useConversationCounts — separate hook with its own cache key & staleTime
// ---------------------------------------------------------------------------

export function useConversationCounts(filters?: ConversationsFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ['whatsapp', 'conversation-counts', filters, tid],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [countResult, unreadResult, waitingResult] = await Promise.all([
        applyFullFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true }),
          tid,
          filters,
        ),
        applyBaseFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
            .gt('unread_count', 0),
          tid,
          filters,
        ),
        applyBaseFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .eq('is_last_message_from_me', false)
            .not('last_message_at', 'is', null),
          tid,
          filters,
        ),
      ]);

      return {
        totalCount: countResult.count || 0,
        unreadCount: unreadResult.count || 0,
        waitingCount: waitingResult.count || 0,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// useWhatsAppConversations — main hook (conversations list only)
// ---------------------------------------------------------------------------

export const useWhatsAppConversations = (filters?: ConversationsFilters) => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const page = filters?.page || 1;
  const pageSize = filters?.pageSize || (filters?.isGroup ? 100 : 20);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Counts from the dedicated hook
  const { data: countsData } = useConversationCounts(filters);
  const totalCount = countsData?.totalCount || 0;
  const unreadCount = countsData?.unreadCount || 0;
  const waitingCount = countsData?.waitingCount || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    const markActivity = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('keydown', markActivity, { passive: true });
    window.addEventListener('mousedown', markActivity, { passive: true });
    return () => {
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('mousedown', markActivity);
    };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'conversations', filters, tid],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let query = supabase
        .from('whatsapp_conversations')
        .select(`*, contact:whatsapp_contacts(*)`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      query = applyFullFilter(query, tid, filters);

      // NÃO usar `.or(... id.in ...)` aqui: o OR anula o índice ordenado
      // idx_wa_conv_tenant_lastmsg_active e força varrer+ordenar TODAS as conversas
      // da tenant. Grupos mostram tudo; demais só com last_message_at preenchido.
      if (!filters?.isGroup) {
        query = query.not('last_message_at', 'is', null);
      }

      const { data: conversationsData, error } = await query;
      if (error) throw error;

      // Conversas "forçadas" (ex.: recém-criadas, ainda sem last_message_at) não entram
      // no filtro acima. Busca-as à parte por PK (lookup barato) e mescla no topo. Só
      // dispara enquanto a conversa não tem mensagem — depois ela entra na query principal.
      let rawConversations = (conversationsData ?? []) as any[];
      const includeIds = filters?.includeIds;
      if (!filters?.isGroup && includeIds && includeIds.length > 0) {
        const presentIds = new Set(rawConversations.map((c: any) => c.id));
        const missingIds = includeIds.filter((id) => !presentIds.has(id));
        if (missingIds.length > 0) {
          let forcedQuery = (supabase
            .from('whatsapp_conversations')
            .select(`*, contact:whatsapp_contacts(*)`)
            .in('id', missingIds)) as any;
          if (tid) forcedQuery = forcedQuery.eq('tenant_id', tid);
          const { data: forcedData } = await forcedQuery;
          if (forcedData && forcedData.length > 0) {
            rawConversations = [...forcedData, ...rawConversations];
          }
        }
      }

      const result = (rawConversations as unknown as ConversationWithContact[]).map(conv => ({

        ...conv,
        unread_count: parseInt(String((conv as any).unread_count ?? 0), 10) || 0,
        last_message_at: conv.last_message_at || null,
        isLastMessageFromMe: (conv as any).is_last_message_from_me ?? false,
      }));

      const ids = result.map(c => c.id);
      let withSentiment = result;
      if (ids.length > 0) {
        const { data: sData } = await (supabase.from('whatsapp_sentiment_analysis' as any) as any)
          .select('conversation_id, needs_cs_ticket, cs_ticket_created_id')
          .in('conversation_id', ids);
        const sentimentMap = new Map((sData ?? []).map((s: any) => [s.conversation_id, s]));
        withSentiment = result.map(c => ({ ...c, sentiment: (sentimentMap.get(c.id) as any) ?? null }));
      }

      return { conversations: withSentiment };
    },
  });

  // Realtime: shared channel with ref-count to avoid collision across multiple mounts

  useEffect(() => {
    const channelName = `conversations-rt-${tid ?? 'none'}`;
    return subscribeSharedChannel(channelName, (channel) => {
      let invalidateThrottle = 0;
      let insertDebounce: ReturnType<typeof setTimeout> | null = null;
      let softRefetchTimer: ReturnType<typeof setTimeout> | null = null;

      channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        const updated = payload.new as any;
        // Grupos têm seu próprio badge na pill "Grupos" (query separada).
        // Invalidar group-counts em tempo real ao receber atualização de grupo
        // (unread_count, last_message_at, etc.).
        if (updated?.is_group === true) {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'group-counts'] });
        }
        queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
          if (!old?.conversations) return old;
          const existing = old.conversations.find((c: any) => c.id === updated.id);
          if (!existing) {
            // Conversation not in current page — coalesce em 1 refetch a cada 2s no máximo
            if (!softRefetchTimer) {
              softRefetchTimer = setTimeout(() => {
                softRefetchTimer = null;
                queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
                queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
              }, 2000);
            }
            return old;
          }

          // Se assigned_to ou department_id mudou, forçar refetch para recalcular filtros do servidor
          const assignedChanged = existing.assigned_to !== updated.assigned_to;
          const deptChanged = existing.department_id !== updated.department_id;
          if (assignedChanged || deptChanged) {
            const now = Date.now();
            if (now - invalidateThrottle > 500) {
              invalidateThrottle = now;
              // Invalidação imediata sem delay para atribuições automáticas
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
            }
            return old;
          }

          // Patch normal
          const idx = old.conversations.findIndex((c: any) => c.id === updated.id);
          if (idx === -1) return old;
          const patched = [...old.conversations];
          patched[idx] = {
            ...patched[idx],
            ...updated,
            unread_count: parseInt(String(updated.unread_count ?? patched[idx].unread_count ?? 0), 10) || 0,
          };
          // Re-sort by last_message_at descending
          patched.sort((a: any, b: any) => {
            const tA = a.last_message_at || a.created_at || '';
            const tB = b.last_message_at || b.created_at || '';
            return tB.localeCompare(tA);
          });
          return { ...old, conversations: patched };
        });
      });

      channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        const inserted = payload.new as any;
        if (inserted?.is_group === true) {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'group-counts'] });
        }
        if (insertDebounce) clearTimeout(insertDebounce);
        insertDebounce = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
        }, 800);
      });

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_sentiment_analysis',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      } as any, () => {
        const now = Date.now();
        if (now - invalidateThrottle > 1000) {
          invalidateThrottle = now;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
        }
      });
    });
  }, [queryClient, tid]);

  return {
    conversations: data?.conversations || [],
    totalCount,
    totalPages,
    unreadCount,
    waitingCount,
    isLoading,
    error,
  };
};