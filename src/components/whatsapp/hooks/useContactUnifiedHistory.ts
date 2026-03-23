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
  attendanceCode: string | null;
}

export interface UnifiedHistoryFilters {
  departmentIds: string[];
  instanceIds: string[];
  status: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  assignedTo: string | null;
  searchText: string;
}

const DEFAULT_FILTERS: UnifiedHistoryFilters = {
  departmentIds: [],
  instanceIds: [],
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

  const effectiveDateFrom = filters.dateFrom ?? new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);

  // Step 1: Fetch all conversations + meta
  const conversationsQuery = useQuery({
    queryKey: ["contact-unified-conversations", contactId, tid],
    enabled: !!contactId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (!contactId) return { conversations: [], convMetaMap: new Map<string, ConversationMeta>(), departments: [] as { id: string; name: string }[], instances: [] as { id: string; name: string }[], agents: [] as { id: string; name: string }[] };

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

      // Attendances with attendance_code
      const { data: attendances } = await supabase
        .from("support_attendances")
        .select("conversation_id, status, department_id, assigned_to, attendance_code")
        .in("conversation_id", convIds)
        .order("opened_at", { ascending: false });

      const attMap = new Map<string, { status: string; department_id: string | null; assigned_to: string | null; attendance_code: string | null }>();
      for (const att of attendances || []) {
        if (!attMap.has(att.conversation_id)) {
          attMap.set(att.conversation_id, { status: att.status, department_id: att.department_id, assigned_to: att.assigned_to, attendance_code: att.attendance_code || null });
        }
      }

      const deptIds = new Set<string>();
      const instIds = new Set<string>();
      const agentIds = new Set<string>();
      for (const conv of conversations) {
        const att = attMap.get(conv.id);
        if (att?.department_id) deptIds.add(att.department_id);
        if (att?.assigned_to) agentIds.add(att.assigned_to);
        if (conv.instance_id) instIds.add(conv.instance_id);
      }

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
          attendanceCode: att?.attendance_code || null,
        });
      }

      const departments = Array.from(deptMap.entries()).map(([id, name]) => ({ id, name }));
      const instances = Array.from(instMap.entries()).map(([id, name]) => ({ id, name }));
      const agents = Array.from(agentNameMap.entries()).map(([id, name]) => ({ id, name }));

      return { conversations, convMetaMap, departments, instances, agents };
    },
  });

  const convMetaMap = conversationsQuery.data?.convMetaMap ?? new Map<string, ConversationMeta>();
  const allConvIds = conversationsQuery.data?.conversations.map((c) => c.id) ?? [];

  const filteredConvIds = useMemo(() => {
    if (allConvIds.length === 0) return [];
    return allConvIds.filter((cid) => {
      const meta = convMetaMap.get(cid);
      if (!meta) return false;
      if (filters.departmentIds.length > 0 && (!meta.departmentId || !filters.departmentIds.includes(meta.departmentId))) return false;
      if (filters.instanceIds.length > 0 && (!meta.instance_id || !filters.instanceIds.includes(meta.instance_id))) return false;
      if (filters.assignedTo && meta.assignedTo !== filters.assignedTo) return false;
      if (filters.status) {
        const effectiveStatus = meta.attendanceStatus || meta.status;
        if (effectiveStatus !== filters.status) return false;
      }
      return true;
    });
  }, [allConvIds, convMetaMap, filters.departmentIds, filters.instanceIds, filters.assignedTo, filters.status]);

  // Debug: log query state
  if (import.meta.env.DEV) {
    console.log("[unified-history] contactId:", contactId, "enabled:", enabled, "filteredConvIds:", filteredConvIds.length, "allConvIds:", allConvIds.length, "convQueryStatus:", conversationsQuery.status, "convQueryData:", !!conversationsQuery.data);
  }

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

      console.log("[unified-history] fetching messages for", filteredConvIds.length, "conversations, from:", effectiveDateFrom.toISOString());

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

      console.log("[unified-history] messages fetched:", data?.length ?? 0);

      if ((data?.length ?? 0) < PAGE_SIZE) {
        setHasMore(false);
      }

      return (data ?? []) as UnifiedMessage[];
    },
  });

  const messages = messagesQuery.data ?? [];

  const filteredMessages = useMemo(() => {
    if (!filters.searchText.trim()) return messages;
    const term = filters.searchText.toLowerCase();
    return messages.filter((m) => m.content?.toLowerCase().includes(term));
  }, [messages, filters.searchText]);

  const loadMore = useCallback(() => {
    if (messages.length > 0) {
      const oldest = messages[0];
      setOldestTimestamp(oldest.timestamp);
    }
  }, [messages]);

  // When conversations loaded but messages query just enabled and hasn't resolved yet
  const messagesNotReady = filteredConvIds.length > 0 && !messagesQuery.data && !messagesQuery.isError;
  const effectiveLoading = conversationsQuery.isLoading || messagesQuery.isLoading || messagesNotReady;

  return {
    messages: filteredMessages,
    convMetaMap,
    isLoading: effectiveLoading,
    isFetching: conversationsQuery.isFetching || messagesQuery.isFetching,
    filters,
    updateFilter,
    clearFilters,
    hasMore,
    loadMore,
    departments: conversationsQuery.data?.departments ?? [],
    instances: conversationsQuery.data?.instances ?? [],
    agents: conversationsQuery.data?.agents ?? [],
    totalConversations: allConvIds.length,
  };
}
