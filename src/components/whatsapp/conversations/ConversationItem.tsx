import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Archive, CheckCheck, Clock } from "lucide-react";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationItem({ conversation: conv, isSelected, onClick }: Props) {
  const contact = conv.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";

  const getInitials = (n: string) => n.substring(0, 2).toUpperCase();

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      return formatDistanceToNow(new Date(ts), { addSuffix: false, locale: ptBR });
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
        isSelected && "bg-accent"
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
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate">{name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
            {formatTime(conv.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {conv.isLastMessageFromMe && (
              <CheckCheck className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <p className="text-xs text-muted-foreground truncate">
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
      </div>
    </button>
  );
}
