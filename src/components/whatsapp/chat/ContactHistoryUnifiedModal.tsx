import { useMemo, useRef, useEffect, useState, useCallback, Fragment } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Search,
  Filter,
  CalendarIcon,
  X,
  ChevronUp,
  ChevronDown,
  Building2,
  Radio,
  User,
  ExternalLink,
  ArrowDown,
} from "lucide-react";
import { formatBRPhone } from "@/lib/phoneBR";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  useContactUnifiedHistory,
  type UnifiedMessage,
  type ConversationMeta,
} from "../hooks/useContactUnifiedHistory";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  onNavigateToConversation?: (conversationId: string) => void;
}

// ─── Highlight search matches ───
function HighlightText({ text, search }: { text: string; search: string }) {
  if (!search.trim() || !text) return <>{text}</>;
  const term = search.toLowerCase();
  const parts: { text: string; highlight: boolean }[] = [];
  let remaining = text;
  let lower = remaining.toLowerCase();
  let idx = lower.indexOf(term);
  while (idx !== -1) {
    if (idx > 0) parts.push({ text: remaining.slice(0, idx), highlight: false });
    parts.push({ text: remaining.slice(idx, idx + term.length), highlight: true });
    remaining = remaining.slice(idx + term.length);
    lower = remaining.toLowerCase();
    idx = lower.indexOf(term);
  }
  if (remaining) parts.push({ text: remaining, highlight: false });
  return (
    <>
      {parts.map((p, i) =>
        p.highlight ? (
          <mark key={i} className="bg-yellow-300/60 dark:bg-yellow-500/40 text-foreground rounded-sm px-0.5">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

// ─── Attendance status helpers ───
function statusLabel(s: string | null): string {
  switch (s) {
    case "waiting": return "Na Fila";
    case "in_progress": return "Em Atendimento";
    case "closed": return "Encerrado";
    case "inactive_closed": return "Encerrado (Inativo)";
    case "active": return "Ativa";
    default: return s || "—";
  }
}
function statusVariant(s: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "waiting": return "outline";
    case "in_progress": return "default";
    case "closed":
    case "inactive_closed": return "secondary";
    default: return "outline";
  }
}

// ─── Multi-select chip filter ───
function MultiChipFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
      <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5 cursor-pointer text-xs hover:bg-muted/50 rounded px-1 py-0.5">
            <Checkbox
              checked={selected.includes(o.id)}
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? [...selected, o.id]
                    : selected.filter((id) => id !== o.id)
                );
              }}
              className="h-3.5 w-3.5"
            />
            <span className="truncate">{o.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ContactHistoryUnifiedModal({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  onNavigateToConversation,
}: Props) {
  const { profile } = useAuth();
  const isAdminOrHead =
    profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const {
    messages,
    convMetaMap,
    isLoading,
    isFetching,
    filters,
    updateFilter,
    clearFilters,
    hasMore,
    loadMore,
    departments,
    instances,
    agents,
    totalConversations,
  } = useContactUnifiedHistory(contactId, open && isAdminOrHead);

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(true); // desktop default open
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  // Scroll to bottom on first load
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !initialScrollDone) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" as any });
        setInitialScrollDone(true);
      });
    }
  }, [isLoading, messages.length, initialScrollDone]);

  // Reset on modal close/open
  useEffect(() => {
    if (!open) setInitialScrollDone(false);
  }, [open]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Track scroll position for FAB
  const handleScroll = useCallback(() => {
    const el = scrollViewportRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distFromBottom > 300);
  }, []);

  // Group messages by conversation_id for conversation separators
  const enrichedGroups = useMemo(() => {
    if (messages.length === 0) return [];

    const result: Array<
      | { type: "conv-separator"; meta: ConversationMeta }
      | { type: "day"; date: string }
      | { type: "msg"; msg: UnifiedMessage }
    > = [];

    let currentConvId = "";
    let currentDate = "";

    for (const msg of messages) {
      // Conversation separator
      if (msg.conversation_id !== currentConvId) {
        currentConvId = msg.conversation_id;
        currentDate = ""; // reset date so day sep appears after conv sep
        const meta = convMetaMap.get(msg.conversation_id);
        if (meta) {
          result.push({ type: "conv-separator", meta });
        }
      }

      // Day separator
      const day = format(new Date(msg.timestamp), "yyyy-MM-dd");
      if (day !== currentDate) {
        currentDate = day;
        result.push({ type: "day", date: day });
      }

      result.push({ type: "msg", msg });
    }

    return result;
  }, [messages, convMetaMap]);

  const hasActiveFilters =
    filters.departmentIds.length > 0 ||
    filters.instanceIds.length > 0 ||
    !!filters.status ||
    !!filters.assignedTo ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  const activeFilterCount =
    (filters.departmentIds.length > 0 ? 1 : 0) +
    (filters.instanceIds.length > 0 ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.assignedTo ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <DialogTitle className="text-base">Histórico Unificado</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {contactName} · {formatBRPhone(contactPhone)}
              </p>
            </div>
            {isAdminOrHead && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className="text-[10px] h-5 gap-1">
                  <Radio className="h-2.5 w-2.5" />
                  {totalConversations}
                </Badge>
                <Badge variant="outline" className="text-[10px] h-5">
                  {messages.length} msg{messages.length !== 1 ? "s" : ""}
                </Badge>
                {/* Mobile filters toggle */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 md:hidden"
                  onClick={() => setFiltersVisible((v) => !v)}
                >
                  <Filter className="h-3 w-3" />
                  {activeFilterCount > 0 && (
                    <span className="bg-primary text-primary-foreground rounded-full h-4 w-4 text-[9px] flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <Separator />

        {!isAdminOrHead ? (
          <div className="flex items-center justify-center py-16 px-6 text-muted-foreground text-sm">
            Apenas Admin/Head pode ver histórico unificado.
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Filters sidebar — desktop always, mobile collapsible */}
            <div
              className={cn(
                "border-r border-border shrink-0 flex flex-col overflow-y-auto p-3 gap-2.5 transition-all duration-200",
                "w-[250px]",
                filtersVisible ? "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:bg-background max-md:shadow-lg max-md:w-[280px]" : "max-md:hidden"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Filtros
                </span>
                <div className="flex items-center gap-1">
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={clearFilters}>
                      Limpar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 md:hidden"
                    onClick={() => setFiltersVisible(false)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Buscar mensagens..."
                  value={filters.searchText}
                  onChange={(e) => updateFilter("searchText", e.target.value)}
                  className="pl-7 h-7 text-xs"
                />
                {filters.searchText && (
                  <button
                    onClick={() => updateFilter("searchText", "")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>

              {/* Department multi-select */}
              <MultiChipFilter
                label="Setor"
                options={departments}
                selected={filters.departmentIds}
                onChange={(ids) => updateFilter("departmentIds", ids)}
              />

              {/* Instance multi-select */}
              <MultiChipFilter
                label="Instância"
                options={instances}
                selected={filters.instanceIds}
                onChange={(ids) => updateFilter("instanceIds", ids)}
              />

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">Status</label>
                <Select
                  value={filters.status ?? "__all__"}
                  onValueChange={(v) => updateFilter("status", v === "__all__" ? null : v)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="waiting">Na Fila</SelectItem>
                    <SelectItem value="in_progress">Em Atendimento</SelectItem>
                    <SelectItem value="closed">Encerrado</SelectItem>
                    <SelectItem value="inactive_closed">Enc. (Inativo)</SelectItem>
                    <SelectItem value="active">Ativa</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Agent */}
              {agents.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Técnico</label>
                  <Select
                    value={filters.assignedTo ?? "__all__"}
                    onValueChange={(v) => updateFilter("assignedTo", v === "__all__" ? null : v)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">De</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full h-7 text-[10px] justify-start gap-0.5 px-1.5">
                        <CalendarIcon className="h-2.5 w-2.5 shrink-0" />
                        {filters.dateFrom
                          ? format(filters.dateFrom, "dd/MM/yy", { locale: ptBR })
                          : "30 dias"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.dateFrom ?? undefined}
                        onSelect={(d) => updateFilter("dateFrom", d ?? null)}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Até</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full h-7 text-[10px] justify-start gap-0.5 px-1.5">
                        <CalendarIcon className="h-2.5 w-2.5 shrink-0" />
                        {filters.dateTo
                          ? format(filters.dateTo, "dd/MM/yy", { locale: ptBR })
                          : "Agora"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.dateTo ?? undefined}
                        onSelect={(d) => updateFilter("dateTo", d ?? null)}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Chat timeline */}
            <div className="flex-1 flex flex-col min-w-0 relative">
              {/* Load more */}
              {hasMore && messages.length > 0 && (
                <div className="flex justify-center py-1.5 shrink-0 border-b border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] gap-1 h-6"
                    onClick={loadMore}
                    disabled={isFetching}
                  >
                    {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
                    Carregar mais antigas
                  </Button>
                </div>
              )}

              <ScrollArea
                className="flex-1 min-h-0"
                onScrollCapture={handleScroll}
              >
                <div
                  ref={scrollViewportRef}
                  className="px-4 py-2"
                  onScroll={handleScroll}
                >
                  {isLoading ? (
                    <div className="space-y-3 py-8">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                          <Skeleton className="h-12 w-[55%] rounded-lg" />
                        </div>
                      ))}
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-16">
                      {filters.searchText
                        ? "Nenhuma mensagem encontrada."
                        : "Nenhuma mensagem no período."}
                    </p>
                  ) : (
                    enrichedGroups.map((item, idx) => {
                      if (item.type === "conv-separator") {
                        return (
                          <ConversationSeparator
                            key={`sep-${item.meta.id}`}
                            meta={item.meta}
                            onOpen={
                              onNavigateToConversation
                                ? () => {
                                    onNavigateToConversation(item.meta.id);
                                    onOpenChange(false);
                                  }
                                : undefined
                            }
                          />
                        );
                      }
                      if (item.type === "day") {
                        return (
                          <div key={`day-${item.date}-${idx}`} className="flex items-center justify-center my-2">
                            <span className="text-[9px] bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                              {format(new Date(item.date), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <MessageRow
                          key={item.msg.id}
                          message={item.msg}
                          convMetaMap={convMetaMap}
                          searchText={filters.searchText}
                        />
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              {/* Scroll to bottom FAB */}
              {showScrollDown && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute bottom-4 right-4 h-8 w-8 rounded-full shadow-md z-10"
                  onClick={scrollToBottom}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <Separator />
        <div className="px-5 py-2.5 flex justify-end shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Conversation Separator ───
function ConversationSeparator({
  meta,
  onOpen,
}: {
  meta: ConversationMeta;
  onOpen?: () => void;
}) {
  const effStatus = meta.attendanceStatus || meta.status;
  return (
    <div className="my-3 mx-auto max-w-[90%]">
      <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3 py-1.5">
        <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
          {meta.attendanceCode ? (
            <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono shrink-0">
              #{meta.attendanceCode}
            </Badge>
          ) : (
            <span className="text-[9px] text-muted-foreground font-medium">Conversa</span>
          )}
          <Badge variant={statusVariant(effStatus)} className="text-[9px] h-4 px-1 shrink-0">
            {statusLabel(effStatus)}
          </Badge>
          {meta.departmentName && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 border-primary/30 text-primary shrink-0">
              <Building2 className="h-2 w-2" />
              {meta.departmentName}
            </Badge>
          )}
          {meta.instanceName && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">
              {meta.instanceName}
            </Badge>
          )}
          {meta.assignedToName && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 shrink-0">
              <User className="h-2 w-2" />
              {meta.assignedToName}
            </Badge>
          )}
        </div>
        {onOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={onOpen}>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Abrir conversa</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Message Row ───
function MessageRow({
  message,
  convMetaMap,
  searchText,
}: {
  message: UnifiedMessage;
  convMetaMap: Map<string, ConversationMeta>;
  searchText: string;
}) {
  const time = format(new Date(message.timestamp), "HH:mm", { locale: ptBR });

  return (
    <div className={cn("flex mb-1", message.is_from_me ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-2.5 py-1.5 text-xs",
          message.is_from_me
            ? "bg-primary/10 text-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {message.content ? (
          <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: "anywhere" }}>
            <HighlightText text={message.content} search={searchText} />
          </p>
        ) : (
          <p className="italic text-muted-foreground">
            {message.message_type === "image"
              ? "📷 Imagem"
              : message.message_type === "audio"
              ? "🎤 Áudio"
              : message.message_type === "video"
              ? "🎬 Vídeo"
              : message.message_type === "document"
              ? "📄 Documento"
              : message.message_type === "sticker"
              ? "🏷️ Sticker"
              : `[${message.message_type}]`}
          </p>
        )}
        <span className="text-[9px] text-muted-foreground block text-right mt-0.5">{time}</span>
      </div>
    </div>
  );
}
