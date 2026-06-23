import { useState, useEffect, useMemo, useRef } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { CreateChildTicketDialog } from "@/components/tickets/CreateChildTicketDialog";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { StartConversationFromTicketDialog } from "@/components/tickets/StartConversationFromTicketDialog";
import { TicketAttachments } from "@/components/tickets/TicketAttachments";
import {
  Loader2, Bot, MessageCircle, Plus, Calendar, Clock, Phone, User, Mail,
  TicketCheck, ArrowUpRight, Send, Headphones, MessageSquareText, Timer, Sparkles,
  Tag as TagIcon, X, ListChecks, Trash2, ChevronDown, Building2, MessageSquare, UserPlus, Rocket,
  Check, Lock, RefreshCw,
} from "lucide-react";


const PRIORIDADES_STRIP = [
  { id: "baixa", name: "Baixa", color: "#10b981" },
  { id: "media", name: "Média", color: "#f59e0b" },
  { id: "alta", name: "Alta", color: "#ef4444" },
  { id: "urgente", name: "Urgente", color: "#dc2626" },
];

const CANAIS_STRIP = [
  { id: "telefone", name: "Telefone", icon: Phone },
  { id: "presencial", name: "Presencial", icon: Building2 },
  { id: "email", name: "E-mail", icon: Mail },
  { id: "whatsapp", name: "WhatsApp", icon: MessageSquare },
];


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
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [startConvOpen, setStartConvOpen] = useState(false);
  const [newContactNome, setNewContactNome] = useState("");
  const [newContactFone, setNewContactFone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactCargo, setNewContactCargo] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [viewChatOpen, setViewChatOpen] = useState(false);
  const [viewChatMeta, setViewChatMeta] = useState<{ code: string; contact: string; openedAt: string | null; closedAt: string | null; conversationId: string | null }>({ code: "", contact: "", openedAt: null, closedAt: null, conversationId: null });
  const [newCheckItem, setNewCheckItem] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeTargetStatusId, setCloseTargetStatusId] = useState<string | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(Math.max(startWidth + delta, 220), 700);
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [quickTagName, setQuickTagName] = useState("");
  const [quickTagColor, setQuickTagColor] = useState("#3b82f6");
  const [creatingTag, setCreatingTag] = useState(false);
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id ?? null));
  }, []);
  const { data: currentProfile } = useProfile(currentUserId ?? undefined);
  const isAdminOrHead = currentProfile?.role === "admin" || currentProfile?.role === "head" || currentProfile?.is_super_admin === true;

  const handleSoftDelete = async () => {
    if (!ticketId) return;
    setDeleting(true);
    try {
      const { error } = await (supabase.rpc as any)("soft_delete_ticket", { p_ticket_id: ticketId });
      if (error) throw error;
      toast.success("Ticket excluído");
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  useEffect(() => { if (open) setMobileView("details"); }, [open]);
  useEffect(() => {
    if (!open) {
    }
  }, [open]);

  // Realtime: sincroniza mudanças feitas por outros usuários no mesmo ticket
  useEffect(() => {
    if (!open || !ticketId) return;
    const channel = supabase
      .channel(`ticket-detail-rt-${ticketId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets", filter: `id=eq.${ticketId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
          queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_ticket_events", filter: `ticket_id=eq.${ticketId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_mentions", filter: `ticket_id=eq.${ticketId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["ticket_mentions", ticketId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, ticketId, queryClient]);


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
          parent:parent_ticket_id(id, ticket_code, status_id),
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
        .select("id, ticket_code, status_id, assunto, aberto_em, agendado_para")
        .eq("parent_ticket_id", ticketId)
        .order("aberto_em");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: ticketTags = [], refetch: refetchTags } = useQuery({
    queryKey: ["ticket_tags_assigned", ticketId],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_tag_assignments" as any) as any)
        .select("id, tag:tag_id(id, name, color)")
        .eq("ticket_id", ticketId);
      if (error) throw error;
      return ((data ?? []) as any[]).filter(a => a.tag).map(a => ({
        assignmentId: a.id as string,
        id: a.tag.id as string,
        name: a.tag.name as string,
        color: a.tag.color as string,
      }));
    },
  });

  const { data: availableTags = [] } = useQuery({
    queryKey: ["ticket_tags_available", tid],
    enabled: !!tid && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_tags" as any) as any)
        .select("id, name, color, department_id")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string; department_id: string | null }>;
    },
  });

  const handleAddTag = async (tagId: string) => {
    try {
      await (supabase.from("ticket_tag_assignments" as any) as any)
        .insert({ ticket_id: ticketId, tag_id: tagId });
      refetchTags();
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      toast.success("Tag adicionada");
    } catch { toast.error("Erro ao adicionar tag"); }
  };

  const handleRemoveTag = async (assignmentId: string) => {
    try {
      await (supabase.from("ticket_tag_assignments" as any) as any)
        .delete().eq("id", assignmentId);
      refetchTags();
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
    } catch { toast.error("Erro ao remover tag"); }
  };

  const handleCreateAndAddTag = async () => {
    if (!quickTagName.trim() || !tid || !ticketId) return;
    setCreatingTag(true);
    try {
      const { data: newTag, error: insertError } = await (supabase.from("ticket_tags" as any) as any)
        .insert({
          tenant_id: tid,
          name: quickTagName.trim(),
          color: quickTagColor,
          department_id: ticket?.department_id || null,
          is_active: true,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      if (newTag?.id) {
        await (supabase.from("ticket_tag_assignments" as any) as any)
          .insert({ ticket_id: ticketId, tag_id: newTag.id });
      }
      setQuickTagName("");
      setQuickTagColor("#3b82f6");
      refetchTags();
      queryClient.invalidateQueries({ queryKey: ["ticket_tags_available"] });
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      toast.success("Tag criada e adicionada");
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setCreatingTag(false);
    }
  };

  const { data: ticketMentions = [], refetch: refetchMentions } = useQuery({
    queryKey: ["ticket_mentions", ticketId],
    enabled: !!ticketId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_mentions" as any) as any)
        .select("id, mentioned_user_id, mentioned_by, seen_at, created_at")
        .eq("ticket_id", ticketId);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; mentioned_user_id: string; mentioned_by: string;
        seen_at: string | null; created_at: string;
      }>;
    },
  });

  const { data: agentesDisponiveis = [] } = useQuery({
    queryKey: ["agentes_mention", tid],
    enabled: !!tid && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, role, funcionarios:funcionario_id(nome)")
        .eq("tenant_id", tid)
        .not("funcionario_id", "is", null);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p: any) => p.funcionarios?.nome)
        .map((p: any) => ({ user_id: p.user_id as string, nome: p.funcionarios.nome as string }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome));
    },
  });

  const handleAddMention = async (userId: string) => {
    if (!ticketId || !tid) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from("ticket_mentions" as any) as any)
        .insert({ tenant_id: tid, ticket_id: ticketId, mentioned_user_id: userId, mentioned_by: user?.id });
      if (error) throw error;
      refetchMentions();
      toast.success("Agente marcado");
    } catch (err: any) {
      if (err?.message?.includes("duplicate")) toast.info("Agente já marcado");
      else toast.error("Erro: " + (err?.message ?? ""));
    }
  };

  const handleRemoveMention = async (mentionId: string) => {
    try {
      const { error } = await (supabase.from("ticket_mentions" as any) as any).delete().eq("id", mentionId);
      if (error) throw error;
      refetchMentions();
    } catch { toast.error("Erro ao remover"); }
  };

  const handleToggleCheck = async (index: number) => {
    const items = [...((ticket?.checklist as any[]) ?? [])];
    const willBeDone = !items[index].done;
    const itemText = items[index]?.text ?? "";
    items[index] = { ...items[index], done: willBeDone };
    const { error } = await (supabase.rpc as any)("update_ticket_checklist", {
      p_ticket_id: ticketId,
      p_checklist: items,
      p_action: willBeDone ? "check" : "uncheck",
      p_item_text: itemText,
    });
    if (error) { toast.error("Erro: " + (error.message ?? "")); return; }
    queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
  };

  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim()) return;
    const itemText = newCheckItem.trim();
    const items = [...((ticket?.checklist as any[]) ?? []), { text: itemText, done: false }];
    const { error } = await (supabase.rpc as any)("update_ticket_checklist", {
      p_ticket_id: ticketId,
      p_checklist: items,
      p_action: "add",
      p_item_text: itemText,
    });
    if (error) { toast.error("Erro: " + (error.message ?? "")); return; }
    setNewCheckItem("");
    queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
  };

  const handleRemoveCheckItem = async (index: number) => {
    const items = ((ticket?.checklist as any[]) ?? []).filter((_: any, i: number) => i !== index);
    await (supabase.from("support_tickets" as any) as any)
      .update({ checklist: items }).eq("id", ticketId);
    queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
  };

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
      const result: Array<{ id: string; nome: string; detalhe: string; fone?: string | null }> = [];
      if (cli?.contato_nome) {
        result.push({
          id: "principal",
          nome: cli.contato_nome,
          detalhe: cli.contato_fone ? `${cli.contato_fone} · Principal` : "Principal",
          fone: cli.contato_fone ?? null,
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

  const handleSelectContato = async (v: string) => {
    if (v === "none") {
      handleFieldUpdate({ cliente_contato_id: null });
      return;
    }
    if (v !== "principal") {
      handleFieldUpdate({ cliente_contato_id: v });
      return;
    }
    // "Principal" não é um contato real (sem uuid). Materializa idempotente
    // em cliente_contatos a partir do nome/fone do cliente e grava o uuid.
    const principal = clienteContatos.find((c: any) => c.id === "principal") as any;
    if (!ticketClienteId || !principal) return;
    try {
      const { data: existing } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id")
        .eq("cliente_id", ticketClienteId)
        .eq("nome", principal.nome)
        .limit(1)
        .maybeSingle();
      let contatoId = existing?.id as string | undefined;
      if (!contatoId) {
        const { data: inserted, error } = await (supabase.from("cliente_contatos" as any) as any)
          .insert({
            cliente_id: ticketClienteId,
            tenant_id: tid,
            nome: principal.nome,
            fone: principal.fone ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        contatoId = inserted.id;
      }
      await refetchContatos();
      handleFieldUpdate({ cliente_contato_id: contatoId });
    } catch (err: any) {
      toast.error("Erro ao definir contato: " + (err.message ?? ""));
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
    status_id: "Status",
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
    tempo_agente_minutos: "Tempo do agente",
  };

  const resolveValueLabel = (field: string, value: string | null): string => {
    if (!value) return "—";
    switch (field) {
      case "status_id": {
        const si = ticketStatuses.find(s => s.id === value);
        return si ? si.name : value.slice(0, 8) + "...";
      }
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
      case "tempo_agente_minutos":
        return value ? `${value} min` : "—";
      default:
        return value.length > 50 ? value.slice(0, 50) + "..." : value;
    }
  };

  const { data: departamentos = [] } = useQuery({
    queryKey: ["ticket_detail_departamentos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name, slug").eq("tenant_id", tid).eq("is_active", true).eq("usa_tickets", true).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; slug: string | null }>;
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
        .select("id, nome").eq("tenant_id", tid).eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const { data: categoryProductLinks = [] } = useQuery({
    queryKey: ["ticket_detail_cat_links", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_category_products" as any) as any)
        .select("category_id, produto_id").eq("tenant_id", tid);
      if (error) throw error;
      return (data ?? []) as Array<{ category_id: string; produto_id: number }>;
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

  const { data: ticketStatuses = [] } = useQuery({
    queryKey: ["ticket_statuses_detail", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_statuses" as any) as any)
        .select("id, name, slug, color, position, is_initial, is_terminal, is_active, department_id")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; name: string; slug: string; color: string;
        position: number; is_initial: boolean; is_terminal: boolean;
        is_active: boolean; department_id: string | null;
      }>;
    },
  });

  const getStatusInfo = (statusId: string | null) => {
    if (!statusId) return { name: "Sem status", color: "#6b7280", isTerminal: false };
    const found = ticketStatuses.find(s => s.id === statusId);
    return found
      ? { name: found.name, color: found.color, isTerminal: found.is_terminal }
      : { name: "—", color: "#6b7280", isTerminal: false };
  };

  const statusesForDepartment = useMemo(() => {
    if (!ticket?.department_id) return ticketStatuses;
    return ticketStatuses.filter(s => s.department_id === ticket.department_id);
  }, [ticketStatuses, ticket?.department_id]);

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
      queryClient.invalidateQueries({ queryKey: ["implantacao_metrics"] });
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
      {/* Setor + Status + Responsável */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Setor</Label>
          <Select
            value={ticket?.department_id ?? "none"}
            onValueChange={(v) => handleFieldUpdate({ department_id: v === "none" ? null : v })}
            disabled={updating}
          >
            <SelectTrigger className="h-9 text-xs">
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
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Status</Label>
          <Select
            value={ticket?.status_id ?? ""}
            onValueChange={(v) => handleFieldUpdate({ status_id: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue>
                {(() => { const si = getStatusInfo(ticket?.status_id); return (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: si.color }} />
                    {si.name}
                  </span>
                );})()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusesForDepartment.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Responsável</Label>
          <Select
            value={ticket?.responsavel_user_id ?? ""}
            onValueChange={(v) => handleFieldUpdate({ responsavel_user_id: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Não atribuído" />
            </SelectTrigger>
            <SelectContent>
              {eventAgents.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>



      {/* Cliente */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Cliente</Label>
        {ticket.clientes ? (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="text-sm font-semibold">{ticket.clientes.nome_fantasia ?? "—"}</p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {ticket.clientes.cnpj && <p>CNPJ: {ticket.clientes.cnpj}</p>}
              {ticket.clientes.telefone_whatsapp && <p>Tel: {ticket.clientes.telefone_whatsapp}</p>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sem cliente vinculado</p>
        )}
        <div className="space-y-1 pt-1">
          <Label className="text-[11px] text-muted-foreground">Contato solicitante</Label>
          <div className="flex items-center gap-2">
            {ticket?.contact_id && !ticket?.cliente_contato_id ? (
              <p className="text-sm h-9 flex items-center gap-2 flex-1">
                {ticket?.whatsapp_contacts?.name ?? "—"}
                <Badge variant="outline" className="text-[10px]">WhatsApp</Badge>
              </p>
            ) : (
              <Select
                value={ticket?.cliente_contato_id ?? "none"}
                onValueChange={handleSelectContato}
                disabled={updating}
              >
                <SelectTrigger className="h-9 text-xs flex-1">
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
              className="h-9 w-9 shrink-0"
              onClick={() => setNewContactOpen(true)}
              disabled={!ticketClienteId}
              title="Adicionar contato"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Classificação */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Classificação</Label>
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Produto</Label>
            <Select value={ticket.produto_id ? String(ticket.produto_id) : ""} onValueChange={(v) => handleFieldUpdate({ produto_id: Number(v) })} disabled={updating}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {produtos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Categoria</Label>
            <Select value={ticket.category_id ?? ""} onValueChange={(v) => handleFieldUpdate({ category_id: v })} disabled={updating}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {categories.filter(c => {
                  if (!ticket?.produto_id) return true;
                  const linkedCatIds = new Set(categoryProductLinks.filter(l => l.produto_id === ticket.produto_id).map(l => l.category_id));
                  const catsWithAnyLink = new Set(categoryProductLinks.map(l => l.category_id));
                  return linkedCatIds.has(c.id) || !catsWithAnyLink.has(c.id);
                }).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Subcategoria</Label>
            <Select value={ticket.subcategory_id ?? ""} onValueChange={(v) => handleFieldUpdate({ subcategory_id: v })} disabled={updating}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {subcategories.filter(s => s.category_id === ticket?.category_id).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Tipo de serviço</Label>
            <Select value={ticket.service_type_id ?? ""} onValueChange={(v) => handleFieldUpdate({ service_type_id: v })} disabled={updating}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {serviceTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Assunto */}
      {ticket.assunto && (
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Assunto</p>
          <p className="text-sm">{ticket.assunto}</p>
        </div>
      )}

      {/* Descrição (Observação do agente, editável) */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Descrição</Label>
        <Textarea
          ref={(el) => {
            if (el) {
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }
          }}
          defaultValue={ticket?.observacao_agente ?? ""}
          key={`obs-${ticket?.observacao_agente ?? ""}`}
          placeholder="Descreva o problema ou observação..."
          className="text-sm min-h-[80px] overflow-hidden"
          style={{ resize: "none" }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = t.scrollHeight + "px";
          }}
          onBlur={(e) => {
            const val = e.target.value;
            if (val !== (ticket?.observacao_agente ?? "")) {
              handleFieldUpdate({ observacao_agente: val });
            }
          }}
          disabled={updating}
        />
      </div>

      {/* Previsão de encerramento + Agendado para */}
      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Previsão <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1 align-middle">auto</Badge></Label>
          <Input
            type="datetime-local"
            className="h-9 text-xs"
            defaultValue={toLocalInput(ticket?.previsao_encerramento)}
            key={`previsao-${ticket?.previsao_encerramento}`}
            onBlur={(e) => {
              const val = e.target.value;
              if (val) handleFieldUpdate({ previsao_encerramento: new Date(val).toISOString() });
            }}
            disabled={updating}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Agendado para</Label>
          <Input
            type="datetime-local"
            className="h-9 text-xs"
            defaultValue={toLocalInput(ticket?.agendado_para)}
            key={`agendado-${ticket?.agendado_para}`}
            onBlur={(e) => {
              const val = e.target.value;
              if (val) handleFieldUpdate({ agendado_para: new Date(val).toISOString() });
            }}
            disabled={updating}
          />
        </div>
      </div>

      {/* Tempo agente + Tempo calculado */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium flex items-center gap-1">
            <Timer className="h-3 w-3" />
            Tempo agente (min)
          </Label>
          <Input
            type="number"
            min={0}
            className="h-9 text-xs"
            defaultValue={ticket?.tempo_agente_minutos ?? ""}
            key={`tempo-agente-${ticket?.tempo_agente_minutos}`}
            placeholder="0"
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && Number(val) !== (ticket?.tempo_agente_minutos ?? 0)) {
                handleFieldUpdate({ tempo_agente_minutos: val });
              }
            }}
            disabled={updating}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Tempo calculado</Label>
          <p className="text-sm h-9 flex items-center text-muted-foreground">
            {ticket?.tempo_calculado_minutos ? `${ticket.tempo_calculado_minutos} min` : "—"}
          </p>
        </div>
      </div>

      {/* Horários Plantão — visível apenas quando tipo_horario = 'plantao' */}
      {ticket?.tipo_horario === "plantao" && (
        <div className="space-y-3 p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
          <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Horários de Plantão
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Início</Label>
              <Input
                type="datetime-local"
                className="h-9 text-xs"
                defaultValue={toLocalInput(ticket?.horario_inicio)}
                key={`horario-inicio-${ticket?.horario_inicio}`}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (val) handleFieldUpdate({ horario_inicio: new Date(val).toISOString() });
                }}
                disabled={updating}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Fim</Label>
              <Input
                type="datetime-local"
                className="h-9 text-xs"
                defaultValue={toLocalInput(ticket?.horario_fim)}
                key={`horario-fim-${ticket?.horario_fim}`}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (val) handleFieldUpdate({ horario_fim: new Date(val).toISOString() });
                }}
                disabled={updating}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Duração</Label>
              <p className="text-sm h-9 flex items-center font-semibold text-amber-700">
                {ticket?.duracao_minutos != null
                  ? `${Math.floor(ticket.duracao_minutos / 60)}h ${ticket.duracao_minutos % 60}min`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {(() => {
        const dept = departamentos?.find((d: any) => d.id === ticket?.department_id);
        if (dept?.slug !== "implantacao") return null;
        const inicio = ticket?.data_inicio_implantacao ? new Date(ticket.data_inicio_implantacao + "T00:00:00") : null;
        const fim = ticket?.data_fim_implantacao ? new Date(ticket.data_fim_implantacao + "T00:00:00") : null;
        const dias = inicio && fim ? Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) : null;
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5" /> Implantação
            </p>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Início</Label>
                <Input
                  type="date"
                  className="h-9 text-xs"
                  defaultValue={ticket?.data_inicio_implantacao ?? ""}
                  key={`impl-ini-${ticket?.data_inicio_implantacao ?? ""}`}
                  onBlur={(e) => {
                    const val = e.target.value || null;
                    if (val !== (ticket?.data_inicio_implantacao ?? null)) {
                      handleFieldUpdate({ data_inicio_implantacao: val });
                    }
                  }}
                  disabled={updating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fim</Label>
                <Input
                  type="date"
                  className="h-9 text-xs"
                  defaultValue={ticket?.data_fim_implantacao ?? ""}
                  key={`impl-fim-${ticket?.data_fim_implantacao ?? ""}`}
                  onBlur={(e) => {
                    const val = e.target.value || null;
                    if (val !== (ticket?.data_fim_implantacao ?? null)) {
                      handleFieldUpdate({ data_fim_implantacao: val });
                    }
                  }}
                  disabled={updating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dias</Label>
                <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 text-xs font-medium font-mono">
                  {dias !== null ? (dias >= 0 ? `${dias} dia${dias !== 1 ? "s" : ""}` : "Inválido") : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Checklist */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">Checklist</Label>
          {((ticket?.checklist as any[]) ?? []).length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {((ticket.checklist as any[]) ?? []).filter((c: any) => c.done).length}/{((ticket.checklist as any[]) ?? []).length}
            </Badge>
          )}
        </div>
        <div className="space-y-1">
          {((ticket?.checklist as any[]) ?? []).map((item: any, i: number) => (
            <div key={i} className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
              <Checkbox checked={!!item.done} onCheckedChange={() => handleToggleCheck(i)} />
              <span className={`text-sm flex-1 ${item.done ? "line-through text-muted-foreground" : ""}`}>
                {item.text}
              </span>
              <button
                onClick={() => handleRemoveCheckItem(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newCheckItem}
            onChange={(e) => setNewCheckItem(e.target.value)}
            placeholder="Novo item..."
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCheckItem(); } }}
          />
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleAddCheckItem}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Anexos */}
      {ticketId && tid && (
        <div className="space-y-1.5">
          <TicketAttachments ticketId={ticketId} tenantId={tid} canDelete />
        </div>
      )}

      {/* Resumo IA do ticket */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Resumo IA</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={async () => {
                try {
                  toast.info("Gerando resumo parcial...");
                  const { error } = await supabase.functions.invoke("summarize-ticket", {
                    body: { ticketId, type: "partial" },
                  });
                  if (error) throw error;
                  toast.success("Resumo parcial gerado");
                  queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
                } catch (err: any) {
                  toast.error("Erro: " + (err.message ?? "Função não disponível ainda"));
                }
              }}
              disabled={updating}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Resumo parcial
            </Button>
            {getStatusInfo(ticket?.status_id).isTerminal && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={async () => {
                  try {
                    toast.info("Gerando resumo conclusivo...");
                    const { error } = await supabase.functions.invoke("summarize-ticket", {
                      body: { ticketId, type: "conclusive" },
                    });
                    if (error) throw error;
                    toast.success("Resumo conclusivo gerado");
                    queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
                  } catch (err: any) {
                    toast.error("Erro: " + (err.message ?? "Função não disponível ainda"));
                  }
                }}
                disabled={updating}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Resumo final
              </Button>
            )}
          </div>
        </div>

        {ticket?.resumo_parcial && (
          <div className="bg-muted/30 rounded-lg p-3 space-y-1">
            <p className="text-[10px] uppercase text-muted-foreground">Resumo parcial</p>
            <p className="text-sm whitespace-pre-wrap">{ticket.resumo_parcial}</p>
          </div>
        )}

        {ticket?.resumo_conclusivo && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
            <p className="text-[10px] uppercase text-primary">Resumo conclusivo</p>
            <p className="text-sm whitespace-pre-wrap">{ticket.resumo_conclusivo}</p>
          </div>
        )}
      </div>

      {attendance?.ai_summary && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            <p className="text-[10px] uppercase text-muted-foreground">Resumo IA da conversa</p>
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
            {(() => { const si = getStatusInfo(c.status_id); return (
              <Badge variant="outline" className="text-[10px] border" style={{ background: si.color + "1A", color: si.color, borderColor: si.color + "33" }}>
                {si.name}
              </Badge>
            );})()}
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
                    <Badge variant="outline" className="text-[10px]">{evt.old_value ?? "—"}</Badge>
                    <span className="text-[10px]">→</span>
                    <Badge variant="outline" className="text-[10px]">{evt.new_value ?? "—"}</Badge>
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
        <DialogContent className="max-w-[1100px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col shadow-none">
          <DialogTitle className="sr-only">Detalhes do ticket {ticket?.ticket_code ?? ""}</DialogTitle>
          {/* Header */}
          <div className="flex items-center justify-between px-5 pr-12 pt-4 pb-3 border-b shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-sm font-medium text-primary">{ticket?.ticket_code ?? "—"}</span>
              <span className="text-sm text-muted-foreground truncate">
                {ticket?.assunto || "Detalhes do ticket"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setStartConvOpen(true)}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Conversa
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setChildOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Filho
              </Button>
              {isAdminOrHead && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </Button>
              )}
              {ticket && (() => {
                const si = getStatusInfo(ticket.status_id);
                const isTerminal = si.isTerminal;
                const initialStatus = statusesForDepartment.find(s => s.is_initial);
                const terminalStatus = statusesForDepartment.find(s => s.is_terminal);
                return (
                  <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-border">
                    {!isTerminal ? (
                      <>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/25">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                          Aberto
                        </div>
                        {terminalStatus && (
                          <button
                            onClick={() => {
                              const respUid = ticket?.responsavel_user_id ?? null;
                              if (!isAdminOrHead && respUid && respUid !== currentUserId) {
                                setCloseTargetStatusId(terminalStatus.id);
                                setCloseConfirmOpen(true);
                              } else {
                                handleFieldUpdate({ status_id: terminalStatus.id });
                              }
                            }}
                            disabled={updating}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" /> Encerrar
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border">
                          <Lock className="h-3 w-3" /> Encerrado
                        </div>
                        {initialStatus && (
                          <button
                            onClick={() => handleFieldUpdate({ status_id: initialStatus.id })}
                            disabled={updating}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Reabrir
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Top strip */}
          <div className="flex items-center gap-2 px-5 py-2.5 border-b flex-wrap shrink-0">
            {/* Prioridade */}
            <Select
              value={ticket?.prioridade ?? ""}
              onValueChange={(v) => handleFieldUpdate({ prioridade: v })}
              disabled={updating}
            >
              <SelectTrigger className="h-auto w-auto min-w-[120px] border rounded-md px-3 py-1.5 text-xs gap-1.5 bg-muted/30 [&>svg]:hidden [&>span]:!flex [&>span]:!overflow-visible">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  {(() => {
                    const cur = PRIORIDADES_STRIP.find((p) => p.id === ticket?.prioridade);
                    return (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: cur?.color ?? "#6b7280" }} />
                        {cur?.name ?? "Prioridade"}
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </>
                    );
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {PRIORIDADES_STRIP.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Canal */}
            <Select
              value={ticket?.canal_origem ?? ""}
              onValueChange={(v) => handleFieldUpdate({ canal_origem: v })}
              disabled={updating}
            >
              <SelectTrigger className="h-auto w-auto min-w-[120px] border rounded-md px-3 py-1.5 text-xs gap-1.5 bg-muted/30 [&>svg]:hidden [&>span]:!flex [&>span]:!overflow-visible">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  {(() => {
                    const cur = CANAIS_STRIP.find((c) => c.id === ticket?.canal_origem);
                    const Ic = cur?.icon ?? Phone;
                    return (
                      <>
                        <Ic className="h-3 w-3 shrink-0" />
                        {cur?.name ?? "Canal"}
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </>
                    );
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {CANAIS_STRIP.map((c) => {
                  const Ic = c.icon;
                  return (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <Ic className="h-3.5 w-3.5" />
                        {c.name}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            {/* Tipo horário */}
            <div className="flex gap-1">
              {["comercial", "plantao"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleFieldUpdate({ tipo_horario: t })}
                  disabled={updating}
                  className={`px-3 py-1 text-[11px] rounded-md border transition-colors ${
                    (ticket?.tipo_horario ?? "comercial") === t
                      ? "bg-primary/10 text-primary border-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "comercial" ? "Comercial" : "Plantão"}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex-1 overflow-hidden px-6 py-4">{loadingNode}</div>
          ) : (
            <div ref={containerRef} className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: `1fr auto ${rightPanelWidth}px` }}>
              <div className="p-4 space-y-4 overflow-y-auto">
                {detailsContent}
              </div>
              <div
                onMouseDown={handleMouseDown}
                className={`group relative w-2 cursor-col-resize flex items-center justify-center shrink-0 border-x border-border hover:bg-primary/10 transition-colors ${isDragging ? "bg-primary/20" : "bg-muted/30"}`}
                title="Clique e arraste para redimensionar"
              >
                <div className="flex flex-col gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                  <div className="w-0.5 h-0.5 rounded-full bg-foreground" />
                </div>
              </div>
              <div className="p-3.5 space-y-3 overflow-y-auto bg-muted/10">
                {/* Tags */}
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Tags</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ticketTags.map(tag => (
                      <span
                        key={tag.assignmentId}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
                        style={{ background: tag.color + "22", color: tag.color }}
                      >
                        {tag.name}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveTag(tag.assignmentId); }}
                          className="hover:opacity-70"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1">
                          <TagIcon className="h-3 w-3" />
                          Tag
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-1.5">
                        <div className="space-y-0.5 max-h-60 overflow-y-auto">
                          {availableTags
                            .filter(t => !ticketTags.find(tt => tt.id === t.id))
                            .map(t => (
                              <button
                                key={t.id}
                                onClick={() => { handleAddTag(t.id); setTagPopoverOpen(false); }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-sm flex items-center gap-2"
                              >
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                                {t.name}
                              </button>
                            ))}
                          {availableTags.filter(t => !ticketTags.find(tt => tt.id === t.id)).length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-3">Nenhuma tag disponível</p>
                          )}
                        </div>
                        <div className="border-t mt-2 pt-2">
                          <p className="text-[10px] text-muted-foreground mb-1.5 px-1">Criar nova</p>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="color"
                              value={quickTagColor}
                              onChange={(e) => setQuickTagColor(e.target.value)}
                              className="h-8 w-8 p-0.5 shrink-0"
                            />
                            <Input
                              value={quickTagName}
                              onChange={(e) => setQuickTagName(e.target.value)}
                              placeholder="Nome..."
                              className="h-8 text-xs flex-1"
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateAndAddTag(); } }}
                            />
                            <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleCreateAndAddTag}
                              disabled={!quickTagName.trim() || creatingTag}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Marcados */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Marcados</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ticketMentions.map(m => {
                      const agent = agentesDisponiveis.find(a => a.user_id === m.mentioned_user_id);
                      return (
                        <span key={m.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {agent?.nome ?? "Agente"}
                          <button onClick={() => handleRemoveMention(m.id)} className="hover:opacity-70">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                          <UserPlus className="h-3 w-3" /> Marcar
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="start">
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {agentesDisponiveis
                            .filter(a => !ticketMentions.find(m => m.mentioned_user_id === a.user_id))
                            .map(a => (
                              <button key={a.user_id} onClick={() => handleAddMention(a.user_id)}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-sm">
                                {a.nome}
                              </button>
                            ))}
                          {agentesDisponiveis.filter(a => !ticketMentions.find(m => m.mentioned_user_id === a.user_id)).length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">Todos já marcados</p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <Separator />

                {/* Timeline */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Timeline</p>
                  {timelineContent}
                </div>

                <Separator />

                {/* Metadata */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Metadata</p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Aberto em</span>
                      <span className="font-medium text-right">{ticket?.aberto_em ? formatDateTime(ticket.aberto_em) : "—"}</span>
                    </div>
                    {ticket?.created_by_user_id && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Criado por</span>
                        <span className="font-medium text-right truncate">{getAgentName(ticket.created_by_user_id)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Tempo agente</span>
                      <span className="font-medium text-right">{ticket?.tempo_agente_minutos ? `${ticket.tempo_agente_minutos} min` : "—"}</span>
                    </div>
                    {ticket?.tempo_calculado_minutos != null && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Tempo calculado</span>
                        <span className="font-medium text-right">{ticket.tempo_calculado_minutos} min</span>
                      </div>
                    )}
                  </div>

                  {ticket?.parent && (
                    <div className="space-y-1 pt-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Ticket pai</p>
                      <button
                        onClick={() => {
                          onOpenChange(false);
                          setTimeout(() => {
                            window.dispatchEvent(new CustomEvent("open-ticket-detail", { detail: { ticketId: ticket.parent.id } }));
                          }, 300);
                        }}
                        className="w-full border border-border rounded-md p-2 flex items-center gap-2 hover:border-primary/40 transition-colors"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs font-semibold text-primary truncate">{ticket.parent.ticket_code}</span>
                        {(() => { const si = getStatusInfo(ticket.parent.status_id); return (
                          <Badge variant="outline" className="text-[10px] border ml-auto shrink-0" style={{ background: si.color + "1A", color: si.color, borderColor: si.color + "33" }}>
                            {si.name}
                          </Badge>
                        );})()}
                      </button>
                    </div>
                  )}

                  {children.length > 0 && (
                    <div className="space-y-1 pt-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Tickets filhos ({children.length})</p>
                      <div className="space-y-1">
                        {children.map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              onOpenChange(false);
                              setTimeout(() => {
                                window.dispatchEvent(new CustomEvent("open-ticket-detail", { detail: { ticketId: c.id } }));
                              }, 300);
                            }}
                            className="w-full border border-border rounded-md p-2 flex items-center gap-2 hover:border-primary/40 transition-colors"
                          >
                            <TicketCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                            <span className="font-mono text-xs font-semibold text-blue-400 truncate">{c.ticket_code}</span>
                            {(() => { const si = getStatusInfo(c.status_id); return (
                              <Badge variant="outline" className="text-[10px] border ml-auto shrink-0" style={{ background: si.color + "1A", color: si.color, borderColor: si.color + "33" }}>
                                {si.name}
                              </Badge>
                            );})()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
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

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir ticket?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O ticket <span className="font-mono font-semibold text-foreground">{ticket?.ticket_code}</span> será excluído permanentemente. Esta ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleSoftDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Encerrar ticket</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Este ticket está atribuído a{" "}
            <span className="font-semibold text-foreground">
              {agentesDisponiveis.find(a => a.user_id === ticket?.responsavel_user_id)?.nome ?? "outro responsável"}
            </span>
            . Deseja assumir o ticket e encerrá-lo, ou encerrar mantendo o responsável atual?
          </p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCloseConfirmOpen(false)} disabled={updating}>
              Cancelar
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={async () => {
                if (!closeTargetStatusId) return;
                await handleFieldUpdate({ status_id: closeTargetStatusId });
                setCloseConfirmOpen(false);
              }}
              disabled={updating}
            >
              Encerrar mantendo responsável
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={async () => {
                if (!closeTargetStatusId || !currentUserId) return;
                await handleFieldUpdate({
                  responsavel_user_id: currentUserId,
                  status_id: closeTargetStatusId,
                });
                setCloseConfirmOpen(false);
              }}
              disabled={updating || !currentUserId}
            >
              Assumir e encerrar
            </Button>
          </div>
        </DialogContent>

      </Dialog>
    </>
  );
}

export default SupportTicketDetailDialog;
