import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface UnifiedMessage {
  id: string;
  conversation_id: string;
  content: string | null;
  message_type: string;
  is_from_me: boolean;
  timestamp: string;
  sender_name: string | null;
  media_url: string | null;
  media_mimetype: string | null;
}

export interface ConversationMeta {
  id: string;
  instance_id: string | null;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
  instanceName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  attendanceStatus: string | null;
}

export interface UnifiedHistoryFilters {
  departmentId: string | null;
  instanceId: string | null;
  status: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  assignedTo: string | null;
  searchText: string;
}

const DEFAULT_FILTERS: UnifiedHistoryFilters = {
  departmentId: null,
  instanceId: null,
  status: null,
  dateFrom: null,
  dateTo: null,
  assignedTo: null,
  searchText: "",
};

const PAGE_SIZE = 500;
const DEFAULT_DAYS = 7;

export function useContactUnifiedHistory(contactId: string | null, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [filters, setFilters] = useState<UnifiedHistoryFilters>(DEFAULT_FILTERS);
  const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Reset pagination when filters change
  const resetPagination = useCallback(() => {
    setOldestTimestamp(null);
    setHasMore(true);
  }, []);

  const updateFilter = useCallback(
    <K extends keyof UnifiedHistoryFilters>(key: K, value: UnifiedHistoryFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
      resetPagination();
    },
    [resetPagination]
  );

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    resetPagination();
  }, [resetPagination]);

  // Default date range: last 7 days
  const effectiveDateFrom = filters.dateFrom ?? new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);

  // Step 1: Fetch all conversations for this contact (lightweight)
  const conversationsQuery = useQuery({
    queryKey: ["contact-unified-conversations", contactId, tid],
    enabled: !!contactId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (!contactId) return { conversations: [], convMetaMap: new Map<string, ConversationMeta>(), departments: [] as { id: string; name: string }[], instances: [] as { id: string; name: string }[], agents: [] as { id: string; name: string }[] };

      // 1. Conversations
      let convQ = supabase
        .from("whatsapp_conversations")
        .select("id, instance_id, status")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (tid) convQ = convQ.eq("tenant_id", tid);

      const { data: conversations, error: convErr } = await convQ;
      if (convErr) throw convErr;
      if (!conversations || conversations.length === 0)
        return { conversations: [], convMetaMap: new Map<string, ConversationMeta>(), departments: [], instances: [], agents: [] };

      const convIds = conversations.map((c) => c.id);

      // 2. Attendances (latest per conversation)
      const { data: attendances } = await supabase
        .from("support_attendances")
        .select("conversation_id, status, department_id, assigned_to")
        .in("conversation_id", convIds)
        .order("opened_at", { ascending: false });

      const attMap = new Map<string, { status: string; department_id: string | null; assigned_to: string | null }>();
      for (const att of attendances || []) {
        if (!attMap.has(att.conversation_id)) {
          attMap.set(att.conversation_id, att);
        }
      }

      // 3. Collect unique IDs
      const deptIds = new Set<string>();
      const instIds = new Set<string>();
      const agentIds = new Set<string>();
      for (const conv of conversations) {
        const att = attMap.get(conv.id);
        if (att?.department_id) deptIds.add(att.department_id);
        if (att?.assigned_to) agentIds.add(att.assigned_to);
        if (conv.instance_id) instIds.add(conv.instance_id);
      }

      // 4. Resolve names in parallel
      const [deptsRes, instsRes, agentsRes] = await Promise.all([
        deptIds.size > 0
          ? supabase.from("support_departments").select("id, name").in("id", Array.from(deptIds))
          : Promise.resolve({ data: [] }),
        instIds.size > 0
          ? supabase.from("whatsapp_instances").select("id, display_name, instance_name").in("id", Array.from(instIds))
          : Promise.resolve({ data: [] }),
        agentIds.size > 0
          ? supabase.from("profiles").select("user_id, funcionario_id").in("user_id", Array.from(agentIds))
          : Promise.resolve({ data: [] }),
      ]);

      const deptMap = new Map<string, string>();
      for (const d of (deptsRes as any).data || []) deptMap.set(d.id, d.name);

      const instMap = new Map<string, string>();
      for (const i of (instsRes as any).data || []) instMap.set(i.id, i.display_name || i.instance_name);

      // Resolve agent names via funcionarios
      const agentProfileMap = new Map<string, number>();
      for (const p of (agentsRes as any).data || []) {
        if (p.funcionario_id) agentProfileMap.set(p.user_id, p.funcionario_id);
      }
      const funcIds = Array.from(agentProfileMap.values());
      const agentNameMap = new Map<string, string>();
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase
          .from("funcionarios")
          .select("id, nome")
          .in("id", funcIds);
        const funcNameMap = new Map<number, string>();
        for (const f of funcs || []) funcNameMap.set(f.id, f.nome);
        for (const [uid, fid] of agentProfileMap) {
          const nome = funcNameMap.get(fid);
          if (nome) agentNameMap.set(uid, nome);
        }
      }

      // 5. Build meta map
      const convMetaMap = new Map<string, ConversationMeta>();
      for (const conv of conversations) {
        const att = attMap.get(conv.id);
        convMetaMap.set(conv.id, {
          id: conv.id,
          instance_id: conv.instance_id,
          status: conv.status,
          departmentId: att?.department_id || null,
          departmentName: att?.department_id ? deptMap.get(att.department_id) || null : null,
          instanceName: conv.instance_id ? instMap.get(conv.instance_id) || null : null,
          assignedTo: att?.assigned_to || null,
          assignedToName: att?.assigned_to ? agentNameMap.get(att.assigned_to) || null : null,
          attendanceStatus: att?.status || null,
        });
      }

      // Build filter options
      const departments = Array.from(deptMap.entries()).map(([id, name]) => ({ id, name }));
      const instances = Array.from(instMap.entries()).map(([id, name]) => ({ id, name }));
      const agents = Array.from(agentNameMap.entries()).map(([id, name]) => ({ id, name }));

      return { conversations, convMetaMap, departments, instances, agents };
    },
  });

  const convMetaMap = conversationsQuery.data?.convMetaMap ?? new Map<string, ConversationMeta>();
  const allConvIds = conversationsQuery.data?.conversations.map((c) => c.id) ?? [];

  // Apply conversation-level filters to get relevant conv IDs
  const filteredConvIds = useMemo(() => {
    if (allConvIds.length === 0) return [];
    return allConvIds.filter((cid) => {
      const meta = convMetaMap.get(cid);
      if (!meta) return false;
      if (filters.departmentId && meta.departmentId !== filters.departmentId) return false;
      if (filters.instanceId && meta.instance_id !== filters.instanceId) return false;
      if (filters.assignedTo && meta.assignedTo !== filters.assignedTo) return false;
      if (filters.status) {
        const effectiveStatus = meta.attendanceStatus || meta.status;
        if (effectiveStatus !== filters.status) return false;
      }
      return true;
    });
  }, [allConvIds, convMetaMap, filters.departmentId, filters.instanceId, filters.assignedTo, filters.status]);

  // Step 2: Fetch messages for filtered conversations
  const messagesQuery = useQuery({
    queryKey: [
      "contact-unified-messages",
      contactId,
      tid,
      filteredConvIds.join(","),
      effectiveDateFrom.toISOString(),
      filters.dateTo?.toISOString() ?? "now",
      oldestTimestamp,
    ],
    enabled: !!contactId && enabled && filteredConvIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      if (filteredConvIds.length === 0) return [];

      let q = supabase
        .from("whatsapp_messages")
        .select("id, conversation_id, content, message_type, is_from_me, timestamp, sender_name, media_url, media_mimetype")
        .in("conversation_id", filteredConvIds)
        .gte("timestamp", effectiveDateFrom.toISOString())
        .order("timestamp", { ascending: true })
        .limit(PAGE_SIZE);

      if (filters.dateTo) {
        q = q.lte("timestamp", filters.dateTo.toISOString());
      }

      if (oldestTimestamp) {
        q = q.lt("timestamp", oldestTimestamp);
      }

      const { data, error } = await q;
      if (error) throw error;

      if ((data?.length ?? 0) < PAGE_SIZE) {
        setHasMore(false);
      }

      return (data ?? []) as UnifiedMessage[];
    },
  });

  const messages = messagesQuery.data ?? [];

  // Apply search filter client-side
  const filteredMessages = useMemo(() => {
    if (!filters.searchText.trim()) return messages;
    const term = filters.searchText.toLowerCase();
    return messages.filter((m) => m.content?.toLowerCase().includes(term));
  }, [messages, filters.searchText]);

  const loadMore = useCallback(() => {
    if (messages.length > 0) {
      const oldest = messages[0]; // ASC order, first is oldest
      setOldestTimestamp(oldest.timestamp);
    }
  }, [messages]);

  return {
    messages: filteredMessages,
    convMetaMap,
    isLoading: conversationsQuery.isLoading || messagesQuery.isLoading,
    isFetching: conversationsQuery.isFetching || messagesQuery.isFetching,
    filters,
    updateFilter,
    clearFilters,
    hasMore,
    loadMore,
    // Filter options
    departments: conversationsQuery.data?.departments ?? [],
    instances: conversationsQuery.data?.instances ?? [],
    agents: conversationsQuery.data?.agents ?? [],
    totalConversations: allConvIds.length,
  };
}
