import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import type { Message } from "../hooks/useWhatsAppMessages";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { DetailsSidebar } from "./DetailsSidebar";

interface Props {
  conversation: ConversationWithContact | null;
  onClose?: () => void;
}

export function ChatAreaFull({ conversation, onClose }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <MessageSquare className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Selecione uma conversa</p>
        <p className="text-sm mt-1">Escolha uma conversa na lista para começar</p>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <ChatHeader
          conversation={conversation}
          onToggleDetails={() => setShowDetails(!showDetails)}
          showDetails={showDetails}
          onClose={onClose}
        />
        <ChatMessages conversationId={conversation.id} onReply={setReplyTo} />
        <ChatInput
          conversationId={conversation.id}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      </div>

      {/* Details sidebar */}
      {showDetails && (
        <DetailsSidebar
          conversation={conversation}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
}
