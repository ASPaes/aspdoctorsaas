import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { escapeLike } from '@/lib/utils';

export interface ConversationWithContact {
  id: string;
  contact_id: string;
  instance_id: string | null;
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
  search?: string;
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

export const useWhatsAppConversations = (filters?: ConversationsFilters) => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const page = filters?.page || 1;
  const pageSize = filters?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'conversations', filters, tid],
    queryFn: async () => {
      const searchTerm = filters?.search?.trim();

      // If searching by message content (3+ chars), find matching conversation IDs first
      let messageMatchIds: string[] = [];
      if (searchTerm && searchTerm.length >= 3) {
        const escaped = escapeLike(searchTerm);
        const { data: msgMatches } = await supabase
          .from('whatsapp_messages' as any)
          .select('conversation_id')
          .ilike('content', `%${escaped}%`)
          .limit(100);
        if (msgMatches) {
          messageMatchIds = [...new Set((msgMatches as any[]).map((m: any) => m.conversation_id))];
        }
      }

      let query = supabase
        .from('whatsapp_conversations')
        .select(`*, contact:whatsapp_contacts(*)`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (tid) query = query.eq('tenant_id', tid);
      // Instance filter: for unified conversations, filter by messages that have this instance_id
      // Keep backward compat: if conversation still has instance_id, use it; otherwise skip
      if (filters?.instanceId) query = query.eq('instance_id', filters.instanceId);
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
      if (filters?.unassigned) query = query.is('assigned_to', null);

      // Hide conversations without messages, unless they are in includeIds
      const includeIds = filters?.includeIds;
      if (includeIds && includeIds.length > 0) {
        query = query.or(`last_message_at.not.is.null,id.in.(${includeIds.join(',')})`);
      } else {
        query = query.not('last_message_at', 'is', null);
      }

      const { data: conversationsData, error } = await query;
      if (error) throw error;

      let result = ((conversationsData ?? []) as unknown as ConversationWithContact[]).map(conv => ({
        ...conv,
        unread_count: parseInt(String((conv as any).unread_count ?? 0), 10) || 0,
        last_message_at: conv.last_message_at || null,
        // Map denormalized column to UI field — NO extra query needed
        isLastMessageFromMe: (conv as any).is_last_message_from_me ?? false,
      }));

      // Apply search filter (contact name, phone, or message content match)
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        result = result.filter((c) => {
          const nameMatch = (c.contact?.name ?? '').toLowerCase().includes(s);
          const phoneMatch = (c.contact?.phone_number ?? '').includes(s);
          const previewMatch = (c.last_message_preview ?? '').toLowerCase().includes(s);
          const msgMatch = messageMatchIds.includes(c.id);
          return nameMatch || phoneMatch || previewMatch || msgMatch;
        });
      }

      // --- PARALLELIZED: count + unread + waiting in a single Promise.all ---
      const buildBaseFilter = (q: any) => {
        if (tid) q = q.eq('tenant_id', tid);
        if (filters?.instanceId) q = q.eq('instance_id', filters.instanceId);
        return q;
      };

      const buildFullFilter = (q: any) => {
        q = buildBaseFilter(q);
        if (filters?.status) q = q.eq('status', filters.status);
        if (filters?.assignedTo) q = q.eq('assigned_to', filters.assignedTo);
        if (filters?.unassigned) q = q.is('assigned_to', null);
        return q;
      };

      const [countResult, unreadResult, waitingResult] = await Promise.all([
        // Total count
        buildFullFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
        ),
        // Unread count
        buildBaseFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
            .gt('unread_count', 0)
        ),
        // Waiting count — uses denormalized is_last_message_from_me instead of scanning messages
        buildBaseFilter(
          supabase.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .eq('is_last_message_from_me', false)
            .not('last_message_at', 'is', null)
        ),
      ]);

      const totalCount = countResult.count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        conversations: result,
        totalCount,
        totalPages,
        unreadCount: unreadResult.count || 0,
        waitingCount: waitingResult.count || 0,
      } as ConversationsResult;
    },
  });

  // Realtime: only invalidate when the specific conversation changes
  useEffect(() => {
    const channel = supabase
      .channel('conversations-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations'
      }, (payload) => {
        const updated = payload.new as any;
        // Patch the specific conversation in cache instead of full refetch
        queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
          if (!old?.conversations) return old;
          const idx = old.conversations.findIndex((c: any) => c.id === updated.id);
          if (idx === -1) return old; // new conversation — need full refetch
          const patched = [...old.conversations];
          patched[idx] = { ...patched[idx], ...updated };
          return { ...old, conversations: patched };
        });
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_conversations'
      }, () => {
        // New conversation — invalidate to pick it up
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return {
    conversations: data?.conversations || [],
    totalCount: data?.totalCount || 0,
    totalPages: data?.totalPages || 0,
    unreadCount: data?.unreadCount || 0,
    waitingCount: data?.waitingCount || 0,
    isLoading,
    error,
  };
};
