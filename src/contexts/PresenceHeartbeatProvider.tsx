import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { AgentPresence } from "@/hooks/useAgentPresence";

interface PresenceHeartbeatContextValue {
  isDegraded: boolean;
}

const PresenceHeartbeatContext = createContext<PresenceHeartbeatContextValue>({
  isDegraded: false,
});

const HEARTBEAT_INTERVAL_MS = 60_000;
const THROTTLE_MS = 20_000;
const DEGRADED_TOAST_ID = "presence-degraded";

export function PresenceHeartbeatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const [isDegraded, setIsDegraded] = useState(false);

  const lastSuccessRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const failureCountRef = useRef(0);
  const degradedRef = useRef(false);

  useEffect(() => {
    if (!tid || !userId) return;

    let cancelled = false;

    const sendHeartbeat = async () => {
      if (cancelled) return;
      // Guard: only heartbeat when presence exists and is not offline
      const presence = queryClient.getQueryData<AgentPresence | null | undefined>([
        "agent_presence",
        tid,
        userId,
      ]);
      if (!presence || presence.status === "offline") return;

      const now = Date.now();
      if (now - lastSuccessRef.current < THROTTLE_MS) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const { error } = await supabase.rpc("agent_presence_heartbeat", {
          p_tenant_id: tid,
        });
        if (error) throw error;
        lastSuccessRef.current = Date.now();
        failureCountRef.current = 0;
        if (degradedRef.current) {
          degradedRef.current = false;
          setIsDegraded(false);
          toast.dismiss(DEGRADED_TOAST_ID);
        }
      } catch (err) {
        failureCountRef.current += 1;
        console.warn("[presence] heartbeat failed:", err);
        if (failureCountRef.current >= 2 && !degradedRef.current) {
          degradedRef.current = true;
          setIsDegraded(true);
          toast.error(
            "Conexão de presença instável. Seu expediente pode ser encerrado automaticamente. Recarregue a página.",
            { id: DEGRADED_TOAST_ID, duration: Infinity }
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    // Fire immediately once guards pass
    void sendHeartbeat();

    const interval = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void sendHeartbeat();
    };
    const onFocus = () => void sendHeartbeat();
    const onOnline = () => void sendHeartbeat();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [tid, userId, queryClient]);

  return (
    <PresenceHeartbeatContext.Provider value={{ isDegraded }}>
      {children}
    </PresenceHeartbeatContext.Provider>
  );
}

export function usePresenceHeartbeat() {
  return useContext(PresenceHeartbeatContext);
}
