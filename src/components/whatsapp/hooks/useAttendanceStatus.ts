import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AttendanceInfo {
  id: string;
  status: string;
  assigned_to: string | null;
  opened_at: string;
  closed_at: string | null;
  department_id: string | null;
  created_from: string | null;
}

/**
 * Fetches active support_attendances for a list of conversation IDs.
 * Returns a Map<conversationId, AttendanceInfo>.
 *
 * Each hook instance creates its own uniquely-named Supabase Realtime channel
 * so that unmounting one consumer (e.g. ChatHeader) does NOT kill the
 * subscription used by another consumer (e.g. ConversationsSidebar).
 *
 * On every realtime event the handler uses setQueriesData to patch ALL
 * attendance-status caches instantly, keeping Sidebar + Header in sync.
 */
export function useAttendanceStatus(
  conversationIds: string[],
  includeClosedFilter = false
) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const sortedKey =
    conversationIds.length > 0
      ? conversationIds.slice().sort().join(",")
      : "";
  const queryKey = ["attendance-status", sortedKey, includeClosedFilter];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (conversationIds.length === 0)
        return new Map<string, AttendanceInfo>();

      // Fetch non-closed (active) attendances
      const { data: activeRows } = await supabase
        .from("support_attendances")
        .select(
          "id, conversation_id, status, assigned_to, opened_at, closed_at, department_id, created_from"
        )
        .in("conversation_id", conversationIds)
        .in("status", ["waiting", "in_progress"])
        .order("created_at", { ascending: false });

      const map = new Map<string, AttendanceInfo>();

      if (activeRows) {
        for (const row of activeRows) {
          // Keep only the most recent per conversation
          if (!map.has(row.conversation_id)) {
            map.set(row.conversation_id, {
              id: row.id,
              status: row.status,
              assigned_to: row.assigned_to,
              opened_at: row.opened_at,
              closed_at: row.closed_at,
              department_id: row.department_id,
              created_from: row.created_from || null,
            });
          }
        }
      }

      // If we need closed data too (for "encerrados" filter), fetch last closed
      if (includeClosedFilter) {
        const missingIds = conversationIds.filter((id) => !map.has(id));
        if (missingIds.length > 0) {
          const { data: closedRows } = await supabase
            .from("support_attendances")
            .select(
              "id, conversation_id, status, assigned_to, opened_at, closed_at, department_id, created_from"
            )
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
                  department_id: row.department_id,
                  created_from: row.created_from || null,
                });
              }
            }
          }
        }
      }

      return map;
    },
    enabled: conversationIds.length > 0,
    refetchInterval: 10000,
    staleTime: 2000,
  });

  // Patch ALL attendance-status caches immediately on realtime event
  const patchAllCaches = useCallback(
    (row: any) => {
      const convId = row.conversation_id as string;
      if (!convId) return;

      // Tenant isolation: ignore events from other tenants
      if (tenantId && row.tenant_id && row.tenant_id !== tenantId) return;

      const info: AttendanceInfo = {
        id: row.id,
        status: row.status,
        assigned_to: row.assigned_to,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        department_id: row.department_id,
        created_from: row.created_from || null,
      };

      // setQueriesData updates ALL matching queries regardless of their specific key
      queryClient.setQueriesData<Map<string, AttendanceInfo>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;

          // If this conversation is tracked in this cache, patch it
          if (oldMap.has(convId)) {
            const newMap = new Map(oldMap);
            newMap.set(convId, info);
            return newMap;
          }

          // For INSERT of a new attendance for a conversation we're tracking
          // We can't know without the full key, so fall through to invalidation
          return oldMap;
        }
      );

      // Also invalidate to pick up new entries (INSERT) and ensure consistency
      queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
      // Invalidate conversations so sidebar picks up status changes
      queryClient.invalidateQueries({
        queryKey: ["whatsapp", "conversations"],
      });
    },
    [queryClient, tenantId]
  );

  // Unique channel name per hook instance — prevents unmount of one consumer
  // from killing the subscription of another (e.g. Header vs Sidebar).
  const channelRef = useRef<string>(
    `att-rt-${crypto.randomUUID().slice(0, 8)}`
  );

  useEffect(() => {
    const channelName = channelRef.current;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_attendances",
        },
        (payload) => {
          const row = payload.new as any;
          if (row && row.conversation_id) {
            patchAllCaches(row);
          } else {
            // DELETE or unexpected — just invalidate
            queryClient.invalidateQueries({
              queryKey: ["attendance-status"],
            });
            queryClient.invalidateQueries({
              queryKey: ["whatsapp", "conversations"],
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, patchAllCaches]);

  return {
    attendanceMap: data ?? new Map<string, AttendanceInfo>(),
    isLoading,
  };
}
