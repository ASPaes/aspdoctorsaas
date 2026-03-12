import { Button } from "@/components/ui/button";
import { UserCheck, ArrowRightLeft, Loader2, Users, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversationAssignment } from "../hooks/useConversationAssignment";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface QueueIndicatorProps {
  conversationId: string;
  assignedTo: string | null;
  onTransferClick: () => void;
}

export function QueueIndicator({ conversationId, assignedTo, onTransferClick }: QueueIndicatorProps) {
  const { user } = useAuth();
  const { assignConversation, unassignConversation, isAssigning } = useConversationAssignment();

  const isAssignedToMe = assignedTo === user?.id;
  const isInQueue = !assignedTo;

  const handleClaim = () => {
    if (!user?.id) return;
    assignConversation({ conversationId, assignedTo: user.id, reason: "Assumido manualmente" });
  };

  // Chip display
  const chipConfig = isInQueue
    ? { icon: Users, label: "Na fila", className: "bg-warning/10 text-warning border-warning/20" }
    : isAssignedToMe
      ? { icon: User, label: "Comigo", className: "bg-primary/10 text-primary border-primary/20" }
      : { icon: UserCheck, label: "Atribuída", className: "bg-accent/10 text-accent border-accent/20" };

  const ChipIcon = chipConfig.icon;

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
      {isInQueue ? (
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
