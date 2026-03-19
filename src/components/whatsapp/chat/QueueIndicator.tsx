import { Button } from "@/components/ui/button";
import { UserCheck, ArrowRightLeft, Loader2, Users, User, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversationAssignment } from "../hooks/useConversationAssignment";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface QueueIndicatorProps {
  conversationId: string;
  assignedTo: string | null;
  onTransferClick: () => void;
}

export function QueueIndicator({ conversationId, assignedTo, onTransferClick }: QueueIndicatorProps) {
  const { user, profile } = useAuth();
  const { assignConversation, unassignConversation, isAssigning } = useConversationAssignment();

  // Use attendance status as source of truth (it updates via realtime)
  const { attendanceMap } = useAttendanceStatus([conversationId]);
  const attendance = attendanceMap.get(conversationId);

  // Determine effective assignment from attendance (more accurate) or fallback to conversation prop
  const effectiveAssignedTo = attendance?.assigned_to ?? assignedTo;
  const effectiveStatus = attendance?.status;

  const isAssignedToMe = effectiveAssignedTo === user?.id;
  // Only show as "queue" if status=waiting AND no one is assigned
  const isInQueue = effectiveStatus === "waiting" && !effectiveAssignedTo;
  const isInProgress = effectiveStatus === "in_progress";

  // Department guard: user can only claim if conversation belongs to their department
  const { userDepartmentId, canSeeAllDepartments } = useDepartmentFilter();
  const convDeptId = attendance?.department_id;
  const isInUserDepartment = canSeeAllDepartments || !convDeptId || convDeptId === userDepartmentId;

  const handleClaim = () => {
    if (!user?.id) return;
    assignConversation({ conversationId, assignedTo: user.id, reason: "Assumido manualmente" });
  };

  // Chip display
  const chipConfig = isInQueue
    ? { icon: Users, label: "Na fila", className: "bg-warning/10 text-warning border-warning/20" }
    : isAssignedToMe && isInProgress
      ? { icon: User, label: "Comigo", className: "bg-primary/10 text-primary border-primary/20" }
      : isAssignedToMe
        ? { icon: Clock, label: "Comigo (fila)", className: "bg-primary/10 text-primary border-primary/20" }
        : effectiveAssignedTo
          ? { icon: UserCheck, label: "Atribuída", className: "bg-accent/10 text-accent border-accent/20" }
          : { icon: Users, label: "Sem atendimento", className: "bg-muted text-muted-foreground border-border" };

  const ChipIcon = chipConfig.icon;

  // Assumir button: only when in queue (waiting + no assigned_to)
  const canClaim = isInQueue && !isAssignedToMe && isInUserDepartment;

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
          disabled={isAssigning}
        >
          {isAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
          Assumir
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 rounded-full"
          onClick={onTransferClick}
        >
          <ArrowRightLeft className="h-3 w-3" />
          <span className="hidden md:inline">Transferir</span>
        </Button>
      )}
    </div>
  );
}
