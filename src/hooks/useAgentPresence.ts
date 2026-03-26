import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export function useAgentPresence() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  // Fetch or ensure presence record exists
  const { data: presence, isLoading: presenceLoading } = useQuery({
    queryKey: ["agent_presence", tid, userId],
    enabled: !!tid && !!userId,
    refetchInterval: 30_000, // heartbeat-like polling
    queryFn: async () => {
      // Try to fetch existing
      const { data, error } = await supabase
        .from("support_agent_presence")
        .select("*")
        .eq("tenant_id", tid!)
        .eq("user_id", userId!)
        .maybeSingle();

      if (error) throw error;

      if (data) return data as unknown as AgentPresence;

      // Create default record
      const { data: created, error: insertErr } = await supabase
        .from("support_agent_presence")
        .insert({ tenant_id: tid!, user_id: userId!, status: "off" })
        .select()
        .single();

      if (insertErr) {
        // Maybe race condition, try fetching again
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

  // Fetch pause reasons
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

  // Realtime subscription
  useEffect(() => {
    if (!tid || !userId) return;

    const channel = supabase
      .channel(`agent-presence-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_agent_presence",
          filter: `user_id=eq.${userId}`,
        },
        () => invalidate()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tid, userId, invalidate]);

  // Mutations
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

  const startShift = useCallback(async () => {
    await updatePresence({
      status: "active" as AgentStatus,
      shift_started_at: new Date().toISOString(),
      shift_ended_at: null,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
  }, [updatePresence]);

  const setActive = useCallback(async () => {
    await updatePresence({
      status: "active" as AgentStatus,
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
  }, [updatePresence]);

  const setPaused = useCallback(
    async (reasonId: string) => {
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
    },
    [updatePresence, pauseReasons]
  );

  const extendPause = useCallback(async () => {
    if (!presence?.pause_reason_id) return;
    const reason = pauseReasons.find((r) => r.id === presence.pause_reason_id);
    const avgMin = reason?.average_minutes ?? 15;
    const now = new Date();
    const expectedEnd = new Date(now.getTime() + avgMin * 60_000);

    await updatePresence({
      pause_started_at: now.toISOString(),
      pause_expected_end_at: expectedEnd.toISOString(),
    });
  }, [updatePresence, presence?.pause_reason_id, pauseReasons]);

  const endShift = useCallback(async () => {
    await updatePresence({
      status: "off" as AgentStatus,
      shift_ended_at: new Date().toISOString(),
      pause_reason_id: null,
      pause_started_at: null,
      pause_expected_end_at: null,
    });
  }, [updatePresence]);

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
    isBlocked: !isAdmin && status !== "active",
  };
}
