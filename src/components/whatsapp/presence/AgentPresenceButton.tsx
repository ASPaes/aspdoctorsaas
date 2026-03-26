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
  Zap,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AgentPauseModal } from "./AgentPauseModal";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AgentPresenceButton() {
  const {
    presence,
    presenceLoading,
    status,
    pauseReasons,
    startShift,
    setActive,
    setPaused,
    endShift,
    fetchActiveAttendances,
    releaseToQueueAndEndShift,
    keepAssignmentsAndEndShift,
  } = useAgentPresence();

  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);

  // End-shift modal
  const [endShiftModalOpen, setEndShiftModalOpen] = useState(false);
  const [pendingAttendanceIds, setPendingAttendanceIds] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [releasing, setReleasing] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (status !== "paused" || !presence?.pause_expected_end_at) {
      setRemaining(0);
      return;
    }
    const update = () => {
      const diff = new Date(presence.pause_expected_end_at!).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [status, presence?.pause_expected_end_at]);

  const wrap = useCallback(async (fn: () => Promise<void>, successMsg?: string) => {
    setLoading(true);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar status");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleKeepAndEnd = useCallback(async () => {
    setReleasing(true);
    try {
      await keepAssignmentsAndEndShift(pendingAttendanceIds);
      toast.success("Expediente encerrado. Atendimentos mantidos.");
      setEndShiftModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao encerrar expediente");
    } finally {
      setReleasing(false);
    }
  }, [keepAssignmentsAndEndShift, pendingAttendanceIds]);

  const handlePauseConfirm = useCallback(async (reasonId: string, minutes: number) => {
    setLoading(true);
    try {
      await setPaused(reasonId, minutes);
      const reason = pauseReasons.find(r => r.id === reasonId);
      toast.success(`Pausado: ${reason?.name || "Pausa"}`);
      setPauseModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao pausar");
    } finally {
      setLoading(false);
    }
  }, [setPaused, pauseReasons]);

  if (presenceLoading || !presence) return null;

  const statusConfig: Record<AgentStatus, { label: string; dotClass: string; icon: React.ReactNode }> = {
    active: { label: "Ativo", dotClass: "bg-green-500", icon: <Zap className="h-3 w-3" /> },
    paused: { label: `Pausado ${formatCountdown(remaining)}`, dotClass: "bg-yellow-500", icon: <Pause className="h-3 w-3" /> },
    off: { label: "Offline", dotClass: "bg-muted-foreground/50", icon: <LogOut className="h-3 w-3" /> },
  };

  const cfg = statusConfig[status];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs font-medium" disabled={loading}>
            <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dotClass}`} />
            {cfg.label}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {status === "off" && (
            <DropdownMenuItem onClick={() => wrap(startShift, "Expediente iniciado!")}>
              <Play className="h-4 w-4 mr-2" /> Iniciar expediente
            </DropdownMenuItem>
          )}

          {status === "active" && (
            <>
              <DropdownMenuItem onClick={() => setPauseModalOpen(true)}>
                <Pause className="h-4 w-4 mr-2" /> Pausar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleEndShiftClick} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 mr-2" /> Encerrar expediente
              </DropdownMenuItem>
            </>
          )}

          {status === "paused" && (
            <>
              <DropdownMenuItem onClick={() => wrap(setActive, "Voltou ao ativo!")}>
                <Play className="h-4 w-4 mr-2" /> Voltar ao ativo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {remaining > 0 ? `Restante: ${formatCountdown(remaining)}` : "Tempo expirado"}
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Pause modal */}
      <AgentPauseModal
        open={pauseModalOpen}
        onOpenChange={setPauseModalOpen}
        pauseReasons={pauseReasons}
        onConfirm={handlePauseConfirm}
        loading={loading}
      />

      {/* End-shift confirmation */}
      <AlertDialog open={endShiftModalOpen} onOpenChange={setEndShiftModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar expediente</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem <strong>{pendingCount}</strong> atendimento{pendingCount !== 1 ? "s" : ""} em andamento.
              {pendingCount !== 1 ? " Eles serão devolvidos" : " Ele será devolvido"} para a fila.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releasing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRelease} disabled={releasing}>
              {releasing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Devolver para a fila e encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
