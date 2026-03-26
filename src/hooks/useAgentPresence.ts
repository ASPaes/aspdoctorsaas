import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export type PresenceStatus = "active" | "paused" | "offline";

export interface AgentPresence {
  user_id: string;
  tenant_id: string;
  status: string;
  pause_reason_id: string | null;
  pause_started_at: string | null;
  pause_expected_end_at: string | null;
  shift_started_at: string | null;
  shift_ended_at: string | null;
  updated_at: string;
}

export interface PauseReason {
  id: string;
  name: string;
  average_minutes: number;
  is_active: boolean;
  sort_order: number;
}

export function useAgentPresence() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  // Fetch or ensure presence record
  const { data: presence, isLoading } = useQuery({
    queryKey: ["agent-presence", userId, tid],
    enabled: !!userId && !!tid,
    refetchInterval: false,
    queryFn: async () => {
      // Try to get existing
      const { data, error } = await supabase
        .from("support_agent_presence")
        .select("*")
        .eq("user_id", userId!)
        .eq("tenant_id", tid!)
        .maybeSingle();

      if (error) throw error;
      if (data) return data as AgentPresence;

      // Create if not exists
      const { data: created, error: insertErr } = await supabase
        .from("support_agent_presence")
        .insert({ user_id: userId!, tenant_id: tid!, status: "offline" })
        .select()
        .single();

      if (insertErr) {
        // Race condition - try fetching again
        if (insertErr.code === "23505") {
          const { data: retry } = await supabase
            .from("support_agent_presence")
            .select("*")
            .eq("user_id", userId!)
            .eq("tenant_id", tid!)
            .single();
          return retry as AgentPresence;
        }
        throw insertErr;
      }
      return created as AgentPresence;
    },
  });

  // Fetch pause reasons
  const { data: pauseReasons = [] } = useQuery({
    queryKey: ["pause-reasons", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_pause_reasons")
        .select("id, name, average_minutes, is_active, sort_order")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as PauseReason[];
    },
  });

  // Subscribe to realtime changes on own presence
  useEffect(() => {
    if (!userId || !tid) return;

    const channel = supabase
      .channel(`agent-presence-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "support_agent_presence",
        filter: `user_id=eq.${userId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["agent-presence", userId, tid] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, tid, queryClient]);

  const logEvent = useCallback(async (eventType: string, reasonId?: string | null, payload?: Record<string, any>) => {
    if (!userId || !tid) return;
    await supabase.from("support_agent_presence_events").insert({
      tenant_id: tid,
      user_id: userId,
      event_type: eventType,
      pause_reason_id: reasonId ?? null,
      payload: payload ?? null,
    } as any);
  }, [userId, tid]);

  const updatePresence = useCallback(async (updates: Record<string, any>) => {
    if (!userId || !tid) return;
    await supabase
      .from("support_agent_presence")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("tenant_id", tid);
    queryClient.invalidateQueries({ queryKey: ["agent-presence", userId, tid] });
  }, [userId, tid, queryClient]);

  // Start shift
  const startShift = useCallback(async () => {
    await updatePresence({
      status: "active",
      shift_started_at: new Date().toISOString(),
      shift_ended_at: null,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    await logEvent("shift_start");
  }, [updatePresence, logEvent]);

  // Set active (resume from pause)
  const setActive = useCallback(async () => {
    await updatePresence({
      status: "active",
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
    await logEvent("pause_end");
  }, [updatePresence, logEvent]);

  // Pause
  const setPaused = useCallback(async (reasonId: string) => {
    const reason = pauseReasons.find(r => r.id === reasonId);
    const avgMin = reason?.average_minutes ?? 10;
    const expectedEnd = new Date(Date.now() + avgMin * 60_000).toISOString();

    await updatePresence({
      status: "paused",
      pause_reason_id: reasonId,
      pause_started_at: new Date().toISOString(),
      pause_expected_end_at: expectedEnd,
    });
    await logEvent("pause_start", reasonId, { average_minutes: avgMin });
  }, [updatePresence, logEvent, pauseReasons]);

  // Extend pause (restart timer with same reason)
  const extendPause = useCallback(async () => {
    if (!presence?.pause_reason_id) return;
    const reason = pauseReasons.find(r => r.id === presence.pause_reason_id);
    const avgMin = reason?.average_minutes ?? 10;
    const expectedEnd = new Date(Date.now() + avgMin * 60_000).toISOString();

    await updatePresence({
      pause_started_at: new Date().toISOString(),
      pause_expected_end_at: expectedEnd,
    });
    await logEvent("pause_extend", presence.pause_reason_id, { average_minutes: avgMin });
  }, [updatePresence, logEvent, presence, pauseReasons]);

  // End shift (with release to queue logic)
  const getInProgressAttendances = useCallback(async () => {
    if (!userId || !tid) return [];
    const { data } = await supabase
      .from("support_attendances")
      .select("id")
      .eq("tenant_id", tid)
      .eq("assigned_to", userId)
      .eq("status", "in_progress");
    return data ?? [];
  }, [userId, tid]);

  const releaseAndEndShift = useCallback(async (attendanceIds: string[]) => {
    if (!userId || !tid) return;

    if (attendanceIds.length > 0) {
      await supabase
        .from("support_attendances")
        .update({
          status: "waiting",
          assigned_to: null,
          assumed_at: null,
          updated_at: new Date().toISOString(),
        } as any)
        .in("id", attendanceIds);
    }

    await updatePresence({
      status: "offline",
      shift_ended_at: new Date().toISOString(),
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });

    await logEvent("shift_end_release_to_queue", null, {
      count: attendanceIds.length,
      attendance_ids: attendanceIds,
    });
    await logEvent("shift_end");

    // Invalidate attendances cache
    queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
  }, [userId, tid, updatePresence, logEvent, queryClient]);

  const status: PresenceStatus = (presence?.status === "active" || presence?.status === "paused")
    ? presence.status as PresenceStatus
    : "offline";

  const isBlocked = !isAdmin && status !== "active";

  return {
    presence,
    status,
    isLoading,
    isAdmin,
    isBlocked,
    pauseReasons,
    startShift,
    setActive,
    setPaused,
    extendPause,
    getInProgressAttendances,
    releaseAndEndShift,
  };
}
