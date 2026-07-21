import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserCheck, ArrowRightLeft, Loader2, Users, User, Clock, Ban, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversationAssignment } from "../hooks/useConversationAssignment";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useClientAlerts, resolveAlertsFor } from "@/hooks/useClientAlerts";
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
}

export function QueueIndicator({ conversationId, assignedTo, onTransferClick, assignedOperatorName, contactId, clienteId }: QueueIndicatorProps) {
  const { user, profile } = useAuth();
  const { claimConversation, unassignConversation, isAssigning, isClaiming } = useConversationAssignment();

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

  const { isBlocked } = useAgentPresence();

  // Bloqueios ativos do contato/cliente desta conversa
  const { data: allClientAlerts = [] } = useClientAlerts();
  const clientBlocks = resolveAlertsFor(allClientAlerts, { contactId, clienteId })
    .filter((a) => a.kind === "bloqueio");
  const hasHardBlock = clientBlocks.some((b) => b.block_behavior === "hard");
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [takeoverDialogOpen, setTakeoverDialogOpen] = useState(false);

  const doClaim = () => {
    if (!user?.id) return;
    claimConversation({ conversationId, reason: "Assumido manualmente" });
  };

  // Registra auditoria ao furar bloqueios "confirmação" e assume o atendimento.
  // Falha de log não impede o atendimento.
  const handleConfirmOverride = async () => {
    setBlockDialogOpen(false);
    if (user?.id && clientBlocks.length > 0) {
      const rows = clientBlocks.map((b) => ({
        tenant_id: b.tenant_id,
        alert_id: b.id,
        cliente_id: b.cliente_id,
        contact_id: b.contact_id,
        conversation_id: conversationId,
        action: "bloqueio_confirmado",
        alert_titulo: b.titulo,
        alert_kind: b.kind,
        alert_block_behavior: b.block_behavior,
        performed_by: user.id,
      }));
      try {
        await (supabase.from("client_alert_audit" as any) as any).insert(rows);
      } catch (e) {
        console.error("Falha ao registrar auditoria de bloqueio", e);
      }
    }
    doClaim();
  };

  const handleClaim = () => {
    if (!user?.id) return;
    if (isBlocked) {
      toast.warning("Você precisa estar Ativo para assumir atendimentos.");
      return;
    }
    if (clientBlocks.length > 0) {
      setBlockDialogOpen(true);
      return;
    }
    doClaim();
  };

  // Takeover: assumir chat de outro operador do setor, após confirmação.
  // Reusa handleClaim para manter guards de presença e bloqueio de cliente.
  const handleConfirmTakeover = () => {
    setTakeoverDialogOpen(false);
    handleClaim();
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
  const canClaim = isInQueue && !isAssignedToMe && isInUserDepartment;
  // Takeover: chat ATIVO com dono que não sou eu
  const canTakeOver = !!activeAssignedTo && !isAssignedToMe && isInUserDepartment;
  // Reabrir: conversa encerrada / sem atendimento ativo (não-grupo). Gate no loading evita flash.
  const canReopen = isClosedOrNone && isInUserDepartment && !attendanceLoading && !attendance?.is_group;

  return (
    <div className="flex items-center gap-1.5">
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

      {/* Primary action button */}
      {canClaim ? (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs gap-1.5 rounded-full"
          onClick={handleClaim}
          disabled={isAssigning || isClaiming || isBlocked}
        >
          {(isAssigning || isClaiming) ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
          Assumir
        </Button>
      ) : canReopen ? (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs gap-1.5 rounded-full"
          onClick={handleClaim}
          disabled={isAssigning || isClaiming || isBlocked}
        >
          {(isAssigning || isClaiming) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
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
              disabled={isAssigning || isClaiming || isBlocked}
            >
              {(isAssigning || isClaiming) ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
              Assumir
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onTransferClick}
            aria-label="Transferir"
          >
            <ArrowRightLeft className="h-3 w-3" />
          </Button>
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

      <AlertDialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-destructive" />
              {hasHardBlock ? "Atendimento bloqueado" : "Cliente com bloqueio"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {hasHardBlock
                    ? "Este cliente tem um bloqueio que impede assumir o atendimento:"
                    : "Este cliente tem um bloqueio. Confirme que está ciente antes de prosseguir:"}
                </p>
                <div className="space-y-2">
                  {clientBlocks.map((b) => (
                    <div key={b.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                      <p className="font-medium text-sm text-foreground">{b.titulo}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{b.mensagem}</p>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {hasHardBlock ? (
              <AlertDialogAction onClick={() => setBlockDialogOpen(false)}>Entendi</AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmOverride}>
                  Assumir mesmo assim
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
