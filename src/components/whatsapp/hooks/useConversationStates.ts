import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { ConversationStateRow } from "@/utils/whatsapp/conversationBucket";

/**
 * Fetches conversation state from v_whatsapp_conversations_state view
 * for a list of conversation IDs. Returns a Map<conversationId, state>.
 */
export function useConversationStates(conversationIds: string[]) {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const sortedKey = conversationIds.length > 0
    ? conversationIds.slice().sort().join(",")
    : "";

  const { data, isLoading } = useQuery({
    queryKey: ["conversation-states", sortedKey],
    queryFn: async () => {
      if (conversationIds.length === 0) return new Map<string, ConversationStateRow>();

      const { data: rows, error } = await supabase
        .from("v_whatsapp_conversations_state" as any)
        .select("*")
        .in("conversation_id", conversationIds);

      if (error) throw error;

      const map = new Map<string, ConversationStateRow>();
      for (const row of (rows ?? []) as any[]) {
        map.set(row.conversation_id, {
          conversation_id: row.conversation_id,
          conversation_status: row.conversation_status,
          attendance_status: row.attendance_status,
          opened_out_of_hours: row.opened_out_of_hours ?? false,
          attendance_assigned_to: row.attendance_assigned_to,
          department_id: row.department_id,
          tenant_id: row.tenant_id,
        });
      }
      return map;
    },
    enabled: conversationIds.length > 0,
    staleTime: 2000,
  });

  // Realtime: invalida quando estado muda. Filter por tenant_id reduz volume processado.
  // Debounce 800ms evita tempestade de invalidações quando múltiplos eventos chegam em rajada.
  const channelRef = useRef(`conv-states-${crypto.randomUUID().slice(0, 8)}`);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tid) return;

    const debouncedInvalidate = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["conversation-states"] });
      }, 800);
    };

    const channel = supabase
      .channel(channelRef.current)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "whatsapp_conversations",
        filter: `tenant_id=eq.${tid}`,
      }, debouncedInvalidate)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "support_attendances",
        filter: `tenant_id=eq.${tid}`,
      }, debouncedInvalidate)
      .subscribe();

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [queryClient, tid]);

  return {
    stateMap: data ?? new Map<string, ConversationStateRow>(),
    isLoading,
  };
}
