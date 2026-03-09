import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Check, CheckCheck } from "lucide-react";
import { useMessages, type Message } from "./hooks/useMessages";
import { MessageInput } from "./MessageInput";
import { type Conversation } from "./hooks/useConversations";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Props {
  conversation: Conversation | null;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isMe = msg.is_from_me;
  const time = (() => {
    try { return format(new Date(msg.timestamp), "HH:mm"); } catch { return ""; }
  })();

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
        {msg.message_type === "image" && msg.media_url && (
          <img
            src={msg.media_url}
            alt="Imagem"
            className="rounded max-w-full mb-1 max-h-64 object-contain"
            loading="lazy"
          />
        )}
        {msg.message_type === "audio" && msg.media_url && (
          <audio controls className="max-w-full mb-1" preload="none">
            <source src={msg.media_url} />
          </audio>
        )}
        {msg.message_type === "video" && msg.media_url && (
          <video controls className="rounded max-w-full mb-1 max-h-64" preload="none">
            <source src={msg.media_url} />
          </video>
        )}
        {msg.message_type === "document" && msg.media_url && (
          <a
            href={msg.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-xs block mb-1"
          >
            📎 {(msg.metadata as any)?.fileName || "Documento"}
          </a>
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

function groupByDate(messages: Message[]): { date: string; msgs: Message[] }[] {
  const groups: Record<string, Message[]> = {};
  for (const msg of messages) {
    const d = (() => {
      try { return format(new Date(msg.timestamp), "dd/MM/yyyy"); } catch { return "—"; }
    })();
    (groups[d] ??= []).push(msg);
  }
  return Object.entries(groups).map(([date, msgs]) => ({ date, msgs }));
}

export function ChatArea({ conversation }: Props) {
  const { data: messages = [], isLoading } = useMessages(conversation?.id ?? null);
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
