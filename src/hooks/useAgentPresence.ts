import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePresenceRow } from "@/hooks/usePresenceRow";
import type { AgentPresence, AgentStatus } from "@/hooks/usePresenceRow";

// Reexports para manter compatibilidade com consumidores existentes.
export type { AgentPresence, AgentStatus } from "@/hooks/usePresenceRow";

export interface PauseReason {
  id: string;
  name: string;
  average_minutes: number;
  is_active: boolean;
  sort_order: number;
}

export function useAgentPresence() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const { presence, presenceLoading, invalidate } = usePresenceRow();

  const { data: pauseReasons = [] } = useQuery({
    queryKey: ["support_pause_reasons_active", tid],
    enabled: !!tid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase
        .from("support_pause_reasons")
        .select("id, name, average_minutes, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PauseReason[];
    },
  });

  /** Optimistically update presence cache to avoid stale timer rendering */
  const optimisticUpdate = useCallback((patch: Partial<AgentPresence>) => {
    queryClient.setQueryData(["agent_presence", tid, userId], (old: AgentPresence | null | undefined) => {
      if (!old) return old;
      return { ...old, ...patch };
    });
  }, [queryClient, tid, userId]);

  // ── RPC-based actions ──

  const startShift = useCallback(async () => {
    if (!tid) return;
    optimisticUpdate({ status: "active", pause_reason_id: null, pause_started_at: null, pause_expected_end_at: null, shift_started_at: new Date().toISOString(), shift_ended_at: null });
    const { error } = await supabase.rpc("agent_presence_set_active", { p_tenant_id: tid });
    if (error) throw error;
    invalidate();
  }, [tid, invalidate, optimisticUpdate]);

  const setActive = useCallback(async () => {
    if (!tid) return;
    optimisticUpdate({ status: "active", pause_reason_id: null, pause_started_at: null, pause_expected_end_at: null });
    const { error } = await supabase.rpc("agent_presence_set_active", { p_tenant_id: tid });
    if (error) throw error;
    invalidate();
  }, [tid, invalidate, optimisticUpdate]);

  const setPaused = useCallback(
    async (reasonId: string, minutes?: number) => {
      if (!tid) return;
      const reason = pauseReasons.find((r) => r.id === reasonId);
      const finalMin = minutes ?? reason?.average_minutes ?? 15;
      const { error } = await supabase.rpc("agent_presence_set_pause", {
        p_tenant_id: tid,
        p_reason_id: reasonId,
        p_minutes: finalMin,
      });
      if (error) throw error;
      invalidate();
    },
    [tid, pauseReasons, invalidate]
  );

  const extendPause = useCallback(async (minutes?: number) => {
    if (!tid || !presence?.pause_reason_id) return;
    const reason = pauseReasons.find((r) => r.id === presence.pause_reason_id);
    const finalMin = minutes ?? reason?.average_minutes ?? 15;
    const { error } = await supabase.rpc("agent_presence_extend_pause", {
      p_tenant_id: tid,
      p_minutes: finalMin,
    });
    if (error) throw error;
    invalidate();
  }, [tid, presence?.pause_reason_id, pauseReasons, invalidate]);

  const endShift = useCallback(async () => {
    if (!tid) return;
    optimisticUpdate({ status: "offline", pause_reason_id: null, pause_started_at: null, pause_expected_end_at: null, shift_ended_at: new Date().toISOString() });
    try {
      const { error } = await supabase.rpc("agent_presence_set_off", { p_tenant_id: tid });
      if (error) throw error;
      invalidate();
    } catch (err) {
      invalidate(); // revert optimistic on error
      throw err;
    }
  }, [tid, invalidate, optimisticUpdate]);

  const fetchActiveAttendances = useCallback(async (): Promise<{ count: number; ids: string[] }> => {
    if (!tid || !userId) return { count: 0, ids: [] };
    const { data, error } = await supabase
      .from("support_attendances")
      .select("id")
      .eq("tenant_id", tid)
      .eq("assigned_to", userId)
      .eq("status", "in_progress");
    if (error) throw error;
    const ids = (data ?? []).map((r: any) => r.id);
    return { count: ids.length, ids };
  }, [tid, userId]);

  const releaseToQueueAndEndShift = useCallback(async (_attendanceIds: string[]) => {
    if (!tid) return;
    try {
      const { error } = await supabase.rpc("agent_presence_set_off_release_queue", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
    } catch (err) {
      throw err;
    }
  }, [tid, invalidate, queryClient]);

  const keepAssignmentsAndEndShift = useCallback(async (attendanceIds: string[]) => {
    if (!tid || !userId) return;
    try {
      await supabase.from("support_agent_presence_events").insert({
        tenant_id: tid,
        user_id: userId,
        event_type: "shift_end_keep_assignments",
        payload: { count: attendanceIds.length, attendance_ids: attendanceIds },
      });
      const { error } = await supabase.rpc("agent_presence_set_off", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      invalidate();
    } catch (err) {
      throw err;
    }
  }, [tid, userId, invalidate]);

  const status: AgentStatus = (presence?.status as AgentStatus) ?? "offline";

  const droppedForInactivity =
    status === "offline" &&
    !!presence?.shift_started_at &&
    !presence?.shift_ended_at;

  return {
    presence,
    presenceLoading,
    status,
    pauseReasons,
    isAdmin,
    startShift,
    setActive,
    setPaused,
    extendPause,
    endShift,
    fetchActiveAttendances,
    releaseToQueueAndEndShift,
    keepAssignmentsAndEndShift,
    droppedForInactivity,
    isBlocked: !isAdmin && status === "offline",
  };
}
