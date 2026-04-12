import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./MessageBubble";
import { AttendanceEventBadge, parseAttendanceEvent } from "./AttendanceEventBadge";
import { useWhatsAppMessages, type Message } from "../hooks/useWhatsAppMessages";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { formatDateLabel, formatTime } from "@/lib/formatDateWithTimezone";
import { useConversationAssignmentHistory, type AssignmentEvent } from "../hooks/useConversationAssignmentHistory";
import { ArrowRightLeft, ChevronDown } from "lucide-react";

interface Props {
  conversationId: string;
  unreadCount?: number;
  lastMessageAt?: string | null;
  onReply?: (msg: Message) => void;
  selectionMode?: boolean;
  selectedMessages?: Set<string>;
  onToggleSelect?: (msgId: string) => void;
  onDeletePanelOnly?: (msgId: string) => void;
  onDeleteEveryone?: (msgId: string) => void;
  onRetryDelete?: (msgId: string) => void;
  onForwardSingle?: (msgId: string) => void;
  onEnterSelectionMode?: (msgId: string) => void;
  onContactChat?: (phone: string, name: string) => void;
  onContactSave?: (phone: string, name: string) => void;
  highlightMessageId?: string | null;
  onHighlightShown?: () => void;
}

type TimelineItem =
  | { type: 'message'; msg: Message }
  | { type: 'transfer'; event: AssignmentEvent };

const NEAR_BOTTOM_THRESHOLD = 150;

export function ChatMessages({
  conversationId,
  unreadCount = 0,
  lastMessageAt = null,
  onReply,
  selectionMode,
  selectedMessages,
  onToggleSelect,
  onDeletePanelOnly,
  onDeleteEveryone,
  onRetryDelete,
  onForwardSingle,
  onEnterSelectionMode,
  onContactChat,
  onContactSave,
  highlightMessageId,
  onHighlightShown,
}: Props) {
  const { messages, isLoading, onNewMessage } = useWhatsAppMessages(conversationId);
  const { data: assignments } = useConversationAssignmentHistory(conversationId);
  const { timezone } = useAppTimezone();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToUnread, setHasScrolledToUnread] = useState(false);
  const prevConversationId = useRef(conversationId);
  const lastRefetchedMessageAtRef = useRef<string | null>(null);

  // Smart scroll state
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const pendingNewCountRef = useRef(0);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    if (isNearBottomRef.current) {
      setShowNewMessages(false);
      pendingNewCountRef.current = 0;
    }
  }, []);

  // Fallback driven by conversation updates that already refresh the sidebar
  useEffect(() => {
    if (!conversationId || !lastMessageAt) return;
    if (lastRefetchedMessageAtRef.current === lastMessageAt) return;

    const latestKnownTimestamp = messages[messages.length - 1]?.timestamp ?? null;
    if (latestKnownTimestamp && new Date(lastMessageAt).getTime() <= new Date(latestKnownTimestamp).getTime()) {
      lastRefetchedMessageAtRef.current = lastMessageAt;
      return;
    }

    lastRefetchedMessageAtRef.current = lastMessageAt;
    if (import.meta.env.DEV) {
      console.log(`[realtime] fallback refetch conv=${conversationId} lastMessageAt=${lastMessageAt}`);
    }
    queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', conversationId] });
  }, [conversationId, lastMessageAt, messages, queryClient]);

  // Listen for new messages from realtime
  useEffect(() => {
    onNewMessage((msg: Message) => {
      if (msg.is_from_me) {
        // Always scroll to bottom for own messages
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        return;
      }
      if (!isNearBottomRef.current) {
        pendingNewCountRef.current += 1;
        setShowNewMessages(true);
      }
    });
  }, [onNewMessage]);

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

  // Compute the ID of the first unread incoming message
  const firstUnreadId = useMemo(() => {
    if (!unreadCount || unreadCount <= 0) return null;
    const incomingMessages = messages.filter(m => !m.is_from_me);
    if (incomingMessages.length <= 0) return null;
    const firstUnreadIdx = Math.max(0, incomingMessages.length - unreadCount);
    return incomingMessages[firstUnreadIdx]?.id ?? null;
  }, [messages, unreadCount]);

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
      setShowNewMessages(false);
      pendingNewCountRef.current = 0;
      isNearBottomRef.current = true;
      prevConversationId.current = conversationId;
    }
  }, [conversationId]);

  // Scroll to bottom on new messages (smart), or to first unread on initial load
  useEffect(() => {
    if (!messages.length) return;

    if (!hasScrolledToUnread) {
      if (firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ behavior: "auto" });
      } else {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
      setHasScrolledToUnread(true);
    } else if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, hasScrolledToUnread]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowNewMessages(false);
    pendingNewCountRef.current = 0;
  }, []);

  // Scroll to highlighted message (from message search)
  useEffect(() => {
    if (!highlightMessageId || isLoading) return;

    let attempts = 0;
    const maxAttempts = 10;

    const tryScroll = () => {
      attempts++;
      const el = document.querySelector(`[data-msg-id="${highlightMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-highlight-flash");
        setTimeout(() => {
          el.classList.remove("message-highlight-flash");
          onHighlightShown?.();
        }, 2500);
      } else if (attempts < maxAttempts) {
        setTimeout(tryScroll, 300);
      } else {
        // Mensagem não encontrada nos 500 carregados — limpa highlight
        onHighlightShown?.();
      }
    };

    const timer = setTimeout(tryScroll, 200);
    return () => clearTimeout(timer);
  }, [highlightMessageId, isLoading, messages]);

  // Inject highlight flash CSS
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes messageHighlightFlash {
        0% { background-color: transparent; }
        15% { background-color: rgba(250, 204, 21, 0.3); }
        85% { background-color: rgba(250, 204, 21, 0.3); }
        100% { background-color: transparent; }
      }
      .message-highlight-flash {
        animation: messageHighlightFlash 2.5s ease-in-out;
        border-radius: 0.5rem;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

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
    <div className="flex-1 min-h-0 overflow-hidden relative">
      <ScrollArea className="h-full px-4 py-2" onScrollCapture={handleScroll}>
        {/* Grab the viewport ref for scroll position detection */}
        <ScrollAreaViewportRef viewportRef={viewportRef} />
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
              {items.map((item) => {
                if (item.type === 'message') {
                  // Check if this is an attendance system event
                  const attendanceEvent = parseAttendanceEvent(item.msg);
                  if (attendanceEvent) {
                    return (
                      <AttendanceEventBadge
                        key={item.msg.id}
                        eventType={attendanceEvent.eventType}
                        attendanceCode={attendanceEvent.code}
                        timestamp={formatTime(item.msg.timestamp, timezone)}
                      />
                    );
                  }

                  return (
                    <div key={item.msg.id} data-msg-id={item.msg.id} ref={item.msg.id === firstUnreadId ? firstUnreadRef : undefined}>
                      {item.msg.id === firstUnreadId && (
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-primary/40" />
                          <span className="text-[10px] text-primary font-medium px-2">Mensagens não lidas</span>
                          <div className="flex-1 h-px bg-primary/40" />
                        </div>
                      )}
                      <MessageBubble
                        msg={item.msg}
                        onReply={onReply}
                        selectionMode={selectionMode}
                        isSelected={selectedMessages?.has(item.msg.id)}
                        onToggleSelect={onToggleSelect}
                        onDeletePanelOnly={onDeletePanelOnly}
                        onDeleteEveryone={onDeleteEveryone}
                        onRetryDelete={onRetryDelete}
                        onForward={onForwardSingle}
                        onEnterSelectionMode={onEnterSelectionMode}
                        onContactChat={onContactChat}
                        onContactSave={onContactSave}
                      />
                    </div>
                  );
                }

                return (
                  <div key={`transfer-${item.event.id}`} className="flex justify-center my-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] bg-accent/50 text-accent-foreground px-3 py-1 rounded-full">
                      <ArrowRightLeft className="h-3 w-3" />
                      Transferido para {item.event.agent_name || 'Agente'}
                      {item.event.agent_role ? ` · ${item.event.agent_role}` : ''}
                      <span className="opacity-60 ml-1">{formatTime(item.event.created_at, timezone)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Floating "New messages" button */}
      {showNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Novas mensagens
        </button>
      )}
    </div>
  );
}

/**
 * Helper component to grab the Radix ScrollArea viewport ref.
 * The viewport is the first [data-radix-scroll-area-viewport] child.
 */
function ScrollAreaViewportRef({ viewportRef }: { viewportRef: React.MutableRefObject<HTMLDivElement | null> }) {
  const selfRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (selfRef.current) {
      const viewport = selfRef.current.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
      if (viewport) {
        viewportRef.current = viewport;
      }
    }
  }, [viewportRef]);

  return <span ref={selfRef} className="hidden" aria-hidden />;
}
