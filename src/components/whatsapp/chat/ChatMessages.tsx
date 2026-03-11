import { useEffect, useRef, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./MessageBubble";
import { useWhatsAppMessages, type Message } from "../hooks/useWhatsAppMessages";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatDateLabel, formatTime } from "@/lib/formatDateWithTimezone";
import { useConversationAssignmentHistory, type AssignmentEvent } from "../hooks/useConversationAssignmentHistory";
import { ArrowRightLeft } from "lucide-react";

interface Props {
  conversationId: string;
  unreadCount?: number;
  onReply?: (msg: Message) => void;
  selectionMode?: boolean;
  selectedMessages?: Set<string>;
  onToggleSelect?: (msgId: string) => void;
  onDeleteSingle?: (msgId: string) => void;
  onForwardSingle?: (msgId: string) => void;
  onEnterSelectionMode?: (msgId: string) => void;
}

type TimelineItem =
  | { type: 'message'; msg: Message }
  | { type: 'transfer'; event: AssignmentEvent };

export function ChatMessages({
  conversationId,
  onReply,
  selectionMode,
  selectedMessages,
  onToggleSelect,
  onDeleteSingle,
  onForwardSingle,
  onEnterSelectionMode,
}: Props) {
  const { messages, isLoading } = useWhatsAppMessages(conversationId);
  const { data: assignments } = useConversationAssignmentHistory(conversationId);
  const { timezone } = useChatTimezone();
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToUnread, setHasScrolledToUnread] = useState(false);
  const prevConversationId = useRef(conversationId);

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

  // Reset scroll tracking when conversation changes
  useEffect(() => {
    if (conversationId !== prevConversationId.current) {
      setHasScrolledToUnread(false);
      prevConversationId.current = conversationId;
    }
  }, [conversationId]);

  // Scroll to bottom on new messages, or to first unread on initial load
  useEffect(() => {
    if (!messages.length) return;

    if (!hasScrolledToUnread) {
      // First load — scroll to first unread or bottom
      if (firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ behavior: "auto" });
      } else {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
      setHasScrolledToUnread(true);
    } else {
      // Subsequent messages — always scroll to bottom
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, hasScrolledToUnread]);

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full px-4 py-2">
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                <Skeleton className={cn("h-10 rounded-lg", i % 2 === 0 ? "w-48" : "w-36")} />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

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
                <MessageBubble
                  key={item.msg.id}
                  msg={item.msg}
                  onReply={onReply}
                  selectionMode={selectionMode}
                  isSelected={selectedMessages?.has(item.msg.id)}
                  onToggleSelect={onToggleSelect}
                  onDelete={onDeleteSingle}
                  onForward={onForwardSingle}
                  onEnterSelectionMode={onEnterSelectionMode}
                />
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
