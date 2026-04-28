import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    staleTime: 30000,
  });

  return {
    stateMap: data ?? new Map<string, ConversationStateRow>(),
    isLoading,
  };
}
