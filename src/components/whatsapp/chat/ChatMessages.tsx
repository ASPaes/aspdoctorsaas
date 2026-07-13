import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./MessageBubble";
import { AttendanceEventBadge, parseAttendanceEvent } from "./AttendanceEventBadge";
import { useWhatsAppMessages, type Message } from "../hooks/useWhatsAppMessages";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { formatDateLabel, formatTime } from "@/lib/formatDateWithTimezone";
import { useConversationAssignmentHistory, type AssignmentEvent } from "../hooks/useConversationAssignmentHistory";
import { useConversationNotes, type ConversationNote } from "../hooks/useConversationNotes";
import { useGroupParticipants } from "../hooks/useGroupParticipants";
import { ArrowRightLeft, ChevronDown, Loader2, StickyNote, Trash2 } from "lucide-react";
import { NoteMediaPreview } from "./NoteMediaPreview";

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
  onResendFailed?: (msgId: string) => void;
  onEnterSelectionMode?: (msgId: string) => void;
  onContactChat?: (phone: string, name: string) => void;
  onContactSave?: (phone: string, name: string) => void;
  highlightMessageId?: string | null;
  onHighlightShown?: () => void;
  isGroup?: boolean;
  groupJid?: string | null;
  instanceId?: string | null;
}

type TimelineItem =
  | { type: 'message'; msg: Message }
  | { type: 'transfer'; event: AssignmentEvent }
  | { type: 'note'; note: ConversationNote };

const NEAR_BOTTOM_THRESHOLD = 150;
const TOP_LOAD_THRESHOLD = 120;

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
  onResendFailed,
  onEnterSelectionMode,
  onContactChat,
  onContactSave,
  highlightMessageId,
  onHighlightShown,
  isGroup,
  groupJid,
  instanceId,
}: Props) {
  const { messages, isLoading, onNewMessage, fetchNextPage, hasNextPage, isFetchingNextPage } = useWhatsAppMessages(conversationId);
  const { participants: groupParticipants } = useGroupParticipants(
    groupJid ?? null,
    instanceId ?? null,
    Boolean(isGroup),
  );
  const { data: assignments } = useConversationAssignmentHistory(conversationId);
  const { notes, deleteNote } = useConversationNotes(conversationId);
  const { timezone } = useAppTimezone();
  const { instances } = useWhatsAppInstances();
  const revokeUnsupportedInstanceIds = useMemo(
    () => new Set(instances.filter((i) => !["self_hosted", "cloud"].includes(i.provider_type)).map((i) => i.id)),
    [instances]
  );
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
  const [internalHighlight, setInternalHighlight] = useState<string | null>(null);
  const pendingNewCountRef = useRef(0);
  const prependAnchorRef = useRef<number | null>(null);

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
    // Perto do topo: carregar mensagens anteriores (salva âncora antes de prepender)
    if (viewport.scrollTop < TOP_LOAD_THRESHOLD && hasNextPage && !isFetchingNextPage) {
      prependAnchorRef.current = viewport.scrollHeight;
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (prependAnchorRef.current != null) {
      const delta = viewport.scrollHeight - prependAnchorRef.current;
      if (delta > 0) viewport.scrollTop = viewport.scrollTop + delta;
      prependAnchorRef.current = null;
    }
  }, [messages.length]);

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

  // Mapa de reações: message_id (externo) → array de emojis
  const reactionsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const msg of messages) {
      if (msg.message_type === 'reaction' && msg.quoted_message_id && msg.content) {
        const existing = map.get(msg.quoted_message_id) || [];
        existing.push(msg.content);
        map.set(msg.quoted_message_id, existing);
      }
    }
    return map;
  }, [messages]);

  const messagesByExternalId = useMemo(() => {
    const map = new Map<string, Message>();
    for (const msg of messages) {
      if (msg.message_id) map.set(msg.message_id, msg);
    }
    return map;
  }, [messages]);

  const handleReplyClick = useCallback((quotedMessageExternalId: string) => {
    const target = messagesByExternalId.get(quotedMessageExternalId);
    if (!target) return;
    setInternalHighlight(target.id);
  }, [messagesByExternalId]);

  // Helper: timestamp de qualquer item da timeline
  const itemTimestamp = (item: TimelineItem): string => {
    if (item.type === 'message') return item.msg.timestamp;
    if (item.type === 'transfer') return item.event.created_at;
    return item.note.created_at;
  };

  // Merge messages, assignment events e notas internas em uma única timeline
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = messages
      .filter(msg => msg.message_type !== 'reaction')
      .map(msg => ({ type: 'message' as const, msg }));
    if (assignments && !isGroup) {
      for (const event of assignments) {
        items.push({ type: 'transfer' as const, event });
      }
    }
    if (notes && notes.length > 0) {
      for (const note of notes) {
        items.push({ type: 'note' as const, note });
      }
    }
    items.sort((a, b) => new Date(itemTimestamp(a)).getTime() - new Date(itemTimestamp(b)).getTime());
    return items;
  }, [messages, assignments, isGroup, notes]);

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
      const ts = itemTimestamp(item);
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
      prependAnchorRef.current = null;
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
        // Mensagem não encontrada nas páginas carregadas — limpa highlight
        onHighlightShown?.();
      }
    };

    const timer = setTimeout(tryScroll, 200);
    return () => clearTimeout(timer);
  }, [highlightMessageId, isLoading, messages]);

  // Scroll to highlighted message (from clicking quoted bubble)
  useEffect(() => {
    if (!internalHighlight || isLoading) return;
    let attempts = 0;
    const maxAttempts = 10;
    const tryScroll = () => {
      attempts++;
      const el = document.querySelector(`[data-msg-id="${internalHighlight}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-highlight-flash");
        setTimeout(() => {
          el.classList.remove("message-highlight-flash");
          setInternalHighlight(null);
        }, 2500);
      } else if (attempts < maxAttempts) {
        setTimeout(tryScroll, 300);
      } else {
        setInternalHighlight(null);
      }
    };
    const timer = setTimeout(tryScroll, 200);
    return () => clearTimeout(timer);
  }, [internalHighlight, isLoading]);

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
                        reactions={reactionsMap.get(item.msg.message_id) || undefined}
                        onReply={onReply}
                        onReplyClick={handleReplyClick}
                        quotedMessage={item.msg.quoted_message_id ? messagesByExternalId.get(item.msg.quoted_message_id) || null : null}
                        selectionMode={selectionMode}
                        isSelected={selectedMessages?.has(item.msg.id)}
                        onToggleSelect={onToggleSelect}
                        onDeletePanelOnly={onDeletePanelOnly}
                        onDeleteEveryone={onDeleteEveryone}
                        onRetryDelete={onRetryDelete}
                        onForward={onForwardSingle}
                        onResendFailed={onResendFailed}
                        onEnterSelectionMode={onEnterSelectionMode}
                        onContactChat={onContactChat}
                        onContactSave={onContactSave}
                        groupParticipants={isGroup ? groupParticipants : undefined}
                        deleteEveryoneDisabled={!!item.msg.instance_id && revokeUnsupportedInstanceIds.has(item.msg.instance_id)}
                      />
                    </div>
                  );
                }

                if (item.type === 'transfer') {
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
                }

                // Nota interna — visível apenas para a equipe
                return (
                  <div key={`note-${item.note.id}`} className="flex justify-center my-2 group">
                    <div className="max-w-[85%] flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 shadow-sm">
                      <StickyNote className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            Nota interna
                          </span>
                          {item.note.author_name && (
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              {item.note.author_name}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {formatTime(item.note.created_at, timezone)}
                          </span>
                        </div>
                        {item.note.media_path && item.note.media_type && (
                          <NoteMediaPreview noteId={item.note.id} mediaType={item.note.media_type} />
                        )}
                        {item.note.content && (
                          <p className="text-sm whitespace-pre-wrap break-words text-foreground/90">
                            {item.note.content}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Excluir esta nota interna?')) deleteNote(item.note.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                        aria-label="Excluir nota"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Loader overlay para carregamento de mensagens anteriores */}
      {isFetchingNextPage && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs shadow">
          <Loader2 className="h-3 w-3 animate-spin" />
          Carregando mensagens anteriores...
        </div>
      )}



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
