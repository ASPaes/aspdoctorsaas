import { useState } from "react";
import { ConversationsSidebar } from "@/components/whatsapp/conversations/ConversationsSidebar";
import { ChatAreaFull } from "@/components/whatsapp/chat/ChatAreaFull";
import type { ConversationWithContact } from "@/components/whatsapp/hooks/useWhatsAppConversations";
import { useIsMobile } from "@/hooks/use-mobile";

export default function WhatsApp() {
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);
  const isMobile = useIsMobile();

  // Mobile: show either sidebar or chat
  if (isMobile) {
    if (selected) {
      return (
        <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
          <ChatAreaFull conversation={selected} onClose={() => setSelected(null)} />
        </div>
      );
    }
    return (
      <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
        <div className="w-full h-full">
          <ConversationsSidebar selectedId={null} onSelect={setSelected} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
      <ConversationsSidebar selectedId={selected?.id ?? null} onSelect={setSelected} />
      <ChatAreaFull conversation={selected} />
    </div>
  );
}
