import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { CreateChildTicketDialog } from "@/components/tickets/CreateChildTicketDialog";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { StartConversationFromTicketDialog } from "@/components/tickets/StartConversationFromTicketDialog";
import { TicketAttachments } from "@/components/tickets/TicketAttachments";
import {
  Loader2, Bot, MessageCircle, Plus, Calendar, Clock, Phone, User, Mail,
  TicketCheck, ArrowUpRight, Send, Headphones, MessageSquareText, Timer, Sparkles,
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

function formatEvtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editClassification, setEditClassification] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [startConvOpen, setStartConvOpen] = useState(false);
  const [newContactNome, setNewContactNome] = useState("");
  const [newContactFone, setNewContactFone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactCargo, setNewContactCargo] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [viewChatOpen, setViewChatOpen] = useState(false);
  const [viewChatMeta, setViewChatMeta] = useState<{ code: string; contact: string; openedAt: string | null; closedAt: string | null; conversationId: string | null }>({ code: "", contact: "", openedAt: null, closedAt: null, conversationId: null });
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  useEffect(() => { if (open) setMobileView("details"); }, [open]);
  useEffect(() => {
    if (!open) {
      setEditClassification(false);
    }
  }, [open]);

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
          parent:parent_ticket_id(id, ticket_code, status),
          whatsapp_contacts:contact_id(name, phone_number)
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

  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ["support_ticket_events", ticketId],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_ticket_events" as any) as any)
        .select("id, user_id, event_type, content, old_value, new_value, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        user_id: string;
        event_type: string;
        content: string | null;
        old_value: string | null;
        new_value: string | null;
        created_at: string;
      }>;
    },
  });

  const { data: linkedAttendances = [] } = useQuery({
    queryKey: ["ticket_linked_attendances", ticketId, ticket?.attendance_id],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data: byTicketId } = await (supabase.from("support_attendances" as any) as any)
        .select(`
          id, attendance_code, status, closure_type,
          opened_at, closed_at, handle_seconds,
          ai_summary, participant_type, participant_label,
          whatsapp_contacts:contact_id(name, phone_number),
          support_departments:department_id(name)
        `)
        .eq("ticket_id", ticketId)
        .order("opened_at", { ascending: false });

      const originalId = ticket?.attendance_id;
      let results = (byTicketId ?? []) as any[];

      if (originalId && !results.find((a: any) => a.id === originalId)) {
        const { data: original } = await (supabase.from("support_attendances" as any) as any)
          .select(`
            id, attendance_code, status, closure_type,
            opened_at, closed_at, handle_seconds,
            ai_summary, participant_type, participant_label,
            whatsapp_contacts:contact_id(name, phone_number),
            support_departments:department_id(name)
          `)
          .eq("id", originalId)
          .maybeSingle();
        if (original) results = [original, ...results];
      }

      return results;
    },
  });

  const handleViewAttendanceChat = async (att: any) => {
    const { data } = await (supabase.from("support_attendances" as any) as any)
      .select("conversation_id")
      .eq("id", att.id)
      .maybeSingle();

    setViewChatMeta({
      code: att.attendance_code ?? "",
      contact: att.whatsapp_contacts?.name ?? att.participant_label ?? "—",
      openedAt: att.opened_at,
      closedAt: att.closed_at,
      conversationId: data?.conversation_id ?? null,
    });
    setViewChatOpen(true);
  };

  const { data: eventAgents = [] } = useQuery({
    queryKey: ["ticket_event_agents", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionarios:funcionario_id(nome)")
        .eq("tenant_id", tid)
        .not("funcionario_id", "is", null);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p: any) => p.funcionarios?.nome)
        .map((p: any) => ({ user_id: p.user_id as string, nome: p.funcionarios.nome as string }));
    },
  });

  const getAgentName = (uid: string) => eventAgents.find((a) => a.user_id === uid)?.nome ?? "Sistema";

  const ticketClienteId = ticket?.cliente_id ?? ticket?.clientes?.id ?? null;

  const { data: clienteContatos = [], refetch: refetchContatos } = useQuery({
    queryKey: ["ticket_detail_contatos", ticketClienteId],
    enabled: !!ticketClienteId,
    queryFn: async () => {
      if (!ticketClienteId) return [];
      const { data: cli } = await (supabase.from("clientes" as any) as any)
        .select("contato_nome, contato_fone")
        .eq("id", ticketClienteId)
        .maybeSingle();
      const { data: contatos } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id, nome, fone, email, cargo")
        .eq("cliente_id", ticketClienteId)
        .order("nome");
      const result: Array<{ id: string; nome: string; detalhe: string }> = [];
      if (cli?.contato_nome) {
        result.push({
          id: "principal",
          nome: cli.contato_nome,
          detalhe: cli.contato_fone ? `${cli.contato_fone} · Principal` : "Principal",
        });
      }
      (contatos ?? []).forEach((c: any) => {
        result.push({
          id: c.id,
          nome: c.nome,
          detalhe: [c.cargo, c.fone, c.email].filter(Boolean).join(" · "),
        });
      });
      return result;
    },
  });

  const handleCreateContact = async () => {
    if (!newContactNome.trim() || !ticketClienteId) return;
    setSavingContact(true);
    try {
      const { data: inserted, error } = await (supabase.from("cliente_contatos" as any) as any)
        .insert({
          cliente_id: ticketClienteId,
          tenant_id: tid,
          nome: newContactNome.trim(),
          fone: newContactFone.trim() || null,
          email: newContactEmail.trim() || null,
          cargo: newContactCargo.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Contato adicionado");
      setNewContactOpen(false);
      setNewContactNome("");
      setNewContactFone("");
      setNewContactEmail("");
      setNewContactCargo("");
      await refetchContatos();
      if (inserted?.id) {
        handleFieldUpdate({ cliente_contato_id: inserted.id });
      }
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setSavingContact(false);
    }
  };

  const currentContactName = useMemo(() => {
    if (ticket?.cliente_contato_id) {
      const found = clienteContatos.find(c => c.id === ticket.cliente_contato_id);
      if (found) return found.nome;
    }
    if (ticket?.whatsapp_contacts?.name) {
      return ticket.whatsapp_contacts.name;
    }
    return null;
  }, [ticket, clienteContatos]);

  const FIELD_LABELS: Record<string, string> = {
    status: "Status",
    responsavel_user_id: "Responsável",
    department_id: "Setor",
    category_id: "Categoria",
    subcategory_id: "Subcategoria",
    service_type_id: "Tipo de serviço",
    produto_id: "Produto",
    agendado_para: "Agendado para",
    previsao_encerramento: "Previsão encerramento",
    canal_origem: "Canal",
    tipo_horario: "Tipo horário",
    prioridade: "Prioridade",
    observacao_agente: "Observação",
    cliente_contato_id: "Contato",
  };

  const resolveValueLabel = (field: string, value: string | null): string => {
    if (!value) return "—";
    switch (field) {
      case "status":
        return STATUS_LABELS[value] ?? value;
      case "responsavel_user_id":
        return eventAgents.find(a => a.user_id === value)?.nome ?? value.slice(0, 8) + "...";
      case "department_id":
        return departamentos.find((d: any) => d.id === value)?.name ?? value.slice(0, 8) + "...";
      case "category_id":
        return categories.find((c: any) => c.id === value)?.nome ?? value.slice(0, 8) + "...";
      case "subcategory_id":
        return subcategories.find((s: any) => s.id === value)?.nome ?? value.slice(0, 8) + "...";
      case "service_type_id":
        return serviceTypes.find((t: any) => t.id === value)?.nome ?? value.slice(0, 8) + "...";
      case "produto_id":
        return produtos.find((p: any) => String(p.id) === value)?.nome ?? value;
      case "canal_origem": {
        const labels: Record<string, string> = { whatsapp: "WhatsApp", telefone: "Telefone", presencial: "Presencial", email: "E-mail" };
        return labels[value] ?? value;
      }
      case "tipo_horario":
        return value === "comercial" ? "Comercial" : value === "plantao" ? "Plantão" : value;
      case "prioridade":
        return value.charAt(0).toUpperCase() + value.slice(1);
      case "agendado_para":
      case "previsao_encerramento":
        try { return formatEvtDate(value); } catch { return value; }
      case "cliente_contato_id":
        return clienteContatos.find(c => c.id === value)?.nome ?? value.slice(0, 8) + "...";
      default:
        return value.length > 50 ? value.slice(0, 50) + "..." : value;
    }
  };

  const { data: departamentos = [] } = useQuery({
    queryKey: ["ticket_detail_departamentos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name").eq("tenant_id", tid).eq("is_active", true).order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["ticket_detail_produtos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome").eq("tenant_id", tid).order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["ticket_detail_categories", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_categories" as any) as any)
        .select("id, nome, produto_id").eq("tenant_id", tid).eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; produto_id: number | null }>;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ["ticket_detail_subcategories", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_subcategories" as any) as any)
        .select("id, nome, category_id").eq("tenant_id", tid).eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; category_id: string }>;
    },
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["ticket_detail_service_types", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_types" as any) as any)
        .select("id, nome").eq("tenant_id", tid).eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const handleFieldUpdate = async (fields: Record<string, any>) => {
    if (!ticketId) return;
    setUpdating(true);
    try {
      const { error } = await (supabase.rpc as any)("update_ticket_fields", {
        p_ticket_id: ticketId,
        p_fields: fields,
      });
      if (error) throw error;
      toast.success("Ticket atualizado");
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
      refetchEvents();
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setUpdating(false);
    }
  };


  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !ticketId) return;
    setAddingComment(true);
    try {
      const { error } = await (supabase.rpc as any)("add_ticket_event", {
        p_ticket_id: ticketId,
        p_event_type: "comment",
        p_content: newComment.trim(),
      });
      if (error) throw error;
      toast.success("Ocorrência registrada");
      setNewComment("");
      refetchEvents();
      queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setAddingComment(false);
    }
  };

  const breadcrumb = ticket ? [
    ticket.produtos?.nome,
    ticket.service_categories?.nome,
    ticket.service_subcategories?.nome,
  ].filter(Boolean).join(" › ") : "";
  const tipoServico = ticket?.service_types?.nome;

  const detailsContent = !ticket ? null : (
    <div className="space-y-4 pr-2 pt-1">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold text-primary">{ticket.ticket_code ?? "—"}</span>
        <Select
          value={ticket.status ?? ""}
          onValueChange={(v) => {
            handleFieldUpdate({ status: v });
          }}
          disabled={updating}
        >
          <SelectTrigger className="h-7 w-auto min-w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="aberto">Aberto</SelectItem>
            <SelectItem value="em_andamento">Em andamento</SelectItem>
            <SelectItem value="agendado">Agendado</SelectItem>
            <SelectItem value="aguardando_terceiro">Aguardando terceiro</SelectItem>
            <SelectItem value="concluido">Concluído</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={ticket.prioridade ?? ""}
          onValueChange={(v) => handleFieldUpdate({ prioridade: v })}
          disabled={updating}
        >
          <SelectTrigger className="h-7 w-auto min-w-[110px] text-xs">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="baixa">Baixa</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="urgente">Urgente</SelectItem>
          </SelectContent>
        </Select>
        {ticket.canal_origem && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <ChannelIcon canal={ticket.canal_origem} />
            {ticket.canal_origem}
          </Badge>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => setStartConvOpen(true)}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Conversa
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => setChildOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Filho
        </Button>
      </div>

      {/* Classificação editável */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase text-muted-foreground">Classificação</p>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditClassification(!editClassification)}>
            {editClassification ? "Fechar" : "Editar"}
          </Button>
        </div>
        {!editClassification ? (
          <p className="text-xs text-muted-foreground">
            {breadcrumb || "Sem classificação"}
            {tipoServico && <span className="text-foreground/70"> · {tipoServico}</span>}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Produto</Label>
              <Select value={ticket.produto_id ? String(ticket.produto_id) : ""} onValueChange={(v) => handleFieldUpdate({ produto_id: Number(v) })} disabled={updating}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {produtos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Categoria</Label>
              <Select value={ticket.category_id ?? ""} onValueChange={(v) => handleFieldUpdate({ category_id: v })} disabled={updating}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {categories.filter(c => !ticket?.produto_id || c.produto_id === ticket.produto_id || c.produto_id === null).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Subcategoria</Label>
              <Select value={ticket.subcategory_id ?? ""} onValueChange={(v) => handleFieldUpdate({ subcategory_id: v })} disabled={updating}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {subcategories.filter(s => s.category_id === ticket?.category_id).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Tipo serviço</Label>
              <Select value={ticket.service_type_id ?? ""} onValueChange={(v) => handleFieldUpdate({ service_type_id: v })} disabled={updating}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {serviceTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

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

      {/* Metadados grid editáveis */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Responsável</span>
          <Select
            value={ticket?.responsavel_user_id ?? ""}
            onValueChange={(v) => handleFieldUpdate({ responsavel_user_id: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Não atribuído" />
            </SelectTrigger>
            <SelectContent>
              {eventAgents.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Setor</span>
          <Select
            value={ticket?.department_id ?? "none"}
            onValueChange={(v) => handleFieldUpdate({ department_id: v === "none" ? null : v })}
            disabled={updating}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {departamentos.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Contato solicitante */}
        <div className="col-span-2 space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Contato solicitante</span>
          <div className="flex items-center gap-2">
            {ticket?.contact_id && !ticket?.cliente_contato_id ? (
              <p className="text-sm h-8 flex items-center gap-2 flex-1">
                {ticket?.whatsapp_contacts?.name ?? "—"}
                <Badge variant="outline" className="text-[10px]">WhatsApp</Badge>
              </p>
            ) : (
              <Select
                value={ticket?.cliente_contato_id ?? "none"}
                onValueChange={(v) => handleFieldUpdate({ cliente_contato_id: v === "none" ? null : v })}
                disabled={updating}
              >
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue placeholder="Selecione o contato..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem contato</SelectItem>
                  {clienteContatos.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} {c.detalhe ? `(${c.detalhe})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setNewContactOpen(true)}
              disabled={!ticketClienteId}
              title="Adicionar contato"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Tipo horário</span>
          <Select
            value={ticket?.tipo_horario ?? "comercial"}
            onValueChange={(v) => handleFieldUpdate({ tipo_horario: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comercial">Comercial</SelectItem>
              <SelectItem value="plantao">Plantão</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Aberto em</span>
          <p className="text-sm h-8 flex items-center">{ticket?.aberto_em ? new Date(ticket.aberto_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Agendado para</span>
          <Input
            type="datetime-local"
            className="h-8 text-sm"
            defaultValue={ticket?.agendado_para ? new Date(ticket.agendado_para).toISOString().slice(0, 16) : ""}
            key={`agendado-${ticket?.agendado_para}`}
            onBlur={(e) => {
              const val = e.target.value;
              if (val) handleFieldUpdate({ agendado_para: new Date(val).toISOString() });
            }}
            disabled={updating}
          />
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Previsão encerramento</span>
          <Input
            type="datetime-local"
            className="h-8 text-sm"
            defaultValue={ticket?.previsao_encerramento ? new Date(ticket.previsao_encerramento).toISOString().slice(0, 16) : ""}
            key={`previsao-${ticket?.previsao_encerramento}`}
            onBlur={(e) => {
              const val = e.target.value;
              if (val) handleFieldUpdate({ previsao_encerramento: new Date(val).toISOString() });
            }}
            disabled={updating}
          />
        </div>
      </div>

      {/* Observação do agente */}
      {ticket?.observacao_agente && (
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Observação do agente</span>
          <p className="text-sm bg-muted/30 rounded-md px-2.5 py-1.5 whitespace-pre-wrap">{ticket.observacao_agente}</p>
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
          onClick={() => setStartConvOpen(true)}
        >
          <MessageCircle className="h-4 w-4 mr-1.5" />
          Iniciar conversa
        </Button>
        <Button size="sm" variant="outline" onClick={() => setChildOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Ticket filho
        </Button>
      </div>

      {/* Conversas vinculadas */}
      {linkedAttendances.length > 0 && (
        <div className="space-y-2 pt-2">
          <Separator />
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Conversas vinculadas</span>
            <Badge variant="secondary" className="text-[10px]">{linkedAttendances.length}</Badge>
          </div>
          <div className="space-y-1.5">
            {linkedAttendances.map((att: any) => {
              const statusDot: Record<string, string> = {
                waiting: "bg-yellow-400",
                in_progress: "bg-blue-400",
                closed: "bg-green-400",
              };
              const contactName = att.whatsapp_contacts?.name ?? att.participant_label ?? "—";
              const isThirdParty = att.participant_type === "third_party";
              return (
                <button
                  key={att.id}
                  onClick={() => handleViewAttendanceChat(att)}
                  className="w-full text-left border border-border rounded-md p-2.5 hover:border-primary/40 transition-colors flex items-center gap-2"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${statusDot[att.status] ?? "bg-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{contactName}</span>
                      {isThirdParty && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1">Terceiro</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{att.attendance_code}</span>
                      <span>·</span>
                      <span>{att.opened_at ? new Date(att.opened_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + new Date(att.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                      <span>·</span>
                      <span>{att.status === "closed" ? "Encerrado" : att.status === "in_progress" ? "Em andamento" : "Aguardando"}</span>
                    </div>
                  </div>
                  <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}
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

      {/* Timeline de ocorrências */}
      <div className="pt-4 border-t space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Ocorrências</p>
          {events.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{events.length}</Badge>
          )}
        </div>

        {/* Formulário de nova ocorrência */}
        <div className="flex gap-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Registrar ocorrência..."
            className="min-h-[60px] text-sm flex-1"
            rows={2}
          />
          <Button
            size="sm"
            className="self-end h-9"
            onClick={handleAddComment}
            disabled={!newComment.trim() || addingComment}
          >
            {addingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">Nenhuma ocorrência registrada</p>
        ) : (
          <div className="space-y-0 border-l-2 border-border ml-2">
            {events.map((evt) => (
              <div key={evt.id} className="relative pl-5 pb-4">
                <div className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${
                  evt.event_type === "comment" ? "bg-primary" :
                  evt.event_type === "status_change" ? "bg-blue-400" :
                  evt.event_type === "ai_summary" ? "bg-blue-400" :
                  evt.event_type === "assignment_change" ? "bg-purple-400" :
                  evt.event_type === "reclassification" ? "bg-orange-400" :
                  evt.event_type === "department_change" ? "bg-cyan-400" :
                  evt.event_type === "created" ? "bg-green-400" :
                  evt.event_type === "closed" ? "bg-red-400" :
                  "bg-muted-foreground"
                }`} />
                {evt.event_type === "comment" ? (
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium">{getAgentName(evt.user_id)}</span>
                      <span className="text-[10px] text-muted-foreground">{formatEvtDate(evt.created_at)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded-md px-2.5 py-1.5">{evt.content}</p>
                  </div>
                ) : evt.event_type === "status_change" ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{getAgentName(evt.user_id)}</span>
                    <span className="text-xs">alterou status:</span>
                    <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[evt.old_value ?? ""] ?? evt.old_value}</Badge>
                    <span className="text-[10px]">→</span>
                    <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[evt.new_value ?? ""] ?? evt.new_value}</Badge>
                    <span className="text-[10px] text-muted-foreground">{formatEvtDate(evt.created_at)}</span>
                  </div>
                ) : evt.event_type === "ai_summary" ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Bot className="h-3.5 w-3.5 text-blue-400" />
                      <span className="text-xs text-muted-foreground">{evt.content}</span>
                      <span className="text-[10px] text-muted-foreground">{formatEvtDate(evt.created_at)}</span>
                    </div>
                    <details className="bg-blue-500/5 border border-blue-500/20 rounded-md px-2.5 py-1.5">
                      <summary className="text-[11px] text-blue-400 cursor-pointer hover:underline">Ver resumo IA</summary>
                      <p className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap">{evt.new_value}</p>
                    </details>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{getAgentName(evt.user_id)}</span>
                      <span className="text-xs">alterou <span className="font-medium">{FIELD_LABELS[evt.content ?? ""] ?? evt.content ?? evt.event_type}</span>:</span>
                      <span className="text-[10px] text-muted-foreground">{formatEvtDate(evt.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 ml-0.5">
                      <span className="text-[11px] text-muted-foreground">{resolveValueLabel(evt.content ?? "", evt.old_value)}</span>
                      <span className="text-[10px] text-muted-foreground">→</span>
                      <span className="text-[11px] font-medium">{resolveValueLabel(evt.content ?? "", evt.new_value)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const loadingNode = (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );

  const childDialog = (
    <CreateChildTicketDialog
      open={childOpen}
      onOpenChange={setChildOpen}
      parentTicketId={ticketId ?? ""}
      parentTicketCode={ticket?.ticket_code ?? ""}
      parentClienteName={ticket?.clientes?.nome_fantasia}
      parentCategoria={breadcrumb}
      onCreated={() => {
        queryClient.invalidateQueries({ queryKey: ["support_ticket_children", ticketId] });
        queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      }}
    />
  );

  const newContactDialog = (
    <Dialog open={newContactOpen} onOpenChange={setNewContactOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Nome *</Label>
            <Input value={newContactNome} onChange={(e) => setNewContactNome(e.target.value)} placeholder="Nome do contato" className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Telefone</Label>
              <Input value={newContactFone} onChange={(e) => setNewContactFone(e.target.value)} placeholder="(00) 00000-0000" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">E-mail</Label>
              <Input value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} placeholder="email@exemplo.com" className="h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cargo</Label>
            <Input value={newContactCargo} onChange={(e) => setNewContactCargo(e.target.value)} placeholder="Ex: Gerente, Caixa" className="h-9" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setNewContactOpen(false)}>Cancelar</Button>
          <Button onClick={handleCreateContact} disabled={savingContact || !newContactNome.trim()}>
            {savingContact && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    return (
      <>
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
        {childDialog}
        {newContactDialog}
        <AttendanceChatHistoryModal
          open={viewChatOpen}
          onOpenChange={setViewChatOpen}
          conversationId={viewChatMeta.conversationId}
          attendanceCode={viewChatMeta.code}
          contactName={viewChatMeta.contact}
          openedAt={viewChatMeta.openedAt}
          closedAt={viewChatMeta.closedAt}
        />
        <StartConversationFromTicketDialog
          open={startConvOpen}
          onOpenChange={setStartConvOpen}
          ticketId={ticketId ?? ""}
          ticketCode={ticket?.ticket_code ?? ""}
          clienteId={ticketClienteId}
          clienteNome={ticket?.clientes?.nome_fantasia}
          departmentId={ticket?.department_id}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["ticket_linked_attendances", ticketId] });
            queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
          }}
        />
      </>
    );
  }

  return (
    <>
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
      {childDialog}
      {newContactDialog}
      <AttendanceChatHistoryModal
        open={viewChatOpen}
        onOpenChange={setViewChatOpen}
        conversationId={viewChatMeta.conversationId}
        attendanceCode={viewChatMeta.code}
        contactName={viewChatMeta.contact}
        openedAt={viewChatMeta.openedAt}
        closedAt={viewChatMeta.closedAt}
      />
      <StartConversationFromTicketDialog
        open={startConvOpen}
        onOpenChange={setStartConvOpen}
        ticketId={ticketId ?? ""}
        ticketCode={ticket?.ticket_code ?? ""}
        clienteId={ticketClienteId}
        clienteNome={ticket?.clientes?.nome_fantasia}
        departmentId={ticket?.department_id}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["ticket_linked_attendances", ticketId] });
          queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
        }}
      />
    </>
  );
}

export default SupportTicketDetailDialog;
