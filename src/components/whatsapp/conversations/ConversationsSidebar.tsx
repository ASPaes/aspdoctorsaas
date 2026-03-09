import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, MessageSquare, BarChart3, Users, Settings } from "lucide-react";
import { useWhatsAppConversations, type ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { ConversationItem } from "./ConversationItem";
import { ConversationFiltersPopover, type SortBy } from "./ConversationFiltersPopover";
import { QuickPills } from "./QuickPills";
import { NewConversationModal } from "./NewConversationModal";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  selectedId: string | null;
  onSelect: (conv: ConversationWithContact) => void;
}

export function ConversationsSidebar({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [activePill, setActivePill] = useState("all");
  const [filters, setFilters] = useState<{ sortBy: SortBy; status: string | undefined; instanceId: string | undefined }>({
    sortBy: "recent",
    status: undefined,
    instanceId: undefined,
  });
  const navigate = useNavigate();
  const { user } = useAuth();

  const { conversations, isLoading, unreadCount, waitingCount } = useWhatsAppConversations({
    search: search.trim() || undefined,
    instanceId: filters.instanceId,
    status: filters.status,
    assignedTo: activePill === "mine" ? user?.id : undefined,
    pageSize: 100,
  });

  const filtered = useMemo(() => {
    let result = [...conversations];

    // Quick pill filters
    if (activePill === "unread") {
      result = result.filter(c => c.unread_count > 0);
    } else if (activePill === "waiting") {
      result = result.filter(c => c.isLastMessageFromMe === false);
    }

    // Sort
    switch (filters.sortBy) {
      case "oldest":
        result.sort((a, b) => {
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(aTime).getTime() - new Date(bTime).getTime();
        });
        break;
      case "unread":
        result.sort((a, b) => {
          if (a.unread_count > 0 && b.unread_count === 0) return -1;
          if (a.unread_count === 0 && b.unread_count > 0) return 1;
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        break;
      case "waiting":
        result.sort((a, b) => {
          const aWaiting = a.isLastMessageFromMe === false;
          const bWaiting = b.isLastMessageFromMe === false;
          if (aWaiting && !bWaiting) return -1;
          if (!aWaiting && bWaiting) return 1;
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        break;
      case "recent":
      default:
        // Already sorted by last_message_at DESC from the query
        break;
    }

    return result;
  }, [conversations, activePill, filters.sortBy]);

  const handleCreated = (convId: string) => {
    const conv = conversations.find(c => c.id === convId);
    if (conv) onSelect(conv);
  };

  return (
    <div className="flex flex-col h-full border-r border-border w-80 shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Conversas</h2>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/whatsapp/contatos")}>
                  <Users className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Contatos</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/whatsapp/relatorio")}>
                  <BarChart3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Relatórios</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/whatsapp/settings")}>
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Configurações</TooltipContent>
            </Tooltip>
            <ConversationFiltersPopover filters={filters} onChange={setFilters} />
            <Button variant="default" size="icon" className="h-7 w-7" onClick={() => setShowNewModal(true)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

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

      {/* Quick Pills */}
      <div className="pt-2">
        <QuickPills
          active={activePill}
          onChange={setActivePill}
          unreadCount={unreadCount}
          waitingCount={waitingCount}
        />
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="space-y-px p-1">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={selectedId === conv.id}
                onClick={() => onSelect(conv)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <NewConversationModal
        open={showNewModal}
        onOpenChange={setShowNewModal}
        onCreated={handleCreated}
      />
    </div>
  );
}
