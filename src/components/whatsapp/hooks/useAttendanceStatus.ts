import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
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
 *
 * Uses setQueriesData on realtime events to instantly propagate changes
 * across ALL useAttendanceStatus consumers (sidebar, header, queue indicator).
 */
export function useAttendanceStatus(
  conversationIds: string[],
  includeClosedFilter = false
) {
  const queryClient = useQueryClient();
  const sortedKey = conversationIds.length > 0 ? conversationIds.slice().sort().join(",") : "";
  const queryKey = ["attendance-status", sortedKey, includeClosedFilter];

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
    // Fallback polling — only if realtime fails
    refetchInterval: 10000,
    staleTime: 2000,
  });

  // Patch ALL attendance-status caches immediately on realtime event
  const patchAllCaches = useCallback((row: any) => {
    const convId = row.conversation_id as string;
    const info: AttendanceInfo = {
      id: row.id,
      status: row.status,
      assigned_to: row.assigned_to,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
    };

    // setQueriesData updates ALL matching queries regardless of their specific key
    queryClient.setQueriesData<Map<string, AttendanceInfo>>(
      { queryKey: ["attendance-status"] },
      (oldMap) => {
        if (!oldMap) return oldMap;
        // Only patch if this conversation is in this cache's set
        if (!oldMap.has(convId)) {
          // For INSERT: check if the old map's query was for this conversation
          // We can't know for sure, so let invalidation handle adding new entries
          return oldMap;
        }
        const newMap = new Map(oldMap);
        newMap.set(convId, info);
        return newMap;
      }
    );

    // Also invalidate to pick up new entries (INSERT) and ensure consistency
    queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
    // Invalidate conversations so sidebar picks up status changes
    queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
  }, [queryClient]);

  // Single realtime subscription — shared channel name to avoid duplicates
  useEffect(() => {
    const channel = supabase
      .channel("attendance-status-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_attendances" },
        (payload) => {
          const row = payload.new as any;
          if (row && row.conversation_id) {
            patchAllCaches(row);
          } else {
            // DELETE or unexpected — just invalidate
            queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
            queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient, patchAllCaches]);

  return {
    attendanceMap: data ?? new Map<string, AttendanceInfo>(),
    isLoading,
  };
}
