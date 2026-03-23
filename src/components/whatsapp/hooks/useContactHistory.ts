import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface ContactHistoryConversation {
  id: string;
  contact_id: string;
  instance_id: string | null;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  created_at: string;
}

export interface ContactHistoryAttendance {
  id: string;
  conversation_id: string;
  status: string;
  attendance_code: string;
  opened_at: string;
  closed_at: string | null;
  assigned_to: string | null;
  department_id: string | null;
}

export interface ContactHistoryItem extends ContactHistoryConversation {
  attendance: ContactHistoryAttendance | null;
  departmentName: string | null;
  instanceName: string | null;
}

export function useContactHistory(contactId: string | null, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<ContactHistoryItem[]>({
    queryKey: ["contact-history", contactId, tid],
    enabled: !!contactId && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      if (!contactId) return [];

      // 1. Fetch all conversations for this contact
      let convQ = supabase
        .from("whatsapp_conversations")
        .select("id, contact_id, instance_id, status, last_message_at, last_message_preview, unread_count, created_at")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (tid) convQ = convQ.eq("tenant_id", tid);

      const { data: conversations, error: convErr } = await convQ;
      if (convErr) throw convErr;
      if (!conversations || conversations.length === 0) return [];

      const convIds = conversations.map((c) => c.id);

      // 2. Fetch latest attendance per conversation (batch)
      const { data: attendances } = await supabase
        .from("support_attendances")
        .select("id, conversation_id, status, attendance_code, opened_at, closed_at, assigned_to, department_id")
        .in("conversation_id", convIds)
        .order("opened_at", { ascending: false });

      // Build map: conversation_id -> latest attendance
      const attMap = new Map<string, ContactHistoryAttendance>();
      for (const att of attendances || []) {
        if (!attMap.has(att.conversation_id)) {
          attMap.set(att.conversation_id, att);
        }
      }

      // 3. Collect unique department_ids and instance_ids for name resolution
      const deptIds = new Set<string>();
      const instIds = new Set<string>();
      for (const conv of conversations) {
        const att = attMap.get(conv.id);
        if (att?.department_id) deptIds.add(att.department_id);
        if (conv.instance_id) instIds.add(conv.instance_id);
      }

      // 4. Fetch department names
      const deptMap = new Map<string, string>();
      if (deptIds.size > 0) {
        const { data: depts } = await supabase
          .from("support_departments")
          .select("id, name")
          .in("id", Array.from(deptIds));
        for (const d of depts || []) deptMap.set(d.id, d.name);
      }

      // 5. Fetch instance names
      const instMap = new Map<string, string>();
      if (instIds.size > 0) {
        const { data: insts } = await supabase
          .from("whatsapp_instances")
          .select("id, display_name, instance_name")
          .in("id", Array.from(instIds));
        for (const i of insts || []) instMap.set(i.id, i.display_name || i.instance_name);
      }

      // 6. Merge
      return conversations.map((conv) => {
        const att = attMap.get(conv.id) || null;
        return {
          ...conv,
          attendance: att,
          departmentName: att?.department_id ? deptMap.get(att.department_id) || null : null,
          instanceName: conv.instance_id ? instMap.get(conv.instance_id) || null : null,
        };
      });
    },
  });
}
