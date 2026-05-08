import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CreateChildTicketDialog } from "@/components/tickets/CreateChildTicketDialog";
import {
  Loader2, Bot, MessageCircle, Plus, Calendar, Clock, Phone, User, Mail,
  TicketCheck, ArrowUpRight,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  agendado: "Agendado",
  em_andamento: "Em andamento",
  aguardando_terceiro: "Aguardando terceiro",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const STATUS_CLASSES: Record<string, string> = {
  aberto: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  agendado: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  em_andamento: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  aguardando_terceiro: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  concluido: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelado: "bg-red-500/10 text-red-400 border-red-500/20 opacity-70",
};

const PRIORITY_CLASSES: Record<string, string> = {
  baixa: "bg-muted text-muted-foreground border-border",
  media: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  alta: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  urgente: "bg-red-500/10 text-red-400 border-red-500/20",
};

function ChannelIcon({ canal }: { canal: string | null }) {
  const cls = "h-3.5 w-3.5";
  switch (canal) {
    case "whatsapp": return <MessageCircle className={cls} />;
    case "telefone": return <Phone className={cls} />;
    case "presencial": return <User className={cls} />;
    case "email": return <Mail className={cls} />;
    default: return <MessageCircle className={cls} />;
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

interface Props {
  ticketId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupportTicketDetailDialog({ ticketId, open, onOpenChange }: Props) {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"details" | "timeline">("details");
  const [childOpen, setChildOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => { if (open) setMobileView("details"); }, [open]);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["support_ticket_detail", ticketId],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_tickets" as any) as any)
        .select(`
          *,
          clientes:cliente_id(id, nome_fantasia, cnpj, telefone_whatsapp, produto_id),
          produtos:produto_id(nome),
          service_categories:category_id(nome),
          service_subcategories:subcategory_id(nome),
          service_types:service_type_id(nome),
          parent:parent_ticket_id(id, ticket_code, status)
        `)
        .eq("id", ticketId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: children = [] } = useQuery({
    queryKey: ["support_ticket_children", ticketId],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_tickets" as any) as any)
        .select("id, ticket_code, status, assunto, aberto_em, agendado_para")
        .eq("parent_ticket_id", ticketId)
        .order("aberto_em");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const attendanceId = ticket?.attendance_id ?? null;

  const { data: csat } = useQuery({
    queryKey: ["support_ticket_csat", attendanceId],
    enabled: !!attendanceId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_csat" as any) as any)
        .select("score, reason, responded_at")
        .eq("attendance_id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: attendance } = useQuery({
    queryKey: ["support_ticket_attendance", attendanceId],
    enabled: !!attendanceId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("ai_summary, ai_problem, ai_solution, ai_tags, ai_category, attendance_code")
        .eq("id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const breadcrumb = ticket ? [
    ticket.produtos?.nome,
    ticket.service_categories?.nome,
    ticket.service_subcategories?.nome,
  ].filter(Boolean).join(" › ") : "";
  const tipoServico = ticket?.service_types?.nome;

  const detailsContent = !ticket ? null : (
    <div className="space-y-4 pr-2">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold text-primary">{ticket.ticket_code ?? "—"}</span>
        <Badge className={`text-[10px] border ${STATUS_CLASSES[ticket.status] ?? ""}`}>
          {STATUS_LABELS[ticket.status] ?? ticket.status}
        </Badge>
        {ticket.prioridade && (
          <Badge className={`text-[10px] border ${PRIORITY_CLASSES[ticket.prioridade] ?? ""}`}>
            {ticket.prioridade}
          </Badge>
        )}
        {ticket.canal_origem && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <ChannelIcon canal={ticket.canal_origem} />
            {ticket.canal_origem}
          </Badge>
        )}
      </div>

      {/* Classificação */}
      {breadcrumb && (
        <p className="text-xs text-muted-foreground">
          {breadcrumb}
          {tipoServico && <span className="text-foreground/70"> · {tipoServico}</span>}
        </p>
      )}

      {/* Cliente */}
      {ticket.clientes && (
        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-semibold">{ticket.clientes.nome_fantasia ?? "—"}</p>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {ticket.clientes.cnpj && <p>CNPJ: {ticket.clientes.cnpj}</p>}
            {ticket.clientes.telefone_whatsapp && <p>Tel: {ticket.clientes.telefone_whatsapp}</p>}
          </div>
        </div>
      )}

      {/* Assunto */}
      {ticket.assunto && (
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Assunto</p>
          <p className="text-sm">{ticket.assunto}</p>
        </div>
      )}

      {/* Descrição */}
      {ticket.descricao && (
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Descrição</p>
          <p className="text-sm whitespace-pre-wrap">{ticket.descricao}</p>
        </div>
      )}

      <Separator />

      {/* Metadados grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Atendente</p>
          <p className="text-sm font-mono truncate">
            {ticket.responsavel_user_id ? String(ticket.responsavel_user_id).slice(0, 8) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Tipo horário</p>
          <p className="text-sm">{ticket.tipo_horario ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Aberto em</p>
          <p className="text-sm">{formatDateTime(ticket.aberto_em)}</p>
        </div>
        {ticket.concluido_em && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Concluído em</p>
            <p className="text-sm">{formatDateTime(ticket.concluido_em)}</p>
          </div>
        )}
        {ticket.agendado_para && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Agendado para</p>
            <p className="text-sm text-yellow-400 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateTime(ticket.agendado_para)}
            </p>
          </div>
        )}
        {attendance?.attendance_code && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Cód. atendimento</p>
            <p className="text-sm font-mono">{attendance.attendance_code}</p>
          </div>
        )}
      </div>

      {/* Observação do agente */}
      {ticket.observacao_agente && (
        <div className="border border-border rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Observação do agente</p>
          <p className="text-sm whitespace-pre-wrap">{ticket.observacao_agente}</p>
        </div>
      )}

      {/* Resumo IA do atendimento */}
      {attendance?.ai_summary && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            <p className="text-[10px] uppercase text-muted-foreground">Resumo IA</p>
          </div>
          <p className="text-sm whitespace-pre-wrap line-clamp-6">{attendance.ai_summary}</p>
          {attendance.ai_problem && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mt-2 mb-0.5">Problema</p>
              <p className="text-xs">{attendance.ai_problem}</p>
            </div>
          )}
          {attendance.ai_solution && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mt-2 mb-0.5">Solução</p>
              <p className="text-xs">{attendance.ai_solution}</p>
            </div>
          )}
        </div>
      )}

      {/* Ticket pai */}
      {ticket.parent && (
        <button
          onClick={() => {
            onOpenChange(false);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("open-ticket-detail", { detail: { ticketId: ticket.parent.id } }));
            }, 300);
          }}
          className="w-full border border-border rounded-lg p-2.5 flex items-center gap-2 hover:border-primary/40 transition-colors"
        >
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase text-muted-foreground">Ticket pai:</span>
          <span className="font-mono text-xs font-semibold text-primary">{ticket.parent.ticket_code}</span>
          <Badge className={`text-[10px] border ${STATUS_CLASSES[ticket.parent.status] ?? ""}`}>
            {STATUS_LABELS[ticket.parent.status] ?? ticket.parent.status}
          </Badge>
        </button>
      )}

      {/* Ações */}
      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!attendanceId}
          onClick={() => toast.info("Em breve")}
        >
          <MessageCircle className="h-4 w-4 mr-1.5" />
          Ver chat
        </Button>
        <Button size="sm" variant="outline" onClick={() => setChildOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Ticket filho
        </Button>
      </div>
    </div>
  );

  const timelineItems: Array<{
    key: string;
    color: string;
    when: string | null;
    node: React.ReactNode;
  }> = [];

  if (attendance?.ai_summary) {
    timelineItems.push({
      key: "ai",
      color: "bg-blue-500",
      when: ticket?.aberto_em ?? null,
      node: (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase text-blue-400 font-medium">Resumo IA</p>
          </div>
          <p className="text-xs line-clamp-4">{attendance.ai_summary}</p>
        </div>
      ),
    });
  }

  if (ticket?.observacao_agente) {
    timelineItems.push({
      key: "obs",
      color: "bg-muted-foreground",
      when: ticket?.aberto_em ?? null,
      node: (
        <div className="border border-border rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Observação do agente</p>
          <p className="text-xs whitespace-pre-wrap line-clamp-4">{ticket.observacao_agente}</p>
        </div>
      ),
    });
  }

  if (csat) {
    const score = csat.score ?? 0;
    const color = score >= 4 ? "bg-green-500" : score === 3 ? "bg-yellow-500" : "bg-red-500";
    timelineItems.push({
      key: "csat",
      color,
      when: csat.responded_at,
      node: (
        <div className="border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] uppercase text-muted-foreground">CSAT</p>
            <Badge variant="outline" className="text-[10px]">Nota {score}</Badge>
          </div>
          {csat.reason && <p className="text-xs">{csat.reason}</p>}
        </div>
      ),
    });
  }

  children.forEach((c) => {
    timelineItems.push({
      key: `child-${c.id}`,
      color: "bg-blue-500",
      when: c.aberto_em,
      node: (
        <button
          onClick={() => {
            onOpenChange(false);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("open-ticket-detail", { detail: { ticketId: c.id } }));
            }, 300);
          }}
          className="w-full text-left border border-blue-500/30 rounded-lg p-3 hover:border-blue-500/60 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <TicketCheck className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-mono text-xs font-semibold text-blue-400">{c.ticket_code}</span>
            <Badge className={`text-[10px] border ${STATUS_CLASSES[c.status] ?? ""}`}>
              {STATUS_LABELS[c.status] ?? c.status}
            </Badge>
          </div>
          {c.assunto && <p className="text-xs text-muted-foreground line-clamp-2">{c.assunto}</p>}
        </button>
      ),
    });
  });

  const timelineContent = (
    <div className="p-4 space-y-4">
      <p className="text-sm font-medium">Timeline</p>
      {timelineItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem registros na timeline</p>
      ) : (
        <div className="relative pl-6 space-y-4">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          {timelineItems.map((item) => (
            <div key={item.key} className="relative">
              <div className={`absolute -left-[22px] top-1.5 h-3 w-3 rounded-full ring-2 ring-background ${item.color}`} />
              <div className="space-y-1">
                {item.when && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(item.when)}
                  </p>
                )}
                {item.node}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const loadingNode = (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle>Detalhes do Ticket</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col h-[calc(95vh-60px)]">
            <div className="flex gap-2 p-2 border-b shrink-0">
              <Button
                variant={mobileView === "details" ? "default" : "outline"}
                size="sm" className="flex-1"
                onClick={() => setMobileView("details")}
              >Detalhes</Button>
              <Button
                variant={mobileView === "timeline" ? "default" : "outline"}
                size="sm" className="flex-1 gap-1"
                onClick={() => setMobileView("timeline")}
              >
                <MessageCircle className="h-4 w-4" />Timeline
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              {isLoading ? loadingNode : (
                <ScrollArea className="h-full">
                  {mobileView === "details"
                    ? <div className="p-4">{detailsContent}</div>
                    : timelineContent}
                </ScrollArea>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>Detalhes do Ticket</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-4">
          {isLoading ? loadingNode : (
            <div className="flex h-[calc(90vh-80px)] gap-4">
              <ScrollArea className="flex-1 min-w-0">
                <div className="pr-4 pb-4">{detailsContent}</div>
              </ScrollArea>
              <div className="w-[380px] shrink-0 border-l flex flex-col min-h-0">
                <ScrollArea className="flex-1">{timelineContent}</ScrollArea>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SupportTicketDetailDialog;
