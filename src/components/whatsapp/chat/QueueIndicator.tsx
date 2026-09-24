import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UserCheck, ArrowRightLeft, Loader2, Users, User, Clock, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { useAtendimentoClaim } from "../hooks/useAtendimentoClaim";
import { ClientBlockDialog } from "./ClientBlockDialog";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePortao } from "@/hooks/usePortao";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface QueueIndicatorProps {
  conversationId: string;
  assignedTo: string | null;
  onTransferClick: () => void;
  assignedOperatorName?: string | null;
  contactId?: string | null;
  clienteId?: string | null;
  /**
   * Celular: fica só a ação principal do momento (Assumir / Reabrir). Some o
   * chip de estado, que ali é redundante com o selo "Em Atendimento" da faixa
   * de contexto logo abaixo, e some o botão de transferir, que passa a viver no
   * menu de três pontos. Os dois juntos ocupavam ~70px da linha do cabeçalho —
   * medido em 22/09/2026: o nome do contato ficava com 81px em tela de 390px e
   * 60px em tela de 320px, e cortava até em nome curto.
   */
  compacto?: boolean;
}

export function QueueIndicator({ conversationId, assignedTo, onTransferClick, assignedOperatorName, contactId, clienteId, compacto }: QueueIndicatorProps) {
  const { user } = useAuth();

  // Use attendance status as source of truth (it updates via realtime)
  const { attendanceMap, isLoading: attendanceLoading } = useAttendanceStatus([conversationId], true);
  const attendance = attendanceMap.get(conversationId);

  // Só consideramos "em atendimento" quando o status é ATIVO (waiting/in_progress).
  // Um atendimento ENCERRADO não conta como atribuído a ninguém — senão o chip
  // mostra o dono antigo e o botão vira "assumir de outro" numa conversa já fechada.
  const ACTIVE_STATUSES = ["waiting", "in_progress"];
  const effectiveStatus = attendance?.status;
  const isActiveAttendance = !!effectiveStatus && ACTIVE_STATUSES.includes(effectiveStatus);

  const activeAssignedTo = isActiveAttendance ? (attendance?.assigned_to ?? null) : null;
  const isAssignedToMe = isActiveAttendance && attendance?.assigned_to === user?.id;
  // Only show as "queue" if status=waiting AND no one is assigned
  const isInQueue = effectiveStatus === "waiting" && !attendance?.assigned_to;
  const isInProgress = effectiveStatus === "in_progress";
  const isClosedOrNone = !isActiveAttendance; // encerrado, inativo ou sem atendimento

  // Department guard: user can only claim if conversation belongs to their department
  const { userDepartmentId, canSeeAllDepartments } = useDepartmentFilter();
  const convDeptId = attendance?.department_id;
  const isInUserDepartment = canSeeAllDepartments || !convDeptId || convDeptId === userDepartmentId;

  // antes: sem restrição — qualquer operador assumia/puxava da fila e transferia.
  // O portão entra em série com as regras atuais (presença, setor, bloqueio).
  const podeTransferir = usePortao("atendimento_transferir");

  // DEM-0464: portão, presença, bloqueio de cliente e a auditoria do override
  // moram no hook, porque o compositor bloqueado oferece o mesmo botão.
  const claim = useAtendimentoClaim({ conversationId, contactId, clienteId });
  const { podeAssumir, isBlocked, isPending, clientBlocks, hasHardBlock } = claim;

  const [takeoverDialogOpen, setTakeoverDialogOpen] = useState(false);

  // Takeover: assumir chat de outro operador do setor, após confirmação.
  // Reusa o hook para manter guards de presença e bloqueio de cliente.
  const handleConfirmTakeover = () => {
    setTakeoverDialogOpen(false);
    claim.pedirClaim();
  };

  // Chip display
  const chipConfig = isInQueue
    ? { icon: Users, label: "Na fila", className: "bg-warning/10 text-warning border-warning/20" }
    : isAssignedToMe && isInProgress
      ? { icon: User, label: assignedOperatorName ? `Comigo • ${assignedOperatorName}` : "Comigo", className: "bg-primary/10 text-primary border-primary/20" }
      : isAssignedToMe
        ? { icon: Clock, label: assignedOperatorName ? `Comigo • ${assignedOperatorName}` : "Comigo (fila)", className: "bg-primary/10 text-primary border-primary/20" }
        : activeAssignedTo
          ? { icon: UserCheck, label: assignedOperatorName ? `Atribuída • ${assignedOperatorName}` : "Atribuída", className: "bg-accent/10 text-accent border-accent/20" }
          : { icon: Users, label: "Sem atendimento", className: "bg-muted text-muted-foreground border-border" };

  const ChipIcon = chipConfig.icon;

  // Assumir: conversa na fila (waiting + sem dono)
  const canClaim = podeAssumir && isInQueue && !isAssignedToMe && isInUserDepartment;
  // Takeover: chat ATIVO com dono que não sou eu
  const canTakeOver = podeAssumir && !!activeAssignedTo && !isAssignedToMe && isInUserDepartment;
  // Reabrir: conversa encerrada / sem atendimento ativo (não-grupo). Gate no loading evita flash.
  const canReopen = podeAssumir && isClosedOrNone && isInUserDepartment && !attendanceLoading && !attendance?.is_group;

  return (
    <div className="flex items-center gap-1.5">
      {!compacto && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border select-none",
                chipConfig.className
              )}
            >
              <ChipIcon className="h-3 w-3" />
              <span className="hidden sm:inline">{chipConfig.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{chipConfig.label}</TooltipContent>
        </Tooltip>
      )}

      {/* Primary action button */}
      {canClaim ? (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs gap-1.5 rounded-full"
          onClick={claim.pedirClaim}
          disabled={isPending || isBlocked}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
          Assumir
        </Button>
      ) : canReopen ? (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs gap-1.5 rounded-full"
          onClick={claim.pedirClaim}
          disabled={isPending || isBlocked}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          Reabrir
        </Button>
      ) : (
        <>
          {canTakeOver && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1.5 rounded-full"
              onClick={() => setTakeoverDialogOpen(true)}
              disabled={isPending || isBlocked}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
              Assumir
            </Button>
          )}
          {/* antes: sem restrição. No celular ele vive no menu de três pontos. */}
          {podeTransferir && !compacto && (
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={onTransferClick}
              aria-label="Transferir"
            >
              <ArrowRightLeft className="h-3 w-3" />
            </Button>
          )}
        </>
      )}


      <AlertDialog open={takeoverDialogOpen} onOpenChange={setTakeoverDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              Assumir atendimento
            </AlertDialogTitle>
            <AlertDialogDescription>
              {assignedOperatorName
                ? `${assignedOperatorName} está atendendo este chat.`
                : "Outro operador está atendendo este chat."}{" "}
              Deseja assumir e continuar o atendimento?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmTakeover}>Assumir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientBlockDialog
        open={claim.blockDialogOpen}
        onOpenChange={claim.setBlockDialogOpen}
        blocks={clientBlocks}
        hasHardBlock={hasHardBlock}
        onConfirm={claim.confirmarOverride}
      />
    </div>
  );
}
