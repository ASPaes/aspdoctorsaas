import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Check, CheckCheck } from "lucide-react";
import { useMessages, type Message } from "./hooks/useMessages";
import { MessageInput } from "./MessageInput";
import { type Conversation } from "./hooks/useConversations";
import { cn } from "@/lib/utils";
import { MediaContent } from "./chat/MediaContent";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatTime as formatTzTime, formatDateLabel } from "@/lib/formatDateWithTimezone";

interface Props {
  conversation: Conversation | null;
}

function MessageBubbleInline({ msg, timezone }: { msg: Message; timezone: string }) {
  const isMe = msg.is_from_me;
  const time = formatTzTime(msg.timestamp, timezone);

  const statusIcon = isMe && (
    msg.status === "read" || msg.status === "delivered" ? (
      <CheckCheck className={cn("h-3 w-3", msg.status === "read" ? "text-blue-400" : "text-muted-foreground/60")} />
    ) : (
      <Check className="h-3 w-3 text-muted-foreground/60" />
    )
  );

  return (
    <div className={cn("flex mb-1", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-1.5 text-sm",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        {msg.media_url && msg.message_type !== "text" && (
          <MediaContent messageType={msg.message_type} mediaUrl={msg.media_url} metadata={msg.metadata} />
        )}
        {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        <div className={cn("flex items-center gap-1 mt-0.5", isMe ? "justify-end" : "justify-start")}>
          <span className="text-[10px] opacity-60">{time}</span>
          {statusIcon}
        </div>
      </div>
    </div>
  );
}

function groupByDateInline(messages: Message[], timezone: string): { date: string; msgs: Message[] }[] {
  const groups: Record<string, Message[]> = {};
  for (const msg of messages) {
    const d = formatDateLabel(msg.timestamp, timezone);
    (groups[d] ??= []).push(msg);
  }
  return Object.entries(groups).map(([date, msgs]) => ({ date, msgs }));
}

export function ChatArea({ conversation }: Props) {
  const { data: messages = [], isLoading } = useMessages(conversation?.id ?? null);
  const { timezone } = useChatTimezone();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <MessageSquare className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Selecione uma conversa</p>
        <p className="text-sm mt-1">Escolha uma conversa na lista para começar</p>
      </div>
    );
  }

  const dateGroups = groupByDate(messages);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {conversation.contact_name || conversation.contact_phone}
          </p>
          {conversation.contact_name && (
            <p className="text-xs text-muted-foreground truncate">{conversation.contact_phone}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-2">
        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                <Skeleton className={cn("h-10 rounded-lg", i % 2 === 0 ? "w-48" : "w-36")} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          dateGroups.map(({ date, msgs }) => (
            <div key={date}>
              <div className="flex justify-center my-3">
                <span className="text-[10px] bg-muted text-muted-foreground px-3 py-0.5 rounded-full">
                  {date}
                </span>
              </div>
              {msgs.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input */}
      <MessageInput conversationId={conversation.id} />
    </div>
  );
}
