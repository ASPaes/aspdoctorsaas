import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AttendanceInfo {
  id: string;
  status: string;
  assigned_to: string | null;
  opened_at: string;
  closed_at: string | null;
}

/**
 * Fetches active support_attendances for a list of conversation IDs.
 * Returns a Map<conversationId, AttendanceInfo>.
 * For "closed" filter, returns the latest closed attendance per conversation.
 */
export function useAttendanceStatus(
  conversationIds: string[],
  includeClosedFilter = false
) {
  const queryClient = useQueryClient();
  const queryKey = ["attendance-status", conversationIds.sort().join(","), includeClosedFilter];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (conversationIds.length === 0) return new Map<string, AttendanceInfo>();

      // Fetch non-closed (active) attendances
      const { data: activeRows } = await supabase
        .from("support_attendances")
        .select("id, conversation_id, status, assigned_to, opened_at, closed_at")
        .in("conversation_id", conversationIds)
        .in("status", ["waiting", "in_progress"]);

      const map = new Map<string, AttendanceInfo>();

      if (activeRows) {
        for (const row of activeRows) {
          map.set(row.conversation_id, {
            id: row.id,
            status: row.status,
            assigned_to: row.assigned_to,
            opened_at: row.opened_at,
            closed_at: row.closed_at,
          });
        }
      }

      // If we need closed data too (for "encerrados" filter), fetch last closed
      if (includeClosedFilter) {
        const missingIds = conversationIds.filter(id => !map.has(id));
        if (missingIds.length > 0) {
          const { data: closedRows } = await supabase
            .from("support_attendances")
            .select("id, conversation_id, status, assigned_to, opened_at, closed_at")
            .in("conversation_id", missingIds)
            .in("status", ["closed", "inactive_closed"])
            .order("closed_at", { ascending: false });

          if (closedRows) {
            for (const row of closedRows) {
              if (!map.has(row.conversation_id)) {
                map.set(row.conversation_id, {
                  id: row.id,
                  status: row.status,
                  assigned_to: row.assigned_to,
                  opened_at: row.opened_at,
                  closed_at: row.closed_at,
                });
              }
            }
          }
        }
      }

      return map;
    },
    enabled: conversationIds.length > 0,
    refetchInterval: 8000,
    staleTime: 4000,
  });

  // Subscribe to realtime changes on support_attendances to invalidate immediately
  useEffect(() => {
    const channel = supabase
      .channel("attendance-status-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_attendances" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return {
    attendanceMap: data ?? new Map<string, AttendanceInfo>(),
    isLoading,
  };
}
