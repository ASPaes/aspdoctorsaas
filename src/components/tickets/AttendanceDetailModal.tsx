import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Bot, Clock, MessageCircle, TicketCheck, ArrowUpRight, User, Phone, Loader2, MessageSquareText } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";

interface Props {
  attendanceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}min ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}min`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function statusVariant(status: string): { label: string; className: string } {
  switch (status) {
    case "waiting":
      return { label: "Aguardando", className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" };
    case "in_progress":
      return { label: "Em atendimento", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" };
    case "closed":
      return { label: "Encerrado", className: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" };
    default:
      return { label: status, className: "" };
  }
}

function closureVariant(closure: string): { label: string; className: string } {
  switch (closure) {
    case "manual":
      return { label: "Manual", className: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" };
    case "inactivity_auto":
      return { label: "Inatividade", className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" };
    case "silent":
      return { label: "Silencioso", className: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30" };
    default:
      return { label: closure, className: "" };
  }
}

export function AttendanceDetailModal({ attendanceId, open, onOpenChange }: Props) {
  const isMobile = useIsMobile();
  const [chatOpen, setChatOpen] = useState(false);

  const { data: att, isLoading } = useQuery({
    queryKey: ["attendance_detail", attendanceId],
    enabled: !!attendanceId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select(`
          id, attendance_code, status, closure_type, created_from,
          opened_at, assumed_at, closed_at, closed_reason,
          wait_seconds, handle_seconds, first_response_time_seconds,
          msg_customer_count, msg_agent_count, handoffs_count, reopen_count,
          ai_summary, ai_problem, ai_solution, ai_category, ai_tags,
          assigned_to, department_id, cliente_id, contact_id, conversation_id,
          whatsapp_contacts:contact_id(name, phone_number),
          clientes:cliente_id(nome_fantasia, cnpj),
          support_departments:department_id(name)
        `)
        .eq("id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: agentName } = useQuery({
    queryKey: ["attendance_agent_name", att?.assigned_to],
    enabled: !!att?.assigned_to,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles" as any) as any)
        .select("funcionarios:funcionario_id(nome)")
        .eq("user_id", att.assigned_to)
        .maybeSingle();
      return (data as any)?.funcionarios?.nome ?? null;
    },
  });

  const { data: csat } = useQuery({
    queryKey: ["attendance_csat", attendanceId],
    enabled: !!attendanceId && open,
    queryFn: async () => {
      const { data } = await (supabase.from("support_csat" as any) as any)
        .select("score, reason, responded_at")
        .eq("attendance_id", attendanceId)
        .maybeSingle();
      return data as any;
    },
  });

  const { data: ticket } = useQuery({
    queryKey: ["attendance_ticket", attendanceId],
    enabled: !!attendanceId && open,
    queryFn: async () => {
      const { data } = await (supabase.from("support_tickets" as any) as any)
        .select("id, ticket_code, status")
        .eq("attendance_id", attendanceId)
        .maybeSingle();
      return data as any;
    },
  });

  const handleOpenTicket = () => {
    if (!ticket?.id) return;
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("open-ticket-detail", { detail: { ticketId: ticket.id } }));
  };

  const csatColor = (score: number) =>
    score >= 4
      ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30"
      : score === 3
      ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
      : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";

  const content = (
    <ScrollArea className="h-full">
      <div className="p-4 md:p-6">
        {isLoading || !att ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Coluna esquerda — Detalhes */}
            <div className="space-y-4 min-w-0">
              {/* Header badges */}
              <div className="flex items-center flex-wrap gap-2">
                <span className="font-mono text-sm text-primary font-semibold">
                  {att.attendance_code}
                </span>
                <Badge variant="outline" className={statusVariant(att.status).className}>
                  {statusVariant(att.status).label}
                </Badge>
                {att.status === "closed" && att.closure_type && (
                  <Badge variant="outline" className={closureVariant(att.closure_type).className}>
                    {closureVariant(att.closure_type).label}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 ml-auto"
                  onClick={() => setChatOpen(true)}
                  disabled={!att?.conversation_id}
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Ver conversa
                </Button>
              </div>

              {/* Contato + Cliente */}
              <div className="bg-muted/50 p-3 rounded-lg space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">
                    {att.whatsapp_contacts?.name ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono">{att.whatsapp_contacts?.phone_number ?? "—"}</span>
                </div>
                <Separator className="my-2" />
                <div className="text-sm">
                  {att.clientes?.nome_fantasia ? (
                    <span className="font-medium">{att.clientes.nome_fantasia}</span>
                  ) : (
                    <span className="text-muted-foreground italic">Sem cliente vinculado</span>
                  )}
                </div>
              </div>

              {/* Grid metadados */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Agente</div>
                  <div className="truncate">{agentName ?? "Não atribuído"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Departamento</div>
                  <div className="truncate">{att.support_departments?.name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Aberto em</div>
                  <div>{formatDateTime(att.opened_at)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Assumido em</div>
                  <div>{formatDateTime(att.assumed_at)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Encerrado em</div>
                  <div>{formatDateTime(att.closed_at)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Motivo</div>
                  <div className="truncate">{att.closed_reason ?? "—"}</div>
                </div>
              </div>

              {/* SLA */}
              <div className="bg-muted/30 p-3 rounded-lg grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">TME</div>
                  <div className="text-lg font-mono">{formatDuration(att.wait_seconds)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">TPR</div>
                  <div className="text-lg font-mono">{formatDuration(att.first_response_time_seconds)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">TMA</div>
                  <div className="text-lg font-mono">{formatDuration(att.handle_seconds)}</div>
                </div>
              </div>

              {/* Contadores */}
              <div className="flex flex-row flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {att.msg_customer_count ?? 0} msgs cliente
                </span>
                <span>{att.msg_agent_count ?? 0} msgs agente</span>
                <span>{att.handoffs_count ?? 0} transferências</span>
                <span>{att.reopen_count ?? 0} reaberturas</span>
              </div>

              {/* Ticket vinculado */}
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1.5">
                  Ticket vinculado
                </div>
                {ticket ? (
                  <button
                    onClick={handleOpenTicket}
                    className="w-full flex items-center justify-between gap-2 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <TicketCheck className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-mono text-sm truncate">{ticket.ticket_code}</span>
                      <Badge variant="outline" className="shrink-0">{ticket.status}</Badge>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ) : (
                  <div className="text-sm text-muted-foreground italic">Sem ticket vinculado</div>
                )}
              </div>
            </div>

            {/* Coluna direita — Timeline / IA */}
            <div className="space-y-4 min-w-0">
              {att.ai_summary && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="h-4 w-4 text-primary" />
                    Resumo IA
                  </div>
                  <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {att.ai_summary}
                  </div>
                  {att.ai_problem && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Problema</div>
                      <div className="text-sm whitespace-pre-wrap">{att.ai_problem}</div>
                    </div>
                  )}
                  {att.ai_solution && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Solução</div>
                      <div className="text-sm whitespace-pre-wrap">{att.ai_solution}</div>
                    </div>
                  )}
                </div>
              )}

              {(att.ai_category || (att.ai_tags && att.ai_tags.length > 0)) && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
                    Categoria & Tags
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {att.ai_category && <Badge>{att.ai_category}</Badge>}
                    {(att.ai_tags ?? []).map((tag: string) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {csat && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-primary" />
                    Avaliação CSAT
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={csatColor(csat.score)}>
                      Nota {csat.score}
                    </Badge>
                    {csat.responded_at && (
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(csat.responded_at)}
                      </span>
                    )}
                  </div>
                  {csat.reason && (
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {csat.reason}
                    </div>
                  )}
                </div>
              )}

              {!att.ai_summary && !csat && !att.ai_category && (!att.ai_tags || att.ai_tags.length === 0) && (
                <div className="text-sm text-muted-foreground italic">
                  Sem informações de IA ou avaliação para este atendimento.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );

  const chatModal = (
    <AttendanceChatHistoryModal
      open={chatOpen}
      onOpenChange={setChatOpen}
      conversationId={att?.conversation_id ?? null}
      attendanceCode={att?.attendance_code ?? ""}
      contactName={att?.whatsapp_contacts?.name}
      openedAt={att?.opened_at ?? null}
      closedAt={att?.closed_at ?? null}
    />
  );

  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[95vh] p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b shrink-0">
              <SheetTitle>Detalhes do atendimento</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden">{content}</div>
          </SheetContent>
        </Sheet>
        {chatModal}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>Detalhes do atendimento</DialogTitle>
          </DialogHeader>
          <div className="max-h-[calc(90vh-72px)] overflow-hidden">{content}</div>
        </DialogContent>
      </Dialog>
      {chatModal}
    </>
  );
}

export default AttendanceDetailModal;
