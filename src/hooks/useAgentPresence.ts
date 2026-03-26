import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

export type AgentStatus = "active" | "paused" | "off";

export interface AgentPresence {
  user_id: string;
  tenant_id: string;
  status: AgentStatus;
  pause_reason_id: string | null;
  pause_started_at: string | null;
  pause_expected_end_at: string | null;
  shift_started_at: string | null;
  shift_ended_at: string | null;
  last_heartbeat_at: string | null;
  updated_at: string;
}

export interface PauseReason {
  id: string;
  name: string;
  average_minutes: number;
  is_active: boolean;
  sort_order: number;
}

async function logEvent(
  tid: string,
  userId: string,
  eventType: string,
  reasonId?: string | null,
  payload?: Record<string, any>
) {
  await supabase.from("support_agent_presence_events").insert({
    tenant_id: tid,
    user_id: userId,
    event_type: eventType,
    pause_reason_id: reasonId || null,
    payload: payload ?? null,
  } as any);
}

export function useAgentPresence() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const { data: presence, isLoading: presenceLoading } = useQuery({
    queryKey: ["agent_presence", tid, userId],
    enabled: !!tid && !!userId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_agent_presence")
        .select("*")
        .eq("tenant_id", tid!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as unknown as AgentPresence;

      const { data: created, error: insertErr } = await supabase
        .from("support_agent_presence")
        .insert({ tenant_id: tid!, user_id: userId!, status: "off" })
        .select()
        .single();
      if (insertErr) {
        const { data: retry } = await supabase
          .from("support_agent_presence")
          .select("*")
          .eq("tenant_id", tid!)
          .eq("user_id", userId!)
          .maybeSingle();
        return (retry as unknown as AgentPresence) ?? null;
      }
      return created as unknown as AgentPresence;
    },
  });

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

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["agent_presence", tid, userId] });
  }, [queryClient, tid, userId]);

  useEffect(() => {
    if (!tid || !userId) return;
    const channel = supabase
      .channel(`agent-presence-${userId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "support_agent_presence",
        filter: `user_id=eq.${userId}`,
      }, () => invalidate())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tid, userId, invalidate]);

  const updatePresence = useCallback(
    async (payload: Partial<AgentPresence>) => {
      if (!tid || !userId) return;
      const { error } = await supabase
        .from("support_agent_presence")
        .update({ ...payload, updated_at: new Date().toISOString() } as any)
        .eq("tenant_id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      invalidate();
    },
    [tid, userId, invalidate]
  );

  // ── Actions with event logging ──

  const startShift = useCallback(async () => {
    if (!tid || !userId) return;
    await updatePresence({
      status: "active" as AgentStatus,
      shift_started_at: new Date().toISOString(),
      shift_ended_at: null,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    await logEvent(tid, userId, "shift_start");
  }, [updatePresence, tid, userId]);

  const setActive = useCallback(async () => {
    if (!tid || !userId) return;
    const wasPaused = presence?.status === "paused";
    await updatePresence({
      status: "active" as AgentStatus,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    if (wasPaused) {
      await logEvent(tid, userId, "pause_end");
    }
  }, [updatePresence, tid, userId, presence?.status]);

  const setPaused = useCallback(
    async (reasonId: string) => {
      if (!tid || !userId) return;
      const reason = pauseReasons.find((r) => r.id === reasonId);
      const avgMin = reason?.average_minutes ?? 15;
      const now = new Date();
      const expectedEnd = new Date(now.getTime() + avgMin * 60_000);
      await updatePresence({
        status: "paused" as AgentStatus,
        pause_reason_id: reasonId,
        pause_started_at: now.toISOString(),
        pause_expected_end_at: expectedEnd.toISOString(),
      });
      await logEvent(tid, userId, "pause_start", reasonId, {
        reason_name: reason?.name,
        average_minutes: avgMin,
      });
    },
    [updatePresence, pauseReasons, tid, userId]
  );

  const extendPause = useCallback(async () => {
    if (!tid || !userId || !presence?.pause_reason_id) return;
    const reason = pauseReasons.find((r) => r.id === presence.pause_reason_id);
    const avgMin = reason?.average_minutes ?? 15;
    const now = new Date();
    const expectedEnd = new Date(now.getTime() + avgMin * 60_000);
    await updatePresence({
      pause_started_at: now.toISOString(),
      pause_expected_end_at: expectedEnd.toISOString(),
    });
    await logEvent(tid, userId, "pause_extend", presence.pause_reason_id, {
      reason_name: reason?.name,
      average_minutes: avgMin,
    });
  }, [updatePresence, presence?.pause_reason_id, pauseReasons, tid, userId]);

  // Simple end shift (no attendances)
  const endShift = useCallback(async () => {
    if (!tid || !userId) return;
    await updatePresence({
      status: "off" as AgentStatus,
      shift_ended_at: new Date().toISOString(),
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    await logEvent(tid, userId, "shift_end");
  }, [updatePresence, tid, userId]);

  // ── Fetch active attendances count ──
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

  // ── Release to queue + end shift ──
  const releaseToQueueAndEndShift = useCallback(async (attendanceIds: string[]) => {
    if (!tid || !userId) return;
    const now = new Date().toISOString();

    // Release attendances to queue
    if (attendanceIds.length > 0) {
      const { error } = await supabase
        .from("support_attendances")
        .update({
          status: "waiting",
          assigned_to: null,
          assumed_at: null,
          updated_at: now,
        } as any)
        .in("id", attendanceIds);
      if (error) throw error;

      await logEvent(tid, userId, "shift_end_release_to_queue", null, {
        count: attendanceIds.length,
        attendance_ids: attendanceIds,
      });
    }

    // End shift
    await updatePresence({
      status: "off" as AgentStatus,
      shift_ended_at: now,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    await logEvent(tid, userId, "shift_end");

    // Invalidate attendances queries so sidebar refreshes
    queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
  }, [updatePresence, tid, userId, queryClient]);

  const status: AgentStatus = (presence?.status as AgentStatus) ?? "off";

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
    isBlocked: !isAdmin && status !== "active",
  };
}
