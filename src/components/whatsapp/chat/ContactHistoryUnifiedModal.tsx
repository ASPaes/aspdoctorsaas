import { useMemo, useRef, useEffect } from "react";
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
import {
  Loader2,
  Search,
  Filter,
  CalendarIcon,
  X,
  ChevronUp,
  Building2,
  Radio,
  User,
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
}

export function ContactHistoryUnifiedModal({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
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

  const scrollRef = useRef<HTMLDivElement>(null);

  // Group messages by date for day separators
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: UnifiedMessage[] }[] = [];
    let currentDate = "";
    for (const msg of messages) {
      const day = format(new Date(msg.timestamp), "yyyy-MM-dd");
      if (day !== currentDate) {
        currentDate = day;
        groups.push({ date: day, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }, [messages]);

  const hasActiveFilters =
    !!filters.departmentId ||
    !!filters.instanceId ||
    !!filters.status ||
    !!filters.assignedTo ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="text-lg">Histórico Unificado do Contato</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {contactName} · {formatBRPhone(contactPhone)}
          </p>
          {isAdminOrHead && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-xs gap-1">
                <Radio className="h-3 w-3" />
                {totalConversations} conversa{totalConversations !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                {messages.length} mensagen{messages.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          )}
        </DialogHeader>

        <Separator />

        {!isAdminOrHead ? (
          <div className="flex items-center justify-center py-16 px-6 text-muted-foreground text-sm">
            Apenas Admin/Head pode ver histórico unificado.
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Filters sidebar */}
            <div className="w-[260px] border-r border-border shrink-0 flex flex-col overflow-y-auto p-4 gap-3 max-h-[calc(90vh-180px)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Filtros
                </span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearFilters}>
                    Limpar
                  </Button>
                )}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar mensagens..."
                  value={filters.searchText}
                  onChange={(e) => updateFilter("searchText", e.target.value)}
                  className="pl-7 h-8 text-xs"
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

              {/* Department */}
              {departments.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Setor</label>
                  <Select
                    value={filters.departmentId ?? "__all__"}
                    onValueChange={(v) => updateFilter("departmentId", v === "__all__" ? null : v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Instance */}
              {instances.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Instância</label>
                  <Select
                    value={filters.instanceId ?? "__all__"}
                    onValueChange={(v) => updateFilter("instanceId", v === "__all__" ? null : v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas</SelectItem>
                      {instances.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">Status</label>
                <Select
                  value={filters.status ?? "__all__"}
                  onValueChange={(v) => updateFilter("status", v === "__all__" ? null : v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="waiting">Na Fila</SelectItem>
                    <SelectItem value="in_progress">Em Atendimento</SelectItem>
                    <SelectItem value="closed">Encerrado</SelectItem>
                    <SelectItem value="inactive_closed">Encerrado (Inativo)</SelectItem>
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
                    <SelectTrigger className="h-8 text-xs">
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

              {/* Date From */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">De</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs justify-start gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      {filters.dateFrom
                        ? format(filters.dateFrom, "dd/MM/yyyy", { locale: ptBR })
                        : "Últimos 7 dias"}
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

              {/* Date To */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">Até</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs justify-start gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      {filters.dateTo
                        ? format(filters.dateTo, "dd/MM/yyyy", { locale: ptBR })
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

            {/* Chat timeline */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Load more */}
              {hasMore && messages.length > 0 && (
                <div className="flex justify-center py-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1 h-7"
                    onClick={loadMore}
                    disabled={isFetching}
                  >
                    {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
                    Carregar mais antigas
                  </Button>
                </div>
              )}

              <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
                <div className="px-4 py-3 space-y-1">
                  {isLoading ? (
                    <div className="space-y-3 py-8">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                          <Skeleton className="h-14 w-[60%] rounded-lg" />
                        </div>
                      ))}
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-16">
                      {filters.searchText
                        ? "Nenhuma mensagem encontrada para esta busca."
                        : "Nenhuma mensagem no período selecionado."}
                    </p>
                  ) : (
                    groupedMessages.map((group) => (
                      <div key={group.date}>
                        {/* Day separator */}
                        <div className="flex items-center justify-center my-3">
                          <span className="text-[10px] bg-muted text-muted-foreground px-3 py-0.5 rounded-full">
                            {format(new Date(group.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                          </span>
                        </div>
                        {group.messages.map((msg) => (
                          <MessageRow key={msg.id} message={msg} convMetaMap={convMetaMap} />
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Footer */}
        <Separator />
        <div className="px-6 py-3 flex justify-end shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  message,
  convMetaMap,
}: {
  message: UnifiedMessage;
  convMetaMap: Map<string, ConversationMeta>;
}) {
  const meta = convMetaMap.get(message.conversation_id);
  const time = format(new Date(message.timestamp), "HH:mm", { locale: ptBR });

  return (
    <div className={cn("flex mb-1.5", message.is_from_me ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2 text-xs",
          message.is_from_me
            ? "bg-primary/10 text-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {/* Content */}
        {message.content ? (
          <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: "anywhere" }}>
            {message.content}
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

        {/* Meta chips */}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="text-[9px] text-muted-foreground">{time}</span>
          {meta?.departmentName && (
            <Badge variant="outline" className="text-[8px] h-4 px-1 gap-0.5 border-primary/30 text-primary">
              <Building2 className="h-2 w-2" />
              {meta.departmentName}
            </Badge>
          )}
          {meta?.instanceName && (
            <Badge variant="secondary" className="text-[8px] h-4 px-1">
              {meta.instanceName}
            </Badge>
          )}
          {meta?.assignedToName && (
            <Badge variant="outline" className="text-[8px] h-4 px-1 gap-0.5">
              <User className="h-2 w-2" />
              {meta.assignedToName}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
