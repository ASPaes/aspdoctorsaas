import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

export interface TeamMemberPresence {
  user_id: string;
  status: string;
  pause_started_at: string | null;
  pause_expected_end_at: string | null;
  last_heartbeat_at: string | null;
  pause_reason_name: string | null;
  agent_name: string;
  agent_email: string | null;
}

export function useTeamPresence() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team_presence", tid],
    enabled: !!tid && !!isAdmin,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data: presenceRows, error: pErr } = await supabase
        .from("support_agent_presence")
        .select("user_id, status, pause_started_at, pause_expected_end_at, last_heartbeat_at, pause_reason_id")
        .eq("tenant_id", tid!);
      if (pErr) throw pErr;
      if (!presenceRows || presenceRows.length === 0) return [];

      const reasonIds = presenceRows
        .map((r) => r.pause_reason_id)
        .filter(Boolean) as string[];

      let reasonMap: Record<string, string> = {};
      if (reasonIds.length > 0) {
        const { data: reasons } = await supabase
          .from("support_pause_reasons")
          .select("id, name")
          .in("id", reasonIds);
        if (reasons) {
          reasonMap = Object.fromEntries(reasons.map((r) => [r.id, r.name]));
        }
      }

      const userIds = presenceRows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .in("user_id", userIds);

      const funcIds = (profiles || [])
        .map((p) => p.funcionario_id)
        .filter(Boolean) as number[];

      let funcMap: Record<number, { nome: string; email: string | null }> = {};
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase
          .from("funcionarios")
          .select("id, nome, email")
          .in("id", funcIds);
        if (funcs) {
          funcMap = Object.fromEntries(funcs.map((f) => [f.id, { nome: f.nome, email: f.email }]));
        }
      }

      const profileFuncMap = Object.fromEntries(
        (profiles || []).map((p) => [p.user_id, p.funcionario_id])
      );

      const result: TeamMemberPresence[] = presenceRows.map((row) => {
        const funcId = profileFuncMap[row.user_id];
        const func = funcId ? funcMap[funcId] : null;
        return {
          user_id: row.user_id,
          status: row.status,
          pause_started_at: row.pause_started_at,
          pause_expected_end_at: row.pause_expected_end_at,
          last_heartbeat_at: row.last_heartbeat_at,
          pause_reason_name: row.pause_reason_id ? reasonMap[row.pause_reason_id] || null : null,
          agent_name: func?.nome || row.user_id.slice(0, 8),
          agent_email: func?.email || null,
        };
      });

      const statusOrder: Record<string, number> = { paused: 0, active: 1, offline: 2 };
      result.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

      return result;
    },
  });

  // Realtime subscription for instant updates across browsers
  useEffect(() => {
    if (!tid || !isAdmin) return;

    const channel = supabase
      .channel(`team-presence-${tid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_agent_presence",
          filter: `tenant_id=eq.${tid}`,
        },
        () => {
          // Refetch full query to resolve names/reasons properly
          queryClient.invalidateQueries({ queryKey: ["team_presence", tid] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tid, isAdmin, queryClient]);

  return { members, isLoading, isAdmin: !!isAdmin };
}
