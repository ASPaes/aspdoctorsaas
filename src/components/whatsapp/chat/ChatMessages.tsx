import { useEffect, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./MessageBubble";
import { useWhatsAppMessages, type Message } from "../hooks/useWhatsAppMessages";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatDateLabel, formatTime } from "@/lib/formatDateWithTimezone";
import { useConversationAssignmentHistory, type AssignmentEvent } from "../hooks/useConversationAssignmentHistory";
import { ArrowRightLeft } from "lucide-react";

function groupByDate(messages: Message[], timezone: string): { date: string; msgs: Message[] }[] {
  const groups: Record<string, Message[]> = {};
  for (const msg of messages) {
    const d = formatDateLabel(msg.timestamp, timezone);
    (groups[d] ??= []).push(msg);
  }
  return Object.entries(groups).map(([date, msgs]) => ({ date, msgs }));
}

interface Props {
  conversationId: string;
  onReply?: (msg: Message) => void;
}

type TimelineItem =
  | { type: 'message'; msg: Message }
  | { type: 'transfer'; event: AssignmentEvent };

export function ChatMessages({ conversationId, onReply }: Props) {
  const { messages, isLoading } = useWhatsAppMessages(conversationId);
  const { data: assignments } = useConversationAssignmentHistory(conversationId);
  const { timezone } = useChatTimezone();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Merge messages and assignment events into a single timeline
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = messages.map(msg => ({ type: 'message' as const, msg }));
    if (assignments) {
      for (const event of assignments) {
        items.push({ type: 'transfer' as const, event });
      }
    }
    items.sort((a, b) => {
      const tA = a.type === 'message' ? a.msg.timestamp : a.event.created_at;
      const tB = b.type === 'message' ? b.msg.timestamp : b.event.created_at;
      return new Date(tA).getTime() - new Date(tB).getTime();
    });
    return items;
  }, [messages, assignments]);

  // Group timeline items by date
  const dateGroups = useMemo(() => {
    const groups: { date: string; items: TimelineItem[] }[] = [];
    let currentDate = '';
    for (const item of timelineItems) {
      const ts = item.type === 'message' ? item.msg.timestamp : item.event.created_at;
      const d = formatDateLabel(ts, timezone);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [timelineItems, timezone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (isLoading) {

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
    <ScrollArea className="h-full px-4 py-2">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <p className="text-sm">Nenhuma mensagem ainda</p>
        </div>
      ) : (
        dateGroups.map(({ date, items }) => (
          <div key={date}>
            <div className="flex justify-center my-3">
              <span className="text-[10px] bg-muted text-muted-foreground px-3 py-0.5 rounded-full">{date}</span>
            </div>
            {items.map((item) =>
              item.type === 'message' ? (
                <MessageBubble key={item.msg.id} msg={item.msg} onReply={onReply} />
              ) : (
                <div key={`transfer-${item.event.id}`} className="flex justify-center my-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] bg-accent/50 text-accent-foreground px-3 py-1 rounded-full">
                    <ArrowRightLeft className="h-3 w-3" />
                    Transferido para {item.event.agent_name || 'Agente'}
                    {item.event.agent_role ? ` · ${item.event.agent_role}` : ''}
                    <span className="opacity-60 ml-1">{formatTime(item.event.created_at, timezone)}</span>
                  </span>
                </div>
              )
            )}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </ScrollArea>
    </div>
  );
}
