import { useMemo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ExternalLink, Clock, MessageSquare, Building2, Radio } from "lucide-react";
import { formatBRPhone } from "@/lib/phoneBR";
import { useContactHistory, type ContactHistoryItem } from "../hooks/useContactHistory";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  onNavigateToConversation?: (conversationId: string) => void;
}

export function ContactHistoryModal({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  onNavigateToConversation,
}: Props) {
  const { data: history, isLoading } = useContactHistory(contactId, open);

  const stats = useMemo(() => {
    if (!history) return { total: 0, attendances: 0, lastInteraction: null as string | null };
    const attendances = history.filter((h) => h.attendance).length;
    const lastInteraction = history[0]?.last_message_at || null;
    return { total: history.length, attendances, lastInteraction };
  }, [history]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] w-[95vw] max-h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="text-lg">Histórico do Contato</DialogTitle>
          <div className="mt-1">
            <p className="text-sm text-muted-foreground">
              {contactName} · {formatBRPhone(contactPhone)}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-xs gap-1">
                <MessageSquare className="h-3 w-3" />
                {stats.total} conversa{stats.total !== 1 ? "s" : ""}
              </Badge>
              {stats.attendances > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Radio className="h-3 w-3" />
                  {stats.attendances} atendimento{stats.attendances !== 1 ? "s" : ""}
                </Badge>
              )}
              {stats.lastInteraction && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Clock className="h-3 w-3" />
                  Última: {formatDistanceToNow(new Date(stats.lastInteraction), { addSuffix: true, locale: ptBR })}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        <Separator />

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Carregando histórico...</span>
              </div>
            ) : !history || history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Nenhuma conversa encontrada.</p>
            ) : (
              history.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    onNavigateToConversation?.(item.id);
                    onOpenChange(false);
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>

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

function HistoryCard({ item, onOpen }: { item: ContactHistoryItem; onOpen: () => void }) {
  const att = item.attendance;

  const statusLabel = att
    ? att.status === "waiting"
      ? "Na Fila"
      : att.status === "in_progress"
      ? "Em Atendimento"
      : att.status === "closed" || att.status === "inactive_closed"
      ? "Encerrado"
      : att.status
    : item.status === "active"
    ? "Ativa"
    : item.status === "closed"
    ? "Encerrada"
    : item.status === "archived"
    ? "Arquivada"
    : item.status;

  const statusVariant =
    att?.status === "waiting" || att?.status === "in_progress" || item.status === "active"
      ? "default"
      : "secondary";

  const dateStr = item.last_message_at
    ? formatDistanceToNow(new Date(item.last_message_at), { addSuffix: true, locale: ptBR })
    : null;
  const dateFullStr = item.last_message_at
    ? format(new Date(item.last_message_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
    : null;

  return (
    <div className="border border-border rounded-lg p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2 min-w-0">
        {/* Left: tags + preview */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Tags row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={statusVariant as any} className="text-[10px] h-5">
              {statusLabel}
            </Badge>
            {att?.attendance_code && (
              <Badge variant="outline" className="text-[10px] h-5 font-mono">
                #{att.attendance_code}
              </Badge>
            )}
            {item.departmentName && (
              <Badge variant="outline" className="text-[10px] h-5 gap-1 border-primary/30 text-primary">
                <Building2 className="h-2.5 w-2.5" />
                {item.departmentName}
              </Badge>
            )}
            {item.instanceName && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {item.instanceName}
              </Badge>
            )}
          </div>

          {/* Message preview */}
          {item.last_message_preview && (
            <p className="text-xs text-muted-foreground line-clamp-2 break-words" style={{ overflowWrap: "anywhere" }}>
              {item.last_message_preview}
            </p>
          )}

          {/* Date */}
          {dateStr && (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {dateStr}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {dateFullStr}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right: action */}
        <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs gap-1" onClick={onOpen}>
          <ExternalLink className="h-3 w-3" />
          Abrir
        </Button>
      </div>
    </div>
  );
}
