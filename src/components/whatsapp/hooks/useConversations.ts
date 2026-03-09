import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface Conversation {
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
  contact_name: string | null;
  contact_phone: string;
  contact_profile_picture: string | null;
  instance_name: string;
  instance_display_name: string | null;
}

export function useConversations(search?: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const query = useQuery<Conversation[]>({
    queryKey: ["whatsapp-conversations", tid, search],
    queryFn: async () => {
      let q = supabase
        .from("whatsapp_conversations")
        .select(`
          id, contact_id, instance_id, status, category, priority, assigned_to,
          unread_count, last_message_at, last_message_preview, created_at,
          whatsapp_contacts!inner (name, phone_number, profile_picture_url),
          whatsapp_instances!inner (instance_name, display_name)
        `)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (tid) q = q.eq("tenant_id", tid);

      const { data, error } = await q.limit(200);
      if (error) throw error;

      let results = (data ?? []).map((row: any) => ({
        id: row.id,
        contact_id: row.contact_id,
        instance_id: row.instance_id,
        status: row.status,
        category: row.category,
        priority: row.priority,
        assigned_to: row.assigned_to,
        unread_count: row.unread_count,
        last_message_at: row.last_message_at,
        last_message_preview: row.last_message_preview,
        created_at: row.created_at,
        contact_name: row.whatsapp_contacts?.name ?? null,
        contact_phone: row.whatsapp_contacts?.phone_number ?? "",
        contact_profile_picture: row.whatsapp_contacts?.profile_picture_url ?? null,
        instance_name: row.whatsapp_instances?.instance_name ?? "",
        instance_display_name: row.whatsapp_instances?.display_name ?? null,
      }));

      if (search?.trim()) {
        const s = search.toLowerCase();
        results = results.filter(
          (c) =>
            (c.contact_name ?? "").toLowerCase().includes(s) ||
            c.contact_phone.includes(s) ||
            (c.last_message_preview ?? "").toLowerCase().includes(s)
        );
      }

      return results;
    },
    staleTime: 30_000,
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}
