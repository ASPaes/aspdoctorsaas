import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

/** Allowed presence statuses — must match DB check constraint */
export type AgentStatus = "active" | "paused" | "offline";

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

const presenceChannels = new Map<
  string,
  { channel: RealtimeChannel; refCount: number; listeners: Set<() => void> }
>();

/**
 * Fonte única da linha de presença do usuário atual.
 * - Uma queryKey e um canal realtime compartilhados em toda a aplicação.
 * - queryFn é SOMENTE LEITURA (não cria linha em support_agent_presence).
 *   A linha é criada pelo RPC agent_presence_set_active ("Iniciar expediente").
 */
export function usePresenceRow(options?: { refetchInterval?: number }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data: presence, isLoading: presenceLoading } = useQuery({
    queryKey: ["agent_presence", tid, userId],
    enabled: !!tid && !!userId,
    // 60s é a cadência de quem mostra o cronômetro de pausa na tela. Quem só
    // precisa saber "estou pausado?" (o alerta de fila, montado no layout
    // inteiro) passa um intervalo longo — senão este poll passaria a rodar em
    // TODAS as telas do sistema. O react-query usa o menor intervalo entre os
    // observadores montados, então o Chat não perde nada.
    refetchInterval: options?.refetchInterval ?? 60_000,
    queryFn: async (): Promise<AgentPresence | null> => {
      const { data, error } = await supabase
        .from("support_agent_presence")
        .select("*")
        .eq("tenant_id", tid!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as AgentPresence) ?? null;
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["agent_presence", tid, userId] });
    queryClient.invalidateQueries({ queryKey: ["team_presence", tid] });
  }, [queryClient, tid, userId]);

  useEffect(() => {
    if (!tid || !userId) return;
    const key = `agent-presence-${userId}`;
    let entry = presenceChannels.get(key);
    if (!entry) {
      const listeners = new Set<() => void>();
      const channel = supabase
        .channel(key)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "support_agent_presence",
          filter: `user_id=eq.${userId}`,
        }, () => {
          listeners.forEach((fn) => fn());
        });
      channel.subscribe();
      entry = { channel, refCount: 0, listeners };
      presenceChannels.set(key, entry);
    }
    entry.refCount += 1;
    entry.listeners.add(invalidate);
    return () => {
      const e = presenceChannels.get(key);
      if (!e) return;
      e.listeners.delete(invalidate);
      e.refCount -= 1;
      if (e.refCount <= 0) {
        supabase.removeChannel(e.channel);
        presenceChannels.delete(key);
      }
    };
  }, [tid, userId, invalidate]);

  return { presence: presence ?? null, presenceLoading, invalidate };
}
