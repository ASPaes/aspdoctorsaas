import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName?: string | null;
}

interface Result {
  id: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  sender_name: string | null;
}

export function InChatMessageSearchModal({ open, onOpenChange, conversationId, contactName }: Props) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const hasSearch = debounced.length >= 2;

  const { data: results = [], isFetching } = useQuery<Result[]>({
    queryKey: ["in-chat-message-search", conversationId, debounced],
    enabled: open && !!conversationId && hasSearch,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_messages" as any) as any)
        .select("id, content, timestamp, is_from_me, sender_name")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .ilike("content", `%${debounced}%`)
        .order("timestamp", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Result[];
    },
  });

  const highlight = (text: string, term: string) => {
    if (!term) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + term.length + 60);
    const snippet = (start > 0 ? "..." : "") + text.substring(start, end) + (end < text.length ? "..." : "");
    const matchStart = idx - start + (start > 0 ? 3 : 0);
    return (
      <>
        {snippet.substring(0, matchStart)}
        <span className="bg-yellow-300/40 dark:bg-yellow-500/30 font-semibold rounded px-0.5">
          {snippet.substring(matchStart, matchStart + term.length)}
        </span>
        {snippet.substring(matchStart + term.length)}
      </>
    );
  };

  const handleSelect = (messageId: string) => {
    onOpenChange(false);
    setTimeout(() => {
      let attempts = 0;
      const tryScroll = () => {
        attempts++;
        const el = document.querySelector(`[data-msg-id="${messageId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("message-highlight-flash");
          setTimeout(() => el.classList.remove("message-highlight-flash"), 2500);
        } else if (attempts < 10) {
          setTimeout(tryScroll, 250);
        }
      };
      tryScroll();
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[75vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSearch className="h-5 w-5 text-primary" />
            Buscar nesta conversa
          </DialogTitle>
          {contactName && (
            <p className="text-xs text-muted-foreground truncate">{contactName}</p>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 pb-4 flex-1 min-h-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar texto, palavra ou nº de chamado..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              autoFocus
            />
          </div>

          <ScrollArea className="flex-1 overflow-hidden -mx-1 px-1">
            {!hasSearch ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <FileSearch className="h-8 w-8 opacity-40" />
                <p className="text-sm">Digite pelo menos 2 caracteres</p>
              </div>
            ) : isFetching ? (
              <div className="flex flex-col gap-2 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Search className="h-8 w-8 opacity-40" />
                <p className="text-sm">Nenhuma mensagem encontrada</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 p-1">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r.id)}
                    className="w-full flex flex-col gap-1 p-3 rounded-md text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">
                        {r.is_from_me ? (r.sender_name || "Você") : (r.sender_name || contactName || "Contato")}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {format(new Date(r.timestamp), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {highlight(r.content || "", debounced)}
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

export default InChatMessageSearchModal;
