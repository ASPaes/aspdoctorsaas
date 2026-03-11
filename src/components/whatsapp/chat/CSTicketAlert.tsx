import { useState } from "react";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px] gap-1.5 w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setTicketModalOpen(true)}
      >
        <Ticket className="h-3.5 w-3.5" />
        Abrir Ticket CS
      </Button>

      <CreateCSTicketFromChat
        open={ticketModalOpen}
        onOpenChange={setTicketModalOpen}
        conversation={conversation}
        sentiment={sentiment}
      />
    </>
  );
}
