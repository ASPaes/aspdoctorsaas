import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import ContactAvatar from "@/components/whatsapp/ContactAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageSquare } from "lucide-react";
import { useConversations, type Conversation } from "./hooks/useConversations";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  selectedId: string | null;
  onSelect: (conv: Conversation) => void;
}

export function ConversationList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const { data: conversations = [], isLoading } = useConversations(search);

  const getInitials = (name: string | null, phone: string) => {
    if (name) return name.substring(0, 2).toUpperCase();
    return phone.substring(phone.length - 2);
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      return formatDistanceToNow(new Date(ts), { addSuffix: false, locale: ptBR });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="space-y-px p-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv)}
                className={cn(
                  "w-full grid gap-3 p-3 rounded-md text-left transition-colors hover:bg-accent/50",
                  selectedId === conv.id && "bg-accent"
                )}
                style={{ gridTemplateColumns: "40px minmax(0, 1fr) max-content" }}
              >
                <ContactAvatar
                  name={conv.contact_name || conv.contact_phone}
                  profilePictureUrl={conv.contact_profile_picture}
                  size="md"
                  className="self-center"
                />

                <div className="min-w-0 overflow-hidden self-center">
                  <p className="text-sm font-medium truncate">
                    {conv.contact_name || conv.contact_phone}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {conv.last_message_preview || "Sem mensagens"}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 self-start whitespace-nowrap shrink-0">
                  {conv.last_message_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatTime(conv.last_message_at)}
                    </span>
                  )}
                  {conv.unread_count > 0 && (
                    <Badge variant="default" className="h-5 min-w-5 px-1.5 text-[10px] shrink-0">
                      {conv.unread_count > 99 ? "99+" : conv.unread_count}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
