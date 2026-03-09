import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { MessageBubble } from "./MessageBubble";
import { useWhatsAppMessages, type Message } from "../hooks/useWhatsAppMessages";

interface Props {
  conversationId: string;
  onReply?: (msg: Message) => void;
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

export function ChatMessages({ conversationId, onReply }: Props) {
  const { messages, isLoading } = useWhatsAppMessages(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (isLoading) {
    return (
      <ScrollArea className="flex-1 px-4 py-2">
        <div className="space-y-3 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
              <Skeleton className={cn("h-10 rounded-lg", i % 2 === 0 ? "w-48" : "w-36")} />
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  const dateGroups = groupByDate(messages);

  return (
    <ScrollArea className="flex-1 px-4 py-2">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <p className="text-sm">Nenhuma mensagem ainda</p>
        </div>
      ) : (
        dateGroups.map(({ date, msgs }) => (
          <div key={date}>
            <div className="flex justify-center my-3">
              <span className="text-[10px] bg-muted text-muted-foreground px-3 py-0.5 rounded-full">{date}</span>
            </div>
            {msgs.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} onReply={onReply} />
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </ScrollArea>
  );
}
