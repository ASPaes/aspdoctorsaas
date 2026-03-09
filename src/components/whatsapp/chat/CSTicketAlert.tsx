import { useState } from "react";
import { AlertTriangle, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreateCSTicketFromChat } from "./CreateCSTicketFromChat";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";

interface CSTicketAlertProps {
  sentiment: any;
  conversation: ConversationWithContact;
  variant?: "banner" | "inline";
}

export function CSTicketAlert({ sentiment, conversation, variant = "banner" }: CSTicketAlertProps) {
  const [ticketModalOpen, setTicketModalOpen] = useState(false);

  if (!sentiment?.needs_cs_ticket || sentiment?.cs_ticket_created_id) return null;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
          "border-destructive/30 bg-destructive/10 text-destructive",
          variant === "banner" && "mx-4 mt-2"
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
        <span className="flex-1 min-w-0 truncate">
          {sentiment.cs_ticket_reason || "IA detectou necessidade de atenção do CS"}
        </span>
        <Button
          size="sm"
          variant="destructive"
          className="h-6 text-[10px] gap-1 shrink-0"
          onClick={() => setTicketModalOpen(true)}
        >
          <Ticket className="h-3 w-3" />
          Abrir Ticket CS
        </Button>
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
