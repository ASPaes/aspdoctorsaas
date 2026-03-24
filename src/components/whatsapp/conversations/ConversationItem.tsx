import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Archive, CheckCheck, AlertTriangle } from "lucide-react";
import { formatBRPhone } from "@/lib/phoneBR";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import type { AttendanceInfo } from "../hooks/useAttendanceStatus";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onClick: () => void;
  instanceName?: string;
  attendance?: AttendanceInfo;
}

export function ConversationItem({ conversation: conv, isSelected, onClick, instanceName, attendance }: Props) {
  const contact = conv.contact;
  const name = contact?.name || (contact?.phone_number ? formatBRPhone(contact.phone_number) : "Desconhecido");
  const { sentiment } = useWhatsAppSentiment(conv.id);
  const { timezone } = useAppTimezone();
  const sentimentData = sentiment as any;
  const needsCSTicket = sentimentData?.needs_cs_ticket && !sentimentData?.cs_ticket_created_id;
  const unreadCount = parseInt(String(conv.unread_count ?? 0), 10) || 0;
  const hasUnread = unreadCount > 0;

  const MAX_PREVIEW = 45;
  const rawPreview = conv.isLastMessageFromMe
    ? `Você: ${conv.last_message_preview || "Sem mensagens"}`
    : (conv.last_message_preview || "Sem mensagens");
  const previewText = rawPreview.length > MAX_PREVIEW
    ? rawPreview.substring(0, MAX_PREVIEW) + "…"
    : rawPreview;

  const getInitials = (n: string) => n.substring(0, 2).toUpperCase();

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return "";
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };

      if (diffDays === 0) {
        return new Intl.DateTimeFormat("pt-BR", { ...opts, hour: "2-digit", minute: "2-digit" }).format(date);
      }
      if (diffDays < 7) {
        return new Intl.DateTimeFormat("pt-BR", { ...opts, weekday: "short" }).format(date);
      }
      return new Intl.DateTimeFormat("pt-BR", { ...opts, day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
    } catch {
      return "";
    }
  };

  const statusColor =
    conv.status === "active" ? "bg-green-500" :
    conv.status === "closed" ? "bg-muted-foreground" :
    "bg-yellow-500";

  const timeStr = formatTime(conv.last_message_at);

  const attendanceBadge = attendance ? (
    attendance.status === "waiting" ? (
      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
        Fila
      </Badge>
    ) : attendance.status === "in_progress" ? (
      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-500/50 text-blue-600 dark:text-blue-400">
        Em atend.
      </Badge>
    ) : (attendance.status === "closed" || attendance.status === "inactive_closed") ? (
      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/50 text-muted-foreground">
        Encerrado
      </Badge>
    ) : null
  ) : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full grid gap-3 p-3 rounded-md text-left transition-colors hover:bg-accent/50",
        isSelected && "bg-accent",
        needsCSTicket && "ring-1 ring-destructive/40"
      )}
      style={{ gridTemplateColumns: "40px minmax(0, 1fr) max-content" }}
    >
      {/* Col 1 — Avatar */}
      <div className="relative shrink-0 self-center">
        <Avatar className="h-10 w-10">
          {contact?.profile_picture_url && (
            <AvatarImage src={contact.profile_picture_url} />
          )}
          <AvatarFallback className="text-xs">{getInitials(name)}</AvatarFallback>
        </Avatar>
        <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background", statusColor)} />
        {needsCSTicket && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
            <AlertTriangle className="relative h-3.5 w-3.5 text-destructive" />
          </span>
        )}
      </div>

      {/* Col 2 — Name + Preview (truncatable) */}
      <div className="min-w-0 overflow-hidden self-center">
        <p className="text-sm font-medium truncate">{name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {conv.isLastMessageFromMe && (
            <CheckCheck className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs text-muted-foreground truncate">{previewText}</span>
        </div>
        {instanceName && (
          <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{instanceName}</p>
        )}
      </div>

      {/* Col 3 — Meta: time + badge + unread (never hidden) */}
      <div className="flex flex-col items-end gap-1 self-start whitespace-nowrap shrink-0">
        {timeStr && (
          <span className={cn(
            "text-xs",
            hasUnread ? "text-green-500 font-semibold" : "text-muted-foreground"
          )}>
            {timeStr}
          </span>
        )}
        {attendanceBadge}
        <div className="flex items-center gap-1">
          {conv.status === "archived" && <Archive className="h-3 w-3 text-muted-foreground" />}
          {hasUnread && (
            <span className="flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-green-500 text-white text-[10px] font-bold leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
