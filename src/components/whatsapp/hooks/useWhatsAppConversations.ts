import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
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
}

export interface ConversationsFilters {
  instanceId?: string;
  instanceIds?: string[];
  departmentId?: string;
  
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
    q = q.eq('department_id', filters.departmentId);
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
  if (filters?.assignedTo) q = q.eq('assigned_to', filters.assignedTo);
  if (filters?.unassigned) q = q.is('assigned_to', null);
  return q;
}

// ---------------------------------------------------------------------------
// useConversationCounts — separate hook with its own cache key & staleTime
// ---------------------------------------------------------------------------

export function useConversationCounts(filters?: ConversationsFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ['whatsapp', 'conversation-counts', filters, tid],
    staleTime: 60_000,
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
  const pageSize = filters?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Counts from the dedicated hook
  const { data: countsData } = useConversationCounts(filters);
  const totalCount = countsData?.totalCount || 0;
  const unreadCount = countsData?.unreadCount || 0;
  const waitingCount = countsData?.waitingCount || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'conversations', filters, tid],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let query = supabase
        .from('whatsapp_conversations')
        .select(`*, contact:whatsapp_contacts(*)`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      query = applyFullFilter(query, tid, filters);

      // Hide conversations without messages, unless they are in includeIds
      const includeIds = filters?.includeIds;
      if (includeIds && includeIds.length > 0) {
        query = query.or(`last_message_at.not.is.null,id.in.(${includeIds.join(',')})`);
      } else {
        query = query.not('last_message_at', 'is', null);
      }

      const { data: conversationsData, error } = await query;
      if (error) throw error;

      const result = ((conversationsData ?? []) as unknown as ConversationWithContact[]).map(conv => ({
        ...conv,
        unread_count: parseInt(String((conv as any).unread_count ?? 0), 10) || 0,
        last_message_at: conv.last_message_at || null,
        isLastMessageFromMe: (conv as any).is_last_message_from_me ?? false,
      }));

      return { conversations: result };
    },
  });

  // Realtime: unique channel per hook instance to avoid collision
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 10));

  useEffect(() => {
    const channelName = `conversations-rt-${channelIdRef.current}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations'
      }, (payload) => {
        const updated = payload.new as any;
        queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
          if (!old?.conversations) return old;
          const existing = old.conversations.find((c: any) => c.id === updated.id);
          if (!existing) {
            // Conversation not in current page — schedule a soft refetch
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
            }, 500);
            return old;
          }

          // Se assigned_to ou department_id mudou, forçar refetch para recalcular filtros do servidor
          const assignedChanged = existing.assigned_to !== updated.assigned_to;
          const deptChanged = existing.department_id !== updated.department_id;
          if (assignedChanged || deptChanged) {
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
              queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
            }, 100);
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
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_conversations'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation-counts'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

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