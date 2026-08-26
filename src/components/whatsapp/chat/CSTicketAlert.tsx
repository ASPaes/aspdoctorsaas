import { useState } from "react";
import { Ticket, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateCSTicketFromChat } from "./CreateCSTicketFromChat";
import { useChurnDismiss } from "../hooks/useChurnDismiss";
import { showsCSTicketAlert } from "@/lib/churnDismiss";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";

interface CSTicketAlertProps {
  sentiment: any;
  conversation: ConversationWithContact;
  variant?: "banner" | "inline";
  /** Atendimento ativo da conversa — âncora do descarte. */
  activeAttendanceId?: string | null;
  /** admin, head ou super admin. A RPC recusa os demais de qualquer forma. */
  canDismiss?: boolean;
}

export function CSTicketAlert({
  sentiment,
  conversation,
  variant = "banner",
  activeAttendanceId = null,
  canDismiss = false,
}: CSTicketAlertProps) {
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const { setDismissed, isSaving } = useChurnDismiss(conversation.id);

  if (!showsCSTicketAlert(sentiment, activeAttendanceId)) return null;

  return (
    <>
      <div className="flex items-center gap-1 w-full">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1.5 flex-1 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setTicketModalOpen(true)}
        >
          <Ticket className="h-3.5 w-3.5" />
          Abrir Ticket CS
        </Button>

        {canDismiss && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={isSaving}
                aria-label="Descartar risco de churn"
                className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDismissed(true)}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs max-w-[240px]">
              Descartar o risco de churn. O aviso some até este atendimento ser encerrado.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <CreateCSTicketFromChat
        open={ticketModalOpen}
        onOpenChange={setTicketModalOpen}
        conversation={conversation}
        sentiment={sentiment}
      />
    </>
  );
}
