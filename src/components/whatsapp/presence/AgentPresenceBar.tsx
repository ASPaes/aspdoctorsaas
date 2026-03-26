import { useState, useEffect, useCallback } from "react";
import { useAgentPresence, type AgentStatus } from "@/hooks/useAgentPresence";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Play,
  Pause,
  Clock,
  ChevronDown,
  LogOut,
  RotateCcw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AgentPresenceBar() {
  const {
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
    isBlocked,
  } = useAgentPresence();

  const [remaining, setRemaining] = useState<number>(0);
  const [timerExpired, setTimerExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  // Timer countdown
  useEffect(() => {
    if (status !== "paused" || !presence?.pause_expected_end_at) {
      setRemaining(0);
      setTimerExpired(false);
      return;
    }

    const update = () => {
      const end = new Date(presence.pause_expected_end_at!).getTime();
      const diff = end - Date.now();
      setRemaining(Math.max(0, diff));
      if (diff <= 0) setTimerExpired(true);
      else setTimerExpired(false);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [status, presence?.pause_expected_end_at]);

  const wrap = useCallback(
    async (fn: () => Promise<void>, successMsg?: string) => {
      setLoading(true);
      try {
        await fn();
        if (successMsg) toast.success(successMsg);
      } catch (err: any) {
        toast.error(err.message || "Erro ao atualizar status");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  if (presenceLoading || !presence) return null;

  const statusConfig: Record<AgentStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
    active: { label: "Ativo", variant: "default", icon: <Zap className="h-3 w-3" /> },
    paused: { label: "Em pausa", variant: "secondary", icon: <Pause className="h-3 w-3" /> },
    off: { label: "Offline", variant: "outline", icon: <LogOut className="h-3 w-3" /> },
  };

  const cfg = statusConfig[status];

  // Pause reason name
  const currentReasonName = status === "paused" && presence.pause_reason_id
    ? pauseReasons.find((r) => r.id === presence.pause_reason_id)?.name
    : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border shrink-0">
      {/* Status badge */}
      <Badge variant={cfg.variant} className="gap-1 text-xs font-medium">
        {cfg.icon}
        {cfg.label}
      </Badge>

      {/* Pause info */}
      {status === "paused" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {currentReasonName && (
            <span className="hidden sm:inline">• {currentReasonName}</span>
          )}
          <span className="flex items-center gap-1 font-mono">
            <Clock className="h-3 w-3" />
            {timerExpired ? "Expirado" : formatCountdown(remaining)}
          </span>
        </div>
      )}

      {/* Timer expired actions */}
      {status === "paused" && timerExpired && (
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            disabled={loading}
            onClick={() => wrap(setActive, "Voltou ao ativo!")}
          >
            <Play className="h-3 w-3 mr-1" />
            Voltar ao ativo
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={loading}
            onClick={() => wrap(extendPause, "Pausa estendida")}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Estender
          </Button>
        </div>
      )}

      {/* Normal actions */}
      {!(status === "paused" && timerExpired) && (
        <div className="flex items-center gap-1 ml-auto">
          {status === "off" && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              disabled={loading}
              onClick={() => wrap(startShift, "Expediente iniciado!")}
            >
              <Play className="h-3 w-3 mr-1" />
              Iniciar expediente
            </Button>
          )}

          {status === "active" && (
            <>
              {/* Pause dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={loading}>
                    <Pause className="h-3 w-3 mr-1" />
                    Pausar
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">Motivo da pausa</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {pauseReasons.length === 0 ? (
                    <DropdownMenuItem disabled>Nenhum motivo cadastrado</DropdownMenuItem>
                  ) : (
                    pauseReasons.map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        onClick={() => wrap(() => setPaused(r.id), `Pausado: ${r.name}`)}
                      >
                        <span>{r.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{r.average_minutes} min</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* End shift */}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                disabled={loading}
                onClick={() => wrap(endShift, "Expediente encerrado")}
              >
                <LogOut className="h-3 w-3 mr-1" />
                Encerrar
              </Button>
            </>
          )}

          {status === "paused" && !timerExpired && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              disabled={loading}
              onClick={() => wrap(setActive, "Voltou ao ativo!")}
            >
              <Play className="h-3 w-3 mr-1" />
              Voltar ao ativo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
