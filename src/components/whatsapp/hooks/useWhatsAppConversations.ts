import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface ConversationWithContact {
  id: string;
  contact_id: string;
  instance_id: string;
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
        const { data: msgMatches } = await supabase
          .from('whatsapp_messages' as any)
          .select('conversation_id')
          .ilike('content', `%${searchTerm}%`)
          .limit(200);
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

      let result = (conversationsData ?? []) as unknown as ConversationWithContact[];

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

      // Count query
      let countQuery = supabase
        .from('whatsapp_conversations')
        .select('*', { count: 'exact', head: true });
      if (tid) countQuery = countQuery.eq('tenant_id', tid);
      if (filters?.instanceId) countQuery = countQuery.eq('instance_id', filters.instanceId);
      if (filters?.status) countQuery = countQuery.eq('status', filters.status);
      if (filters?.assignedTo) countQuery = countQuery.eq('assigned_to', filters.assignedTo);
      if (filters?.unassigned) countQuery = countQuery.is('assigned_to', null);

      const { count: totalCount } = await countQuery;

      // Unread count
      let unreadQuery = supabase
        .from('whatsapp_conversations')
        .select('unread_count', { count: 'exact' })
        .gt('unread_count', 0);
      if (tid) unreadQuery = unreadQuery.eq('tenant_id', tid);
      if (filters?.instanceId) unreadQuery = unreadQuery.eq('instance_id', filters.instanceId);

      const { count: unreadCount } = await unreadQuery;

      // Waiting count (last message from client)
      const conversationIds = result.map(c => c.id);
      let waitingCount = 0;

      if (conversationIds.length > 0) {
        const { data: lastMessages } = await supabase
          .from('whatsapp_messages' as any)
          .select('conversation_id, is_from_me, timestamp')
          .in('conversation_id', conversationIds)
          .order('timestamp', { ascending: false });

        if (lastMessages) {
          const lastMessageMap = new Map<string, boolean>();
          (lastMessages as any[]).forEach((msg: any) => {
            if (!lastMessageMap.has(msg.conversation_id)) {
              lastMessageMap.set(msg.conversation_id, msg.is_from_me || false);
            }
          });

          result = result.map(conv => ({
            ...conv,
            isLastMessageFromMe: lastMessageMap.get(conv.id),
          }));

          waitingCount = conversationIds.filter(id => lastMessageMap.get(id) === false).length;
        }
      }

      const totalPages = Math.ceil((totalCount || 0) / pageSize);

      return {
        conversations: result,
        totalCount: totalCount || 0,
        totalPages,
        unreadCount: unreadCount || 0,
        waitingCount,
      } as ConversationsResult;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('conversations-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_conversations'
      }, () => {
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
