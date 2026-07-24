import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { usePresenceRow } from "@/hooks/usePresenceRow";

interface PresenceHeartbeatContextValue {
  isDegraded: boolean;
}

const PresenceHeartbeatContext = createContext<PresenceHeartbeatContextValue>({
  isDegraded: false,
});

const HEARTBEAT_INTERVAL_MS = 60_000;
const THROTTLE_MS = 20_000;
const STALE_THRESHOLD_MS = 150_000; // 2,5 min sem heartbeat confirmado => degradado
const DEGRADED_TOAST_ID = "presence-degraded";

export function PresenceHeartbeatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { presence } = usePresenceRow();
  const userId = user?.id;

  const [isDegraded, setIsDegraded] = useState(false);

  const lastSuccessRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const failureCountRef = useRef(0);
  const degradedRef = useRef(false);
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  const markDegraded = () => {
    if (degradedRef.current) return;
    degradedRef.current = true;
    setIsDegraded(true);
    toast.error(
      "Conexão de presença instável. Seu expediente pode ser encerrado automaticamente. Recarregue a página.",
      { id: DEGRADED_TOAST_ID, duration: Infinity }
    );
  };

  const clearDegraded = () => {
    if (!degradedRef.current) return;
    degradedRef.current = false;
    setIsDegraded(false);
    toast.dismiss(DEGRADED_TOAST_ID);
  };

  useEffect(() => {
    if (!tid || !userId) return;

    let cancelled = false;

    const guardsPass = () => {
      const p = presenceRef.current;
      return !!p && p.status !== "offline";
    };

    const sendHeartbeat = async () => {
      if (cancelled) return;
      if (!guardsPass()) return;

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
        clearDegraded();
      } catch (err) {
        failureCountRef.current += 1;
        console.warn("[presence] heartbeat failed:", err);
        if (failureCountRef.current >= 2) markDegraded();
      } finally {
        inFlightRef.current = false;
      }
    };

    const tick = () => {
      if (!guardsPass()) return;
      // Watchdog: se ficou muito tempo sem sucesso, sinaliza degradado
      // mesmo sem erro explícito (guarda contra falha silenciosa).
      if (
        lastSuccessRef.current > 0 &&
        Date.now() - lastSuccessRef.current > STALE_THRESHOLD_MS
      ) {
        markDegraded();
      }
      void sendHeartbeat();
    };

    // Disparo imediato
    void sendHeartbeat();

    const interval = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);

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
  }, [tid, userId]);

  return (
    <PresenceHeartbeatContext.Provider value={{ isDegraded }}>
      {children}
    </PresenceHeartbeatContext.Provider>
  );
}

export function usePresenceHeartbeat() {
  return useContext(PresenceHeartbeatContext);
}
