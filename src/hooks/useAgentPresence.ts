import { useEffect, useCallback, useRef } from "react";
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

      // Row doesn't exist yet — create via RPC (set_active creates if needed, but we want "off")
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

  // ── Auto-activate only if no record exists + heartbeat every 30s ──
  const didAutoActivateRef = useRef(false);

  useEffect(() => {
    if (!tid || !userId) return;

    if (!didAutoActivateRef.current) {
      didAutoActivateRef.current = true;
      // Check if presence record already exists before activating
      supabase
        .from("support_agent_presence")
        .select("status")
        .eq("tenant_id", tid)
        .eq("user_id", userId)
        .maybeSingle()
        .then(({ data }) => {
          // Only auto-activate if no record exists or status is null/empty
          if (!data || !data.status) {
            supabase.rpc("agent_presence_set_active", { p_tenant_id: tid })
              .then(({ error }) => {
                if (error) console.warn("[presence] auto-activate failed:", error.message);
                else invalidate();
              });
          }
        });
    }

    const interval = setInterval(() => {
      supabase.rpc("agent_presence_heartbeat", { p_tenant_id: tid })
        .then(({ error }) => {
          if (error) console.warn("[presence] heartbeat failed:", error.message);
        });
    }, 30_000);

    return () => clearInterval(interval);
  }, [tid, userId, invalidate]);

  // ── RPC-based actions ──

  const startShift = useCallback(async () => {
    if (!tid) return;
    const { error } = await supabase.rpc("agent_presence_set_active", {
      p_tenant_id: tid,
    });
    if (error) throw error;
    invalidate();
  }, [tid, invalidate]);

  const setActive = useCallback(async () => {
    if (!tid) return;
    const { error } = await supabase.rpc("agent_presence_set_active", {
      p_tenant_id: tid,
    });
    if (error) throw error;
    invalidate();
  }, [tid, invalidate]);

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
    try {
      const { error } = await supabase.rpc("agent_presence_set_off", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      invalidate();
    } catch (err) {
      throw err;
    }
  }, [tid, invalidate]);

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
      // Log the event
      await supabase.from("support_agent_presence_events").insert({
        tenant_id: tid,
        user_id: userId,
        event_type: "shift_end_keep_assignments",
        payload: { count: attendanceIds.length, attendance_ids: attendanceIds },
      });
      // Just set off without touching attendances
      const { error } = await supabase.rpc("agent_presence_set_off", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      invalidate();
    } catch (err) {
      throw err;
    }
  }, [tid, userId, invalidate]);

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
    keepAssignmentsAndEndShift,
    isBlocked: !isAdmin && status !== "active",
  };
}
