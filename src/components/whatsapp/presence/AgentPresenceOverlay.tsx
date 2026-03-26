import { useState, useCallback } from "react";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { usePauseTimer, formatCountdown } from "@/hooks/usePauseTimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Coffee, Clock, Plus, Loader2, Timer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function AgentPresenceOverlay() {
  const { status, isBlocked, presence, pauseReasons, startShift, setActive, extendPause } = useAgentPresence();
  const [loading, setLoading] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(15);

  // Pause timer with total/remaining/exceeded
  const { pausedTotalMs, remainingMs, exceededMs, timerExpired } = usePauseTimer(
    status,
    presence?.pause_started_at,
    presence?.pause_expected_end_at
  );

  if (!isBlocked) return null;

  const currentReasonName = status === "paused" && presence?.pause_reason_id
    ? pauseReasons.find(r => r.id === presence.pause_reason_id)?.name
    : null;

  const handleAction = async () => {
    setLoading(true);
    try {
      if (status === "offline") {
        await startShift();
        toast.success("Expediente iniciado!");
      } else {
        await setActive();
        toast.success("Voltou ao ativo!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro");
    } finally {
      setLoading(false);
    }
  };

  const handleExtend = async () => {
    setLoading(true);
    try {
      await extendPause(extendMinutes);
      toast.success(`Pausa estendida em ${extendMinutes} min`);
      setShowExtend(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao estender pausa");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
      <div className="text-center max-w-xs px-6 py-8 rounded-xl bg-card border border-border shadow-lg">
        <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Coffee className="w-7 h-7 text-muted-foreground" />
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-1">
          {status === "offline" ? "Expediente não iniciado" : "Você está em pausa"}
        </h3>

        {status === "paused" && currentReasonName && (
          <p className="text-sm text-muted-foreground mb-1">
            Motivo: <span className="font-medium text-foreground">{currentReasonName}</span>
          </p>
        )}

        {status === "paused" && (
          <div className="flex items-center justify-center gap-1.5 text-2xl font-mono text-foreground mb-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            {remaining > 0 ? formatCountdown(remaining) : "Expirado"}
          </div>
        )}

        {status === "offline" && (
          <p className="text-sm text-muted-foreground mb-5">
            Inicie seu expediente para atender conversas.
          </p>
        )}

        <div className="space-y-2">
          <Button onClick={handleAction} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {status === "offline" ? "Iniciar expediente" : "Voltar ao ativo"}
          </Button>

          {status === "paused" && !showExtend && (
            <Button variant="outline" onClick={() => setShowExtend(true)} disabled={loading} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Estender pausa
            </Button>
          )}

          {status === "paused" && showExtend && (
            <div className="flex items-center gap-2 mt-2">
              <Input
                type="number"
                min={1}
                max={480}
                value={extendMinutes}
                onChange={(e) => setExtendMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center"
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Button size="sm" onClick={handleExtend} disabled={loading}>
                {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                OK
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowExtend(false)} disabled={loading}>
                ✕
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
