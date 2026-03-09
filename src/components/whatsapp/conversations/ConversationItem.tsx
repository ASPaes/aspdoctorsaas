import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Archive, CheckCheck, AlertTriangle } from "lucide-react";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatRelativeTime } from "@/lib/formatDateWithTimezone";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onClick: () => void;
  instanceName?: string;
}

export function ConversationItem({ conversation: conv, isSelected, onClick, instanceName }: Props) {
  const contact = conv.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";
  const { sentiment } = useWhatsAppSentiment(conv.id);
  const { timezone } = useChatTimezone();
  const sentimentData = sentiment as any;
  const needsCSTicket = sentimentData?.needs_cs_ticket && !sentimentData?.cs_ticket_created_id;

  const getInitials = (n: string) => n.substring(0, 2).toUpperCase();

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      const date = new Date(ts);
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

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-md text-left transition-colors hover:bg-accent/50",
        isSelected && "bg-accent",
        needsCSTicket && "ring-1 ring-destructive/40"
      )}
    >
      <div className="relative">
        <Avatar className="h-10 w-10 shrink-0">
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

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate">{name}</span>
          <span className={cn(
            "text-[10px] shrink-0 ml-2",
            conv.unread_count > 0 ? "text-primary font-semibold" : "text-muted-foreground"
          )}>
            {formatTime(conv.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {conv.isLastMessageFromMe && (
              <CheckCheck className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <p className="text-xs text-muted-foreground truncate">
              {conv.isLastMessageFromMe && "Você: "}
              {conv.last_message_preview || "Sem mensagens"}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {conv.status === "archived" && <Archive className="h-3 w-3 text-muted-foreground" />}
            {conv.unread_count > 0 && (
              <Badge variant="default" className="h-5 min-w-5 px-1.5 text-[10px]">
                {conv.unread_count > 99 ? "99+" : conv.unread_count}
              </Badge>
            )}
          </div>
        </div>
        {instanceName && (
          <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{instanceName}</p>
        )}
      </div>
    </button>
  );
}
