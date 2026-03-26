import { useState, useCallback } from "react";
import { useAgentPresence, type AgentStatus } from "@/hooks/useAgentPresence";
import { usePauseTimer, formatCountdown } from "@/hooks/usePauseTimer";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Play,
  Pause,
  Clock,
  ChevronDown,
  LogOut,
  RotateCcw,
  Zap,
  Loader2,
  Timer,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

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
    fetchActiveAttendances,
    releaseToQueueAndEndShift,
    isBlocked,
  } = useAgentPresence();

  const [loading, setLoading] = useState(false);

  // End-shift modal state
  const [endShiftModalOpen, setEndShiftModalOpen] = useState(false);
  const [pendingAttendanceIds, setPendingAttendanceIds] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [releasing, setReleasing] = useState(false);

  // Pause timer with total/remaining/exceeded
  const { pausedTotalMs, remainingMs, exceededMs, timerExpired } = usePauseTimer(
    status,
    presence?.pause_started_at,
    presence?.pause_expected_end_at
  );

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

  // Handle "Encerrar expediente" click
  const handleEndShiftClick = useCallback(async () => {
    setLoading(true);
    try {
      const { count, ids } = await fetchActiveAttendances();
      if (count > 0) {
        setPendingAttendanceIds(ids);
        setPendingCount(count);
        setEndShiftModalOpen(true);
      } else {
        await endShift();
        toast.success("Expediente encerrado");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao verificar atendimentos");
    } finally {
      setLoading(false);
    }
  }, [fetchActiveAttendances, endShift]);

  // Confirm release + end shift
  const handleConfirmRelease = useCallback(async () => {
    setReleasing(true);
    try {
      await releaseToQueueAndEndShift(pendingAttendanceIds);
      toast.success(`${pendingCount} atendimento(s) devolvido(s) à fila. Expediente encerrado.`);
      setEndShiftModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao devolver atendimentos");
    } finally {
      setReleasing(false);
    }
  }, [releaseToQueueAndEndShift, pendingAttendanceIds, pendingCount]);

  if (presenceLoading || !presence) return null;

  const statusConfig: Record<AgentStatus, { label: string; variant: "default" | "secondary" | "outline"; icon: React.ReactNode }> = {
    active: { label: "Ativo", variant: "default", icon: <Zap className="h-3 w-3" /> },
    paused: { label: "Em pausa", variant: "secondary", icon: <Pause className="h-3 w-3" /> },
    offline: { label: "Offline", variant: "outline", icon: <LogOut className="h-3 w-3" /> },
  };

  const cfg = statusConfig[status];

  const currentReasonName = status === "paused" && presence.pause_reason_id
    ? pauseReasons.find((r) => r.id === presence.pause_reason_id)?.name
    : null;

  return (
    <>
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
            <Button size="sm" variant="default" className="h-7 text-xs" disabled={loading}
              onClick={() => wrap(setActive, "Voltou ao ativo!")}>
              <Play className="h-3 w-3 mr-1" />Voltar ao ativo
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={loading}
              onClick={() => wrap(extendPause, "Pausa estendida")}>
              <RotateCcw className="h-3 w-3 mr-1" />Estender
            </Button>
          </div>
        )}

        {/* Normal actions */}
        {!(status === "paused" && timerExpired) && (
          <div className="flex items-center gap-1 ml-auto">
            {status === "offline" && (
              <Button size="sm" variant="default" className="h-7 text-xs" disabled={loading}
                onClick={() => wrap(startShift, "Expediente iniciado!")}>
                <Play className="h-3 w-3 mr-1" />Iniciar expediente
              </Button>
            )}

            {status === "active" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={loading}>
                      <Pause className="h-3 w-3 mr-1" />Pausar<ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Motivo da pausa</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {pauseReasons.length === 0 ? (
                      <DropdownMenuItem disabled>Nenhum motivo cadastrado</DropdownMenuItem>
                    ) : (
                      pauseReasons.map((r) => (
                        <DropdownMenuItem key={r.id}
                          onClick={() => wrap(() => setPaused(r.id), `Pausado: ${r.name}`)}>
                          <span>{r.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{r.average_minutes} min</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                  disabled={loading} onClick={handleEndShiftClick}>
                  <LogOut className="h-3 w-3 mr-1" />Encerrar
                </Button>
              </>
            )}

            {status === "paused" && !timerExpired && (
              <Button size="sm" variant="default" className="h-7 text-xs" disabled={loading}
                onClick={() => wrap(setActive, "Voltou ao ativo!")}>
                <Play className="h-3 w-3 mr-1" />Voltar ao ativo
              </Button>
            )}
          </div>
        )}
      </div>

      {/* End-shift confirmation modal */}
      <AlertDialog open={endShiftModalOpen} onOpenChange={setEndShiftModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar expediente</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem <strong>{pendingCount}</strong> atendimento{pendingCount !== 1 ? "s" : ""} em andamento.
              Para encerrar seu expediente, {pendingCount !== 1 ? "eles serão devolvidos" : "ele será devolvido"} para a fila.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releasing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRelease} disabled={releasing}>
              {releasing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Devolver {pendingCount !== 1 ? "tudo" : ""} para a fila e encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
