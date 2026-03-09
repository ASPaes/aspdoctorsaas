import { useState } from "react";
import { ConversationList } from "@/components/whatsapp/ConversationList";
import { ChatArea } from "@/components/whatsapp/ChatArea";
import type { Conversation } from "@/components/whatsapp/hooks/useConversations";

export default function WhatsApp() {
  const [selected, setSelected] = useState<Conversation | null>(null);

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
      {/* Conversation List — fixed width */}
      <div className="w-80 shrink-0">
        <ConversationList selectedId={selected?.id ?? null} onSelect={setSelected} />
      </div>

      {/* Chat Area — fills remaining space */}
      <ChatArea conversation={selected} />
    </div>
  );
}
