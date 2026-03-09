import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserCheck, ArrowRightLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversationAssignment } from "../hooks/useConversationAssignment";

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

  const handleRelease = () => {
    unassignConversation(conversationId);
  };

  return (
    <div className="flex items-center gap-1.5">
      {isInQueue ? (
        <>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[10px] h-5">
            Na Fila
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleClaim}
            disabled={isAssigning}
          >
            {isAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
            Assumir
          </Button>
        </>
      ) : isAssignedToMe ? (
        <>
          <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-[10px] h-5">
            Comigo
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onTransferClick}
          >
            <ArrowRightLeft className="h-3 w-3" />
            Transferir
          </Button>
        </>
      ) : (
        <>
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 text-[10px] h-5">
            Atribuída
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onTransferClick}
          >
            <ArrowRightLeft className="h-3 w-3" />
            Transferir
          </Button>
        </>
      )}
    </div>
  );
}
