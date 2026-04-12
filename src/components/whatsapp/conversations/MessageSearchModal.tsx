import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, FileSearch } from "lucide-react";
import { useMessageSearch, type MessageSearchResult } from "../hooks/useMessageSearch";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PERIOD_OPTIONS = [
  { label: "90 dias", value: 90 },
  { label: "180 dias", value: 180 },
  { label: "360 dias", value: 360 },
  { label: "Tudo", value: 0 },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectMessage: (conversationId: string, messageId: string) => void;
}

export function MessageSearchModal({ open, onOpenChange, onSelectMessage }: Props) {
  const [search, setSearch] = useState("");
  const [daysBack, setDaysBack] = useState(90);
  const { filteredInstanceIds } = useDepartmentFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const { data: results = [], isLoading, isFetching } = useMessageSearch(
    search,
    daysBack,
    isAdmin ? undefined : (filteredInstanceIds ?? undefined)
  );

  const hasSearch = search.trim().length >= 3;

  const getInitials = (name: string | null, phone: string) => {
    if (name) return name.substring(0, 2).toUpperCase();
    return phone.substring(phone.length - 2);
  };

  const highlightMatch = (text: string, term: string) => {
    if (!term || term.length < 3) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + term.length + 40);
    const snippet =
      (start > 0 ? "..." : "") +
      text.substring(start, end) +
      (end < text.length ? "..." : "");
    const matchStart = idx - start;
    return (
      <>
        {snippet.substring(0, matchStart + (start > 0 ? 3 : 0))}
        <span className="bg-yellow-300/40 dark:bg-yellow-500/30 font-semibold rounded px-0.5">
          {snippet.substring(matchStart + (start > 0 ? 3 : 0), matchStart + (start > 0 ? 3 : 0) + term.length)}
        </span>
        {snippet.substring(matchStart + (start > 0 ? 3 : 0) + term.length)}
      </>
    );
  };

  const formatTimestamp = (ts: string) => {
    try {
      return format(new Date(ts), "dd/MM/yyyy HH:mm", { locale: ptBR });
    } catch {
      return "";
    }
  };

  const handleSelect = (result: MessageSearchResult) => {
    onSelectMessage(result.conversation_id, result.message_id);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSearch className="h-5 w-5 text-primary" />
            Buscar nas mensagens
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 pb-4 flex-1 min-h-0">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar texto nas mensagens..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              autoFocus
            />
          </div>

          {/* Period pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Período:</span>
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDaysBack(opt.value)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  daysBack === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Warning for "Tudo" */}
          {daysBack === 0 && (
            <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-md px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              A pesquisa pode demorar alguns segundos para filtrar todas as mensagens.
            </div>
          )}

          {/* Results */}
          <ScrollArea className="flex-1 overflow-hidden -mx-1 px-1">
            {isLoading || isFetching ? (
              <div className="flex flex-col gap-3 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3 p-3">
                    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : hasSearch && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Search className="h-8 w-8 opacity-40" />
                <p className="text-sm">Nenhuma mensagem encontrada</p>
              </div>
            ) : !hasSearch ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <FileSearch className="h-8 w-8 opacity-40" />
                <p className="text-sm">Digite pelo menos 3 caracteres</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 p-1">
                {results.map((result) => (
                  <button
                    key={result.message_id}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-start gap-3 p-3 rounded-md text-left transition-colors hover:bg-accent/50"
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      {result.contact_profile_picture_url && (
                        <AvatarImage src={result.contact_profile_picture_url} />
                      )}
                      <AvatarFallback className="text-xs">
                        {getInitials(result.contact_name, result.contact_phone)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="text-sm font-medium truncate">
                        {result.contact_name || result.contact_phone}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {result.is_from_me && (
                          <span className="text-primary font-medium">Você: </span>
                        )}
                        {highlightMatch(result.content, search.trim())}
                      </div>
                      <div className="text-[11px] text-muted-foreground/70">
                        {formatTimestamp(result.message_timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
