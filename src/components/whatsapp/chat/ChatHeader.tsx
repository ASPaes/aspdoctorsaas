import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBRPhone } from "@/lib/phoneBR";

import ContactAvatar from "@/components/whatsapp/ContactAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Archive, MoreVertical, X, RotateCcw, PanelRightOpen, BellOff, Pencil, Ticket, ArrowLeftRight, XCircle, Brain, Building2, Moon, Link2, AlertTriangle, VolumeX, Trash2, CalendarClock, Users, FileSearch, ShieldOff, FileText, Search, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { InChatMessageSearchModal } from "./InChatMessageSearchModal";
import { ScheduleAttendanceDialog } from "./ScheduleAttendanceDialog";
import GroupParticipantsSheet from "./GroupParticipantsSheet";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateCSTicketFromChat } from "./CreateCSTicketFromChat";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";

import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { Badge } from "@/components/ui/badge";
import { EditContactModal } from "./EditContactModal";
import { QueueIndicator } from "./QueueIndicator";
import { TransferDialog } from "./TransferDialog";
import { CSTicketAlert } from "./CSTicketAlert";
import { useChurnDismiss } from "../hooks/useChurnDismiss";
import { isChurnDismissed } from "@/lib/churnDismiss";
import { ChangeInstanceDialog } from "./ChangeInstanceDialog";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { SignatureControl } from "./SignatureControl";
import { SentimentChip } from "./SentimentChip";
import { ClimaResolucaoBadge } from "./ClimaResolucaoBadge";
import { useClienteLinkSuggestion } from "../hooks/useClienteLinkSuggestion";
import { ConversationMuteButton } from "./ConversationMuteButton";
import { ConfirmClienteModal } from "./ConfirmClienteModal";
import { CreateSupportTicketModal } from "@/components/tickets/CreateSupportTicketModal";
import { SupportTicketDetailDialog } from "@/components/tickets/SupportTicketDetailDialog";
import { TicketReopenChoiceDialog } from "./TicketReopenChoiceDialog";
import { TicketUpdateExistingDialog } from "./TicketUpdateExistingDialog";
import { InterruptAutoReplyDialog } from "./InterruptAutoReplyDialog";
import { CleanupConversationDialog } from "./CleanupConversationDialog";
import { GroupLinkClienteModal } from "./GroupLinkClienteModal";
import { ChatQuickRuleToggles } from "./ChatQuickRuleToggles";
import { AcessoFastButton } from "./AcessoFastButton";
import { useContactRulesDisabled } from "../hooks/useContactRulesDisabled";

import { useSenderMap } from "../hooks/useSenderMap";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useSupportConfig } from '@/hooks/useSupportConfig';
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  conversation: ConversationWithContact;
  onToggleDetails: () => void;
  showDetails: boolean;
  onClose?: () => void;
  onNavigateToConversation?: (conversationId: string) => void;
  onDepartmentTransferred?: () => void;
  pendingAction?: string | null;
  onPendingActionConsumed?: () => void;
}

export function ChatHeader({ conversation, onToggleDetails, showDetails, onClose, onNavigateToConversation, onDepartmentTransferred, pendingAction, onPendingActionConsumed }: Props) {
  const { archiveConversation, closeConversation, reopenConversation, markAsUnread, pauseAutoReply, isPausingAutoReply, deleteMessagesByIds, isDeletingMessages, resumeAutoReply, isResumingAutoReply, scheduleAttendance, isSchedulingAttendance, unscheduleAttendance, isUnschedulingAttendance } = useWhatsAppActions();
  const { sentiment, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentimentData = sentiment as any;
  
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isManualTicketOpen, setIsManualTicketOpen] = useState(false);
  const [isChangeInstanceOpen, setIsChangeInstanceOpen] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showConfirmCliente, setShowConfirmCliente] = useState(false);
  const [showClassifyModal, setShowClassifyModal] = useState(false);
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showGroupLinkModal, setShowGroupLinkModal] = useState(false);
  const [isStartingGroupAtt, setIsStartingGroupAtt] = useState(false);
  const [groupStartPopoverOpen, setGroupStartPopoverOpen] = useState(false);
  const [groupIncludePrevious, setGroupIncludePrevious] = useState<number>(2);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAttendanceTicketPicker, setShowAttendanceTicketPicker] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [showAttendanceTicketModal, setShowAttendanceTicketModal] = useState(false);
  const [attendanceTicketTarget, setAttendanceTicketTarget] = useState<any | null>(null);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);
  const [isAvulsoTicketOpen, setIsAvulsoTicketOpen] = useState(false);

  const [showAttachTicketModal, setShowAttachTicketModal] = useState(false);
  const [attachNote, setAttachNote] = useState("");
  // Reopen flow (attendance.ticket_id IS NOT NULL no encerramento que exige ticket)
  const [showReopenChoice, setShowReopenChoice] = useState(false);
  const [showUpdateExisting, setShowUpdateExisting] = useState(false);
  const [reopenTicketId, setReopenTicketId] = useState<string | null>(null);
  const [showCreateAdditional, setShowCreateAdditional] = useState(false);
  // Read-only view de ticket vinculado (a partir do picker)
  const [readOnlyTicketId, setReadOnlyTicketId] = useState<string | null>(null);
  const { data: supportConfig } = useSupportConfig();
  const csatEnabled = supportConfig?.support_csat_enabled === true;
  const { instances } = useWhatsAppInstances();
  const hasMultipleInstances = instances.length > 1;
  const { isBlocked: presenceBlocked } = useAgentPresence();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || (profile as any)?.is_super_admin;

  // Attendance status (single source of truth) — declarado ANTES do link-suggestion
  // para que o hook receba o attendanceId correto (fonte oficial do vínculo).
  const { attendanceMap } = useAttendanceStatus([conversation.id], true);
  const attendance = attendanceMap.get(conversation.id);
  // Ancora do descarte de churn: precisa ser o MESMO atendimento que o
  // backend considera ativo (waiting|in_progress), senao o sinal some numa
  // tela e sobra na outra.
  const activeAttendanceId =
    attendance && (attendance.status === "waiting" || attendance.status === "in_progress")
      ? attendance.id
      : null;
  const churnDescartado = isChurnDismissed(sentimentData as any, activeAttendanceId);
  const { setDismissed: setChurnDismissed, isSaving: isSavingChurn } = useChurnDismiss(conversation.id);

  // Client link status (declarado antes dos handlers que dependem de linkedCliente)
  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const phoneNumber = conversation.contact?.phone_number || "";
  const { linkedCliente, isLinked } = useClienteLinkSuggestion(conversation.id, phoneNumber, metadata, attendance?.id ?? null, conversation.tenant_id);
  const linkedClienteName = isLinked && linkedCliente
    ? (linkedCliente.nome_fantasia || linkedCliente.razao_social || `#${linkedCliente.codigo_sequencial}`)
    : null;


  // Lazy query: atendimentos da conversa (apenas quando o picker abre)
  const { data: attendanceTicketList = [], isLoading: isLoadingAttendanceList } = useQuery({
    queryKey: ['attendance-ticket-list', conversation.id],
    enabled: showAttendanceTicketPicker,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_attendances')
        .select('id, attendance_code, status, closure_type, created_at, closed_at, ticket_id, assigned_to, department_id, cliente_id, handle_seconds, ai_summary, ai_problem, ai_solution, clientes:cliente_id(id, nome_fantasia, codigo_sequencial, produto_id)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const getPickMode = useCallback((a: any): 'classificacao' | 'classificacao_aberta' | 'view_ticket' => {
    if (a?.ticket_id) return 'view_ticket';
    const isClosed = a?.status === 'closed' || a?.status === 'inactive_closed';
    return isClosed ? 'classificacao' : 'classificacao_aberta';
  }, []);

  const canPickAttendance = useCallback((a: any) => {
    if (!a) return false;
    const mode = getPickMode(a);
    if (mode === 'view_ticket') return true;
    // classificacao/classificacao_aberta: gate por cliente + permissão
    const hasCliente = !!a?.cliente_id || !!(linkedCliente as any)?.id;
    if (!hasCliente) return false;
    if (isAdmin) return true;
    return !!user?.id && a?.assigned_to === user.id;
  }, [isAdmin, user?.id, getPickMode, linkedCliente]);


  // Carimba cliente no atendimento (se faltar) antes de abrir o modal
  const openTicketForAttendance = useCallback(async (target: any) => {
    let enriched = target;
    if (!target.cliente_id && (linkedCliente as any)?.id) {
      try {
        await supabase
          .from('support_attendances')
          .update({ cliente_id: (linkedCliente as any).id })
          .eq('id', target.id)
          .is('cliente_id', null);
      } catch (e) { /* não bloquear a abertura por falha no carimbo */ }
      enriched = {
        ...target,
        cliente_id: (linkedCliente as any).id,
        clientes: {
          id: (linkedCliente as any).id,
          nome_fantasia: (linkedCliente as any).nome_fantasia ?? null,
          codigo_sequencial: (linkedCliente as any).codigo_sequencial ?? null,
          produto_id: (linkedCliente as any).produto_id ?? null,
        },
      };
    }
    setAttendanceTicketTarget(enriched);
    setShowAttendanceTicketPicker(false);
    setShowAttendanceTicketModal(true);
  }, [linkedCliente]);

  // Quando lista carrega: se 1 elegível → abrir direto; senão pré-selecionar o mais recente elegível
  useEffect(() => {
    if (showAttendanceTicketModal) return;
    if (!showAttendanceTicketPicker) return;
    if (isLoadingAttendanceList) return;
    if (!attendanceTicketList || attendanceTicketList.length === 0) return;

    if (attendanceTicketList.length === 1) {
      const only = attendanceTicketList[0] as any;
      if (canPickAttendance(only)) {
        openTicketForAttendance(only);
      } else {
        // Mantém picker aberto para mostrar motivo (ticket já criado / sem permissão)
        setPickerSelectedId(null);
      }
      return;
    }

    // >1: pré-selecionar o mais recente elegível, ou o primeiro
    const firstEligible = (attendanceTicketList as any[]).find(canPickAttendance);
    setPickerSelectedId(firstEligible?.id ?? null);
  }, [showAttendanceTicketPicker, showAttendanceTicketModal, isLoadingAttendanceList, attendanceTicketList, canPickAttendance, openTicketForAttendance]);

  const handleOpenAttendanceTicket = useCallback(() => {
    setPickerSelectedId(null);
    setAttendanceSearch("");
    setShowAttendanceTicketPicker(true);
  }, []);

  const filteredAttendanceList = useMemo(() => {
    const q = attendanceSearch.trim().toLowerCase();
    if (!q) return attendanceTicketList as any[];
    return (attendanceTicketList as any[]).filter((a) =>
      (a.attendance_code || "").toLowerCase().includes(q)
    );
  }, [attendanceTicketList, attendanceSearch]);

  const handleConfirmPickerSelection = useCallback(async () => {
    const target = (attendanceTicketList as any[]).find((a) => a.id === pickerSelectedId);
    if (!target) return;
    if (!canPickAttendance(target)) return;
    if (getPickMode(target) === 'view_ticket') {
      setShowAttendanceTicketPicker(false);
      setReadOnlyTicketId(target.ticket_id);
      return;
    }
    await openTicketForAttendance(target);
  }, [attendanceTicketList, pickerSelectedId, canPickAttendance, openTicketForAttendance, getPickMode]);


  const handleAttendanceTicketCreated = useCallback(() => {
    setShowAttendanceTicketModal(false);
    setAttendanceTicketTarget(null);
    queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-ticket-list', conversation.id] });
    queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
    toast.success('Ticket criado a partir do atendimento');
  }, [queryClient, conversation.id]);

  

  // Auto-abre o dialog de limpeza quando navegado com ?action=cleanup
  useEffect(() => {
    if (pendingAction === "cleanup" && conversation?.id) {
      setShowCleanupDialog(true);
      onPendingActionConsumed?.();
    }
  }, [pendingAction, conversation?.id, onPendingActionConsumed]);
  

  // Client link status (declarado acima, próximo aos handlers de ticket)

  const isAfterHours = useMemo(() => {
    const convAny = conversation as any;
    return convAny.opened_out_of_hours === true;
  }, [(conversation as any).opened_out_of_hours]);

  const handleClearAfterHours = useCallback(async () => {
    const nowIso = new Date().toISOString();
    await supabase
      .from('whatsapp_conversations')
      .update({
        out_of_hours_cleared_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', conversation.id);
    queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
  }, [conversation.id, queryClient]);


  const { effectiveTenantId: tid } = useTenantFilter();
  const convDeptId = (conversation as any).department_id;
  const { data: convDepartment } = useQuery({
    queryKey: ["conv-department", convDeptId],
    enabled: !!convDeptId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_departments")
        .select("id, name, requires_ticket_on_close")
        .eq("id", convDeptId)
        .single();
      return data;
    },
  });

  // Department context
  const { selectedDepartment } = useDepartmentFilter();
  const conversationInstance = useMemo(
    () => instances.find((i) => i.id === conversation.instance_id),
    [instances, conversation.instance_id]
  );
  const contact = conversation.contact;
  const name = contact?.name || (contact?.phone_number ? formatBRPhone(contact.phone_number) : "Desconhecido");
  const { rulesDisabled: contactRulesDisabled } = useContactRulesDisabled(contact?.id ?? null);

  // (attendanceMap/attendance já declarados no topo, próximo ao link-suggestion)


  const groupAttendance = ((conversation as any)?.is_group === true)
    && attendance
    && (attendance.status === "waiting" || attendance.status === "in_progress")
    ? attendance
    : null;

  const startGroupAttendance = useCallback(async (includePrevious: number = 0) => {
    if (!user?.id) return;
    setIsStartingGroupAtt(true);
    try {
      const { data, error } = await (supabase.rpc as any)("start_group_attendance", {
        p_conversation_id: conversation.id,
        p_agent_id: user.id,
        p_created_from: "group_manual",
        p_include_previous: Number.isFinite(includePrevious) ? Math.max(0, Math.min(50, Number(includePrevious))) : 0,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.success) {
        toast.success(`Atendimento ${res.attendance_code} iniciado`);
        // Fire-and-forget: enviar notificação de abertura ao grupo
        try {
          supabase.functions.invoke('send-whatsapp-message', {
            body: {
              conversationId: conversation.id,
              content: `\u2705 Atendimento *${res.attendance_code}* iniciado.`,
              messageType: 'text',
              systemMessage: true,
              // Quem decide se o grupo recebe este aviso \u00e9 a edge function, lendo
              // configuracoes.group_send_attendance_notices. O atendimento j\u00e1 abriu
              // acima e n\u00e3o depende do envio.
              attendanceNotice: true,
            },
          }).catch((e) => console.error('[ChatHeader][group] opening notify error:', e));
        } catch (e) {
          console.error('[ChatHeader][group] opening notify invoke error:', e);
        }
        queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
        setGroupStartPopoverOpen(false);
        return;
      }
      if (res?.error === "no_client") {
        setShowGroupLinkModal(true);
        setGroupStartPopoverOpen(false);
        return;
      }
      if (res?.error === "active_exists") {
        toast.error(res?.message ?? `Já em atendimento com ${res?.active_agent_name ?? "outro operador"}`);
        return;
      }
      toast.error(res?.message ?? "Não foi possível iniciar o atendimento");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao iniciar atendimento");
    } finally {
      setIsStartingGroupAtt(false);
    }
  }, [conversation.id, user?.id, queryClient]);

  const handleGroupLinked = useCallback(async () => {
    // Vinculou cliente ao grupo → tentar iniciar atendimento novamente com o mesmo valor escolhido
    queryClient.invalidateQueries({ queryKey: ["group-linked-cliente"] });
    await startGroupAttendance(groupIncludePrevious);
  }, [startGroupAttendance, groupIncludePrevious, queryClient]);

  const handleGroupCloseRequest = useCallback(async () => {
    const attTicketId = (attendance as any)?.ticket_id ?? null;
    if (attTicketId) {
      setReopenTicketId(attTicketId);
      setShowReopenChoice(true);
      return;
    }

    const { data: cfg } = await (supabase.from("configuracoes" as any) as any)
      .select("group_require_ticket_on_close")
      .eq("tenant_id", conversation.tenant_id || tid)
      .maybeSingle();

    if ((cfg as any)?.group_require_ticket_on_close === true) {
      setShowClassifyModal(true);
      return;
    }

    setShowCloseModal(true);
  }, [attendance, conversation.tenant_id, tid, setReopenTicketId, setShowReopenChoice, setShowClassifyModal, setShowCloseModal]);






  const handleClienteConfirmed = useCallback(async () => {
    setShowConfirmCliente(false);

    const attId = (attendance as any)?.id ?? null;

    // Sempre conferir a fonte da verdade no banco antes de decidir o fluxo
    let attTicketId: string | null = (attendance as any)?.ticket_id ?? null;
    if (attId) {
      try {
        const { data } = await supabase
          .from("support_attendances")
          .select("ticket_id")
          .eq("id", attId)
          .maybeSingle();
        if (data && Object.prototype.hasOwnProperty.call(data, "ticket_id")) {
          attTicketId = (data as any).ticket_id ?? null;
        }
      } catch {
        /* fallback ao valor em memória */
      }
    }

    // CASO REOPEN: atendimento já tem ticket vinculado → escolher atualizar ou criar novo
    if (attTicketId) {
      console.log("[ChatHeader] Reopen flow detectado, ticket_id =", attTicketId);
      setReopenTicketId(attTicketId);
      setShowReopenChoice(true);
      return;
    }

    // Regra: se setor exige ticket ao encerrar, mostrar modal de classificação (fluxo inicial)
    const requiresTicket = (convDepartment as any)?.requires_ticket_on_close === true;
    if (requiresTicket) {
      setShowClassifyModal(true);
      return;
    }

    // Fluxo normal: não exige ticket
    if (!csatEnabled) {
      closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, isGroup: isGroupConv });
    } else {
      setShowCloseModal(true);
    }
  }, [csatEnabled, closeConversation, conversation.id, attendance, convDepartment]);

  const handleClassifyCompleted = useCallback(() => {
    setShowClassifyModal(false);
    if (!csatEnabled) {
      closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, isGroup: isGroupConv });
    } else {
      setShowCloseModal(true);
    }
  }, [csatEnabled, closeConversation, conversation.id]);

  // Código do ticket vinculado (usado por TicketReopenChoiceDialog e legacy attach modal)
  const effectiveTicketId = reopenTicketId ?? ((attendance as any)?.ticket_id ?? null);
  const { data: attachTicketCode } = useQuery({
    queryKey: ["attach-ticket-code", effectiveTicketId],
    enabled:
      (showAttachTicketModal || showReopenChoice) && !!effectiveTicketId,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("ticket_code")
        .eq("id", effectiveTicketId as string)
        .maybeSingle();
      return (data as any)?.ticket_code ?? null;
    },
  });

  // Handlers do fluxo reopen
  const handleReopenChoose = useCallback((choice: "update" | "create") => {
    setShowReopenChoice(false);
    if (choice === "update") setShowUpdateExisting(true);
    else setShowCreateAdditional(true);
  }, []);

  const handleUpdateExistingCompleted = useCallback(() => {
    setShowUpdateExisting(false);
    queryClient.invalidateQueries({ queryKey: ["support_ticket_events"] });
    queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
    queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
  }, [queryClient]);

  const handleAdditionalTicketCreated = useCallback(() => {
    setShowCreateAdditional(false);
    if (!csatEnabled) {
      closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, isGroup: isGroupConv });
    } else {
      setShowCloseModal(true);
    }
    queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
    queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
  }, [csatEnabled, closeConversation, conversation.id, queryClient]);

  const proceedCloseAfterAttach = useCallback(() => {
    if (!csatEnabled) {
      closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, isGroup: isGroupConv });
    } else {
      setShowCloseModal(true);
    }
  }, [csatEnabled, closeConversation, conversation.id]);

  const handleAttachAndClose = useCallback(async () => {
    const attId = (attendance as any)?.id;
    if (!attId) return;
    try {
      const { error } = await supabase.rpc("attach_attendance_to_ticket" as any, {
        p_attendance_id: attId,
        p_nota: attachNote.trim() || null,
      });
      if (error) throw error;
      setShowAttachTicketModal(false);
      setAttachNote("");
      queryClient.invalidateQueries({ queryKey: ["support_ticket_events"] });
      proceedCloseAfterAttach();
    } catch (err: any) {
      toast.error("Erro ao anexar ao ticket: " + (err?.message ?? ""));
    }
  }, [attendance, attachNote, proceedCloseAfterAttach, queryClient]);

  const handleDeleteConversation = useCallback(async () => {
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.rpc("delete_conversation_admin", {
        p_conversation_id: conversation.id,
      });
      if (error) throw error;
      const { toast } = await import("sonner").then(m => ({ toast: m.toast }));
      toast.success("Conversa excluída com sucesso");
      queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
      onClose?.();
    } catch (err: any) {
      const { toast } = await import("sonner").then(m => ({ toast: m.toast }));
      toast.error(err.message || "Erro ao excluir conversa");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setDeleteConfirmText("");
    }
  }, [conversation.id, queryClient, onClose]);

  const deleteTargetName = (contact?.name || contact?.phone_number || "").trim();
  const isGroupConv = (conversation as any)?.is_group === true;

  const { data: groupLinkedCliente } = useQuery({
    queryKey: ["group-linked-cliente", conversation.contact?.id],
    enabled: isGroupConv && !!conversation.contact?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: wc } = await (supabase.from("whatsapp_contacts" as any) as any)
        .select("cliente_id")
        .eq("id", conversation.contact?.id)
        .maybeSingle();
      if (!wc?.cliente_id) return null;
      const { data: cliente } = await (supabase.from("clientes" as any) as any)
        .select("id, codigo_sequencial, nome_fantasia, razao_social")
        .eq("id", wc.cliente_id)
        .maybeSingle();
      return cliente ?? null;
    },
  });

  const { data: groupClienteProdutos = [] } = useQuery({
    queryKey: ["group-cliente-produto", groupLinkedCliente?.id],
    enabled: isGroupConv && !!groupLinkedCliente?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produtos" as any) as any)
        .select("produto_id")
        .eq("cliente_id", groupLinkedCliente!.id)
        .eq("ativo", true);
      if (error) throw error;
      return (data ?? []) as Array<{ produto_id: number }>;
    },
  });

  const groupProdutoId = groupClienteProdutos.length === 1 ? groupClienteProdutos[0].produto_id : null;

  const closureClienteIdEff = isGroupConv ? (groupLinkedCliente?.id ?? null) : ((linkedCliente as any)?.id ?? null);
  const closureClienteNomeEff = isGroupConv ? (groupLinkedCliente?.nome_fantasia || groupLinkedCliente?.razao_social || null) : (linkedClienteName ?? null);
  const closureClienteCodigoEff = isGroupConv ? (groupLinkedCliente?.codigo_sequencial ?? null) : ((linkedCliente as any)?.codigo_sequencial ?? null);
  const closureProdutoIdEff = isGroupConv ? groupProdutoId : ((linkedCliente as any)?.produto_id ?? null);

  const effIsLinked = isGroupConv ? !!groupLinkedCliente : isLinked;
  const effLinkedName = isGroupConv
    ? (groupLinkedCliente?.nome_fantasia || groupLinkedCliente?.razao_social || null)
    : linkedClienteName;

  // Resolve assigned operator name — try senderMap (funcionario via profile), then query funcionario directly
  const { data: tenantUsers } = useTenantUsers();
  const { getSenderLabel } = useSenderMap();

  // Find funcionario_id for fallback lookup
  const assignedTo = attendance?.assigned_to;
  const fallbackFuncId = useMemo(() => {
    if (!assignedTo || !tenantUsers) return null;
    const sender = getSenderLabel(assignedTo);
    if (sender.name) return null; // senderMap already has it
    const u = tenantUsers.find((tu) => tu.user_id === assignedTo);
    return u?.funcionario_id ?? null;
  }, [assignedTo, tenantUsers, getSenderLabel]);

  const { data: fallbackFuncionario } = useQuery({
    queryKey: ["funcionario-name", fallbackFuncId],
    enabled: !!fallbackFuncId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("funcionarios")
        .select("nome")
        .eq("id", fallbackFuncId!)
        .maybeSingle();
      return data?.nome ?? null;
    },
  });

  const assignedOperatorName = useMemo(() => {
    if (!assignedTo) return null;
    const sender = getSenderLabel(assignedTo);
    if (sender.name) return sender.name;
    if (fallbackFuncionario) return fallbackFuncionario;
    // Last resort: email prefix
    if (!tenantUsers) return null;
    const u = tenantUsers.find((tu) => tu.user_id === assignedTo);
    return u?.email?.split("@")[0] || u?.email || null;
  }, [assignedTo, getSenderLabel, fallbackFuncionario, tenantUsers]);

  const effectiveStatus = useMemo(() => {
    if (isGroupConv) return conversation.status;
    if (attendance) {
      if (attendance.status === "waiting") return "waiting";
      if (attendance.status === "in_progress") return "in_progress";
      if (attendance.status === "closed" || attendance.status === "inactive_closed") {
        // A conversa é a fonte de verdade para "encerrada". Um atendimento
        // encerrado NÃO pode marcar a conversa como Encerrada enquanto a
        // conversa ainda está ativa — o atendimento ativo pode estar oculto
        // por filtro de unidade/RLS, e o badge não pode mentir.
        if (conversation.status === "closed") return "closed";
        return conversation.status;
      }
    }
    return conversation.status;
  }, [attendance, conversation.status, isGroupConv]);

  const scheduledUntil = (attendance as any)?.scheduled_until ?? null;
  const isScheduled = !!scheduledUntil && new Date(scheduledUntil) > new Date();
  const canSchedule = effectiveStatus === "in_progress" && (isAdmin || (assignedTo && assignedTo === user?.id));

  let computedStatusLabel: string;
  let computedStatusVariant: string;

  // Fora do horário: só quando waiting sem técnico
  if (conversation.opened_out_of_hours && (!attendance || (attendance.status === 'waiting' && !attendance.assigned_to))) {
    computedStatusLabel = 'Fora do horário';
    computedStatusVariant = 'outline';
  } else {
    computedStatusLabel = effectiveStatus === "waiting" ? "Na Fila"
      : effectiveStatus === "in_progress" ? "Em Atendimento"
      : effectiveStatus === "closed" ? "Encerrada"
      : effectiveStatus === "active" ? "Ativa"
      : effectiveStatus === "archived" ? "Arquivada"
      : conversation.status;
    computedStatusVariant = (effectiveStatus === "waiting" || effectiveStatus === "in_progress" || effectiveStatus === "active") ? "default" : "secondary";
  }

  const statusLabel = computedStatusLabel;
  const statusVariant = computedStatusVariant;

  return (
    <div className="shrink-0">
      <div className="border-b border-border bg-background px-3 py-1.5">
        {/* Row 1: Identity + primary actions */}
        <div className="flex items-center gap-2 min-h-[36px]">

          {/* Close (mobile) */}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden shrink-0" onClick={onClose} aria-label="Fechar chat">
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Avatar */}
          <ContactAvatar
            name={name || ""}
            profilePictureUrl={contact?.profile_picture_url}
            size="md"
          />

          {/* Name + phone */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="text-sm font-semibold truncate min-w-0">{name}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => setIsEditContactOpen(true)} aria-label="Editar contato">
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Editar contato</TooltipContent>
              </Tooltip>
              <ConversationMuteButton conversationId={conversation.id} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 shrink-0"
                    onClick={onToggleDetails}
                    aria-label={effIsLinked ? `Vinculado ao cliente: ${effLinkedName}` : "Contato sem cliente vinculado"}
                  >
                    {effIsLinked ? (
                      <Link2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-yellow-500" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {effIsLinked ? `Vinculado ao cliente: ${effLinkedName}` : "Contato sem cliente vinculado"}
                </TooltipContent>
              </Tooltip>
              {!isGroupConv && contact?.phone_number && (
                <span className="text-[11px] text-muted-foreground truncate hidden sm:inline ml-1">
                  {formatBRPhone(contact.phone_number)}
                </span>
              )}
            </div>
          </div>

          {/* Primary actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            {(conversation as any)?.is_group && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowParticipants(true)}>
                    <Users className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Participantes do grupo</TooltipContent>
              </Tooltip>
            )}

            {isGroupConv && !groupAttendance && (
              <Popover open={groupStartPopoverOpen} onOpenChange={setGroupStartPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 gap-1.5"
                    disabled={isStartingGroupAtt}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Iniciar atendimento
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="group-include-previous" className="text-xs">
                      Incluir mensagens anteriores
                    </Label>
                    <Input
                      id="group-include-previous"
                      type="number"
                      min={0}
                      max={50}
                      value={groupIncludePrevious}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setGroupIncludePrevious(Number.isFinite(v) ? Math.max(0, Math.min(50, v)) : 0);
                      }}
                      className="h-8 px-2"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isStartingGroupAtt}
                      onClick={() => startGroupAttendance(Number(groupIncludePrevious) || 0)}
                    >
                      Iniciar
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}




            {isGroupConv && groupAttendance && (
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="whitespace-nowrap">
                  Em atendimento{assignedOperatorName ? ` · ${assignedOperatorName}` : ""}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-destructive hover:text-destructive"
                  onClick={handleGroupCloseRequest}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Encerrar
                </Button>
              </div>
            )}


            {presenceBlocked && !isGroupConv ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground px-2 cursor-default">Fique ATIVO para atender</span>
                </TooltipTrigger>
                <TooltipContent>Inicie seu expediente ou volte da pausa.</TooltipContent>
              </Tooltip>
            ) : !isGroupConv && (
              <QueueIndicator
                conversationId={conversation.id}
                assignedTo={conversation.assigned_to || null}
                onTransferClick={() => setIsTransferOpen(true)}
                assignedOperatorName={assignedOperatorName}
                contactId={(conversation as any).contact_id ?? conversation.contact?.id}
                clienteId={(conversation.contact as any)?.cliente_id ?? null}
              />
            )}

            <AcessoFastButton
              conversationId={conversation.id}
              tenantId={conversation.tenant_id}
              cnpj={isLinked ? (linkedCliente as any)?.cnpj_digits : null}
              nome={linkedClienteName || contact?.name || null}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={analyze} disabled={isAnalyzing} aria-label="Analisar sentimento">
                  <Brain className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Analisar sentimento</TooltipContent>
            </Tooltip>

            {canSchedule && !isGroupConv && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 shrink-0 ${isScheduled ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10" : ""}`}
                    onClick={() => setShowScheduleDialog(true)}
                    aria-label={isScheduled ? "Editar agendamento" : "Agendar atendimento"}
                  >
                    <CalendarClock className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {isScheduled ? "Editar agendamento" : "Agendar atendimento"}
                </TooltipContent>
              </Tooltip>
            )}

            {conversation.status === "active" && !isGroupConv && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowConfirmCliente(true)}
                    aria-label="Encerrar conversa"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Encerrar conversa</TooltipContent>
              </Tooltip>
            )}

            {(conversation.status === "closed" || conversation.status === "archived") && !isGroupConv && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => reopenConversation(conversation.id)} aria-label="Reabrir conversa">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Reabrir conversa</TooltipContent>
              </Tooltip>
            )}

            {/* Atalho do interruptor de inatividade, que fora daqui só existe em Detalhes */}
            <ChatQuickRuleToggles conversationId={conversation.id} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowInChatSearch(true)} aria-label="Buscar nesta conversa">
                  <FileSearch className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Buscar nesta conversa</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onToggleDetails} aria-label="Detalhes">
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Detalhes</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Mais ações">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {conversation.status === "active" && !isGroupConv && (
                  <DropdownMenuItem onClick={() => archiveConversation(conversation.id)}>
                    <Archive className="h-4 w-4 mr-2" /> Arquivar
                  </DropdownMenuItem>
                )}
                {!conversation.auto_reply_disabled && (
                  <DropdownMenuItem onClick={() => setShowInterruptDialog(true)} disabled={isPausingAutoReply}>
                    <VolumeX className="h-4 w-4 mr-2" /> Interromper auto-respostas
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => markAsUnread(conversation.id)}>
                  <BellOff className="h-4 w-4 mr-2" /> Marcar como não lida
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsManualTicketOpen(true)}>
                  <Ticket className="h-4 w-4 mr-2" /> Abrir Ticket CS
                </DropdownMenuItem>
                {isAdmin && churnDescartado && (
                  <DropdownMenuItem onClick={() => setChurnDismissed(false)} disabled={isSavingChurn}>
                    <AlertTriangle className="h-4 w-4 mr-2" /> Reativar risco de churn
                  </DropdownMenuItem>
                )}
                {!isGroupConv && (isAdmin || (!!user?.id && attendance?.assigned_to === user.id)) && (
                  <DropdownMenuItem onClick={handleOpenAttendanceTicket}>
                    <FileText className="h-4 w-4 mr-2" /> Abrir Ticket do Atendimento
                  </DropdownMenuItem>
                )}
                {hasMultipleInstances && (
                  <DropdownMenuItem onClick={() => setIsChangeInstanceOpen(true)}>
                    <ArrowLeftRight className="h-4 w-4 mr-2" /> Trocar Instância
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => { setDeleteConfirmText(""); setShowDeleteDialog(true); }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Excluir conversa
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Row 2: Context chips — single line, overflow hidden */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none mt-0.5 pl-10">
          <SignatureControl conversationId={conversation.id} />

          {/* Fonte é o hook, não o prop: a conversa selecionada é snapshot e não
              se atualiza quando whatsapp_contacts muda — o badge ficava mudo
              depois de tirar as regras. */}
          {contactRulesDisabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap border-red-500/50 text-red-600 dark:text-red-400">
                  <ShieldOff className="h-2.5 w-2.5" />
                  Sem regras
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                Todas as automações do sistema estão desativadas para este contato
                (encerramento automático, URA, lembretes, off-hours, atribuição automática).
              </TooltipContent>
            </Tooltip>
          )}

          {conversation.auto_reply_disabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap border-amber-500/50 text-amber-600 dark:text-amber-400">
                  <VolumeX className="h-2.5 w-2.5" />
                  Auto-respostas pausadas
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {conversation.auto_reply_disabled_at
                  ? `Pausada em ${new Date(conversation.auto_reply_disabled_at).toLocaleString('pt-BR')}`
                  : 'Pausada por um atendente'}
              </TooltipContent>
            </Tooltip>
          )}

          {!isGroupConv && isScheduled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap border-amber-500/50 text-amber-600 dark:text-amber-400">
                  <CalendarClock className="h-2.5 w-2.5" />
                  Agendado até {format(new Date(scheduledUntil!), "dd/MM HH:mm")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Não encerra por inatividade nem conta no SLA até a data
              </TooltipContent>
            </Tooltip>
          )}

          {!(conversation.opened_out_of_hours && statusLabel === 'Encerrada' && (!attendance || attendance.status !== 'in_progress')) && (
            <Badge variant={statusVariant as any} className={`text-[10px] h-4 shrink-0 whitespace-nowrap ${statusLabel === 'Fora do horário' ? 'border-orange-500/50 text-orange-600 dark:text-orange-400' : ''}`}>
              {statusLabel}
            </Badge>
          )}

          {convDepartment && (
            <Badge variant="outline" className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap border-primary/30 text-primary">
              <Building2 className="h-2.5 w-2.5" />
              {convDepartment.name}
            </Badge>
          )}
          {!convDepartment && selectedDepartment && (
            <Badge variant="outline" className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap">
              <Building2 className="h-2.5 w-2.5" />
              {selectedDepartment.name}
            </Badge>
          )}


          {conversationInstance && hasMultipleInstances && (
            <Badge variant="secondary" className="text-[10px] h-4 shrink-0 whitespace-nowrap">
              {conversationInstance.display_name || conversationInstance.instance_name}
            </Badge>
          )}


          {!isGroupConv && attendance?.created_from === 'billing_automation' && (
            <Badge variant="outline" className="text-[10px] h-4 shrink-0 whitespace-nowrap border-amber-500 text-amber-600 dark:text-amber-400">
              💰 Cobrança
            </Badge>
          )}

          {!isGroupConv && isAfterHours && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClearAfterHours}
                  className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[10px] font-medium shrink-0 whitespace-nowrap border border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                  aria-label="Marcar fora do horário como tratado"
                >
                  <Moon className="h-2.5 w-2.5" />
                  Fora do horário
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Clique para marcar como tratado</TooltipContent>
            </Tooltip>
          )}

          <ClimaResolucaoBadge
            conversationId={conversation.id}
            hasActiveAttendance={!!activeAttendanceId}
            sentiment={sentimentData}
            activeAttendanceId={activeAttendanceId}
          />
        </div>
      </div>

      {conversation.auto_reply_disabled && isAdmin && (
        <div className="border-b border-border bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300 truncate">
              Conversa pausada por briga de URA. Você pode limpar as mensagens automáticas.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
            onClick={() => setShowCleanupDialog(true)}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Limpar mensagens
          </Button>
        </div>
      )}

      {/* CS Ticket Alert Banner */}
      <CSTicketAlert
        sentiment={sentimentData}
        conversation={conversation}
        variant="banner"
        activeAttendanceId={activeAttendanceId}
        canDismiss={!!isAdmin}
      />

      {/* Modals */}
      <InChatMessageSearchModal
        open={showInChatSearch}
        onOpenChange={setShowInChatSearch}
        conversationId={conversation.id}
        contactName={name}
      />
      <EditContactModal
        open={isEditContactOpen}
        onOpenChange={setIsEditContactOpen}
        contactId={contact?.id || ""}
        contactName={contact?.name || ""}
        contactPhone={contact?.phone_number || ""}
        contactNotes={contact?.notes}
        conversationId={conversation.id}
        attendanceId={attendance?.id ?? null}
        isGroup={contact?.is_group ?? false}
      />

      <TransferDialog
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        conversationId={conversation.id}
        currentAssignee={conversation.assigned_to || null}
        onDepartmentTransferred={onDepartmentTransferred}
      />
      <CreateCSTicketFromChat
        open={isManualTicketOpen}
        onOpenChange={setIsManualTicketOpen}
        conversation={conversation}
        sentiment={sentimentData}
      />
      <ChangeInstanceDialog
        open={isChangeInstanceOpen}
        onOpenChange={setIsChangeInstanceOpen}
        conversation={conversation}
        onConversationChanged={onNavigateToConversation}
      />

      <ConfirmClienteModal
        open={showConfirmCliente}
        onOpenChange={setShowConfirmCliente}
        conversationId={conversation.id}
        tenantId={conversation.tenant_id}
        phoneNumber={phoneNumber}
        onConfirmed={handleClienteConfirmed}
        onCancel={() => setShowConfirmCliente(false)}
        requiresCliente={convDepartment?.requires_ticket_on_close === true}
      />

      <CreateSupportTicketModal
        open={showClassifyModal}
        onOpenChange={(o) => { if (!o) setShowClassifyModal(false); }}
        onCreated={handleClassifyCompleted}
        fromClosure
        attendanceId={attendance?.id ?? null}
        closureClienteId={closureClienteIdEff}
        closureClienteNome={closureClienteNomeEff}
        closureClienteCodigo={closureClienteCodigoEff}
        closureProdutoId={closureProdutoIdEff}
        closureDepartmentId={(conversation as any).department_id ?? null}
        closureResponsavelId={attendance?.assigned_to ?? null}
        closureContactName={contact?.name ?? null}
        closureHandleSeconds={(attendance as any)?.handle_seconds ?? null}
        closureAiSummary={(attendance as any)?.ai_summary ?? null}
        closureAiTopics={(attendance as any)?.ai_topics ?? null}
        closureAiKeywords={(attendance as any)?.ai_keywords ?? null}
        closureAiProblem={(attendance as any)?.ai_problem ?? null}
        closureAiSolution={(attendance as any)?.ai_solution ?? null}
        closureSentimentLabel={sentimentData?.sentiment ?? null}
        closureSentimentConfidence={sentimentData?.confidence ?? null}
        closureSentimentSummary={sentimentData?.summary ?? null}
      />

      {/* Picker de atendimento para "Abrir Ticket do Atendimento" */}
      <Dialog
        open={showAttendanceTicketPicker}
        onOpenChange={(o) => { if (!o) setShowAttendanceTicketPicker(false); }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Selecione o atendimento</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={attendanceSearch}
              onChange={(e) => setAttendanceSearch(e.target.value)}
              placeholder="Pesquisar pelo número do atendimento…"
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-2 max-h-[60vh] overflow-auto py-2">
            {isLoadingAttendanceList && (
              <p className="text-sm text-muted-foreground">Carregando atendimentos…</p>
            )}
            {!isLoadingAttendanceList && filteredAttendanceList.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {attendanceSearch.trim()
                  ? "Nenhum atendimento corresponde à busca."
                  : "Nenhum atendimento encontrado para esta conversa."}
              </p>
            )}
            {!isLoadingAttendanceList && filteredAttendanceList.map((a) => {
              const hasTicket = !!a.ticket_id;
              const isOpen = a.status !== 'closed' && a.status !== 'inactive_closed';
              const pickMode = getPickMode(a);
              const allowed = canPickAttendance(a);
              const selected = pickerSelectedId === a.id;
              const hasCliente = !!a?.cliente_id || !!(linkedCliente as any)?.id;
              const noPermissionClassif =
                (pickMode === 'classificacao' || pickMode === 'classificacao_aberta') &&
                !allowed && hasCliente;
              const noClienteBlock =
                (pickMode === 'classificacao' || pickMode === 'classificacao_aberta') && !hasCliente;

              const handleClick = () => {
                if (!allowed) return;
                setPickerSelectedId(a.id);
              };

              const handleViewTicket = (e: React.MouseEvent) => {
                e.stopPropagation();
                setShowAttendanceTicketPicker(false);
                setReadOnlyTicketId(a.ticket_id);
              };

              const row = (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={allowed ? 0 : -1}
                  onClick={handleClick}
                  onKeyDown={(e) => { if (allowed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleClick(); } }}
                  className={`group w-full text-left rounded-md border px-3 py-2 transition-colors ${
                    selected && allowed ? 'border-primary bg-primary/5' : 'border-border'
                  } ${!allowed ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50 cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {a.attendance_code || a.id.slice(0, 8)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(new Date(a.created_at), 'dd/MM/yyyy HH:mm')} · {a.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOpen && !hasTicket ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400 whitespace-nowrap">
                          Em atendimento
                        </Badge>
                      ) : isOpen && hasTicket ? (
                        <Badge variant="secondary" className="text-[10px] whitespace-nowrap">
                          Ticket vinculado
                        </Badge>
                      ) : hasTicket ? (
                        <Badge variant="secondary" className="text-[10px]">Ticket já criado</Badge>
                      ) : null}
                      {hasTicket && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={handleViewTicket}
                        >
                          Ver ticket
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
              if (noClienteBlock) {
                return (
                  <Tooltip key={a.id}>
                    <TooltipTrigger asChild><div>{row}</div></TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Vincule um cliente ao atendimento para abrir o ticket.
                    </TooltipContent>
                  </Tooltip>
                );
              }
              if (noPermissionClassif) {
                return (
                  <Tooltip key={a.id}>
                    <TooltipTrigger asChild><div>{row}</div></TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">Sem permissão para classificar este atendimento</TooltipContent>
                  </Tooltip>
                );
              }
              return row;
            })}
          </div>

          <div className="pt-3 mt-1 border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 border-primary text-green-400 hover:bg-primary/10 hover:text-green-300"
              onClick={() => {
                setShowAttendanceTicketPicker(false);
                setIsAvulsoTicketOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Abrir ticket avulso (sem atendimento)
            </Button>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAttendanceTicketPicker(false)}>Cancelar</Button>
            <Button
              onClick={handleConfirmPickerSelection}
              disabled={!pickerSelectedId || !canPickAttendance((attendanceTicketList as any[]).find(a => a.id === pickerSelectedId))}
            >
              {(() => {
                const sel = (attendanceTicketList as any[]).find(a => a.id === pickerSelectedId);
                if (!sel) return 'Continuar';
                const m = getPickMode(sel);
                if (m === 'view_ticket') return 'Ver ticket';
                if (m === 'classificacao') return 'Gerar ticket';
                return 'Abrir ticket';
              })()}
            </Button>
          </DialogFooter>


        </DialogContent>
      </Dialog>

      {/* Modal de classificação para criar ticket do atendimento escolhido (sem encerrar conversa) */}
      {attendanceTicketTarget && (
        <CreateSupportTicketModal
          open={showAttendanceTicketModal}
          onOpenChange={(o) => {
            if (!o) {
              setShowAttendanceTicketModal(false);
              setAttendanceTicketTarget(null);
            }
          }}
          onCreated={handleAttendanceTicketCreated}
          fromClosure
          mode={getPickMode(attendanceTicketTarget) as any}
          attendanceId={attendanceTicketTarget.id}
          closureClienteId={attendanceTicketTarget.clientes?.id ?? closureClienteIdEff}
          closureClienteNome={attendanceTicketTarget.clientes?.nome_fantasia ?? closureClienteNomeEff}
          closureClienteCodigo={attendanceTicketTarget.clientes?.codigo_sequencial ?? closureClienteCodigoEff}
          closureProdutoId={attendanceTicketTarget.clientes?.produto_id ?? closureProdutoIdEff}
          closureDepartmentId={attendanceTicketTarget.department_id ?? (conversation as any).department_id ?? null}
          closureResponsavelId={attendanceTicketTarget.assigned_to ?? (conversation as any).assigned_to ?? null}
          closureContactName={contact?.name ?? null}
          closureHandleSeconds={attendanceTicketTarget.handle_seconds ?? null}
          closureAiSummary={attendanceTicketTarget.ai_summary ?? null}
          closureAiTopics={null}
          closureAiKeywords={null}
          closureAiProblem={attendanceTicketTarget.ai_problem ?? null}
          closureAiSolution={attendanceTicketTarget.ai_solution ?? null}
          closureSentimentLabel={attendanceTicketTarget.id === attendance?.id ? (sentimentData?.sentiment ?? null) : null}
          closureSentimentConfidence={attendanceTicketTarget.id === attendance?.id ? (sentimentData?.confidence ?? null) : null}
          closureSentimentSummary={attendanceTicketTarget.id === attendance?.id ? (sentimentData?.summary ?? null) : null}
        />
      )}

      {/* Ticket avulso (manual, sem atendimento) — cliente/setor do chat pré-selecionados */}
      <CreateSupportTicketModal
        open={isAvulsoTicketOpen}
        onOpenChange={(o) => { if (!o) setIsAvulsoTicketOpen(false); }}
        onCreated={() => {
          setIsAvulsoTicketOpen(false);
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
          toast.success('Ticket avulso criado');
        }}
        defaultDepartmentId={(conversation as any).department_id ?? undefined}
        defaultClienteId={(linkedCliente as any)?.id ?? null}
        defaultClienteNome={(linkedCliente as any)?.nome_fantasia ?? (linkedCliente as any)?.razao_social ?? null}
        defaultClienteCodigo={(linkedCliente as any)?.codigo_sequencial ?? null}
      />


      {/* Fluxo REOPEN: atendimento já tem ticket vinculado ao encerrar */}
      <TicketReopenChoiceDialog
        open={showReopenChoice}
        onOpenChange={(o) => { if (!o) setShowReopenChoice(false); }}
        existingTicketCode={attachTicketCode ?? null}
        onUpdateExisting={() => handleReopenChoose("update")}
        onCreateNew={() => handleReopenChoose("create")}
      />

      <TicketUpdateExistingDialog
        open={showUpdateExisting}
        onOpenChange={(o) => { if (!o) setShowUpdateExisting(false); }}
        attendanceId={attendance?.id ?? null}
        existingTicketId={effectiveTicketId}
        onCompleted={handleUpdateExistingCompleted}
      />

      {/* Criar ticket adicional (atendimento reaberto) — usa o MESMO formulário */}
      <CreateSupportTicketModal
        open={showCreateAdditional}
        onOpenChange={(o) => { if (!o) setShowCreateAdditional(false); }}
        onCreated={handleAdditionalTicketCreated}
        fromClosure
        mode="additional"
        attendanceId={attendance?.id ?? null}
        closureClienteId={closureClienteIdEff}
        closureClienteNome={closureClienteNomeEff}
        closureClienteCodigo={closureClienteCodigoEff}
        closureProdutoId={closureProdutoIdEff}
        closureDepartmentId={(conversation as any).department_id ?? null}
        closureResponsavelId={attendance?.assigned_to ?? null}
        closureContactName={contact?.name ?? null}
        closureHandleSeconds={(attendance as any)?.handle_seconds ?? null}
        closureAiSummary={(attendance as any)?.ai_summary ?? null}
        closureAiTopics={(attendance as any)?.ai_topics ?? null}
        closureAiKeywords={(attendance as any)?.ai_keywords ?? null}
        closureAiProblem={(attendance as any)?.ai_problem ?? null}
        closureAiSolution={(attendance as any)?.ai_solution ?? null}
        closureSentimentLabel={sentimentData?.sentiment ?? null}
        closureSentimentConfidence={sentimentData?.confidence ?? null}
        closureSentimentSummary={sentimentData?.summary ?? null}
      />

      {/* Visualização read-only de ticket vinculado (Mudança D) */}
      <SupportTicketDetailDialog
        ticketId={readOnlyTicketId}
        open={!!readOnlyTicketId}
        onOpenChange={(o) => { if (!o) setReadOnlyTicketId(null); }}
      />





      {/* Modal "Atualizar ticket" — atendimento reaberto já vinculado a ticket */}
      <Dialog open={showAttachTicketModal} onOpenChange={(o) => { if (!o) setShowAttachTicketModal(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Este atendimento já possui ticket</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O atendimento reaberto está vinculado ao ticket{" "}
            <strong>{attachTicketCode ?? "…"}</strong>.
            Você pode atualizar esse ticket e encerrar o atendimento.
          </p>
          <div className="space-y-2">
            <Label htmlFor="attach-note">Nota (opcional)</Label>
            <Textarea
              id="attach-note"
              value={attachNote}
              onChange={(e) => setAttachNote(e.target.value)}
              rows={3}
              placeholder="Observação que será registrada na timeline do ticket…"
              className="resize-none text-sm"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowAttachTicketModal(false)}>Cancelar</Button>
            <Button onClick={handleAttachAndClose}>Atualizar e encerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmação de encerramento */}
      <Dialog open={showCloseModal} onOpenChange={setShowCloseModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Encerrar atendimento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Como deseja encerrar este atendimento?
          </p>
          <div className="flex flex-col gap-2 mt-2">
            <Button
              variant="default"
              onClick={() => {
                setShowCloseModal(false);
                closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: false, isGroup: isGroupConv });
              }}
            >
              ✅ Encerrar e enviar CSAT
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowCloseModal(false);
                closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, isGroup: isGroupConv });
              }}
            >
              💬 Encerrar com mensagem de encerramento
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCloseModal(false);
                closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, skipClosureMessage: true, isGroup: isGroupConv });
              }}
            >
              🔇 Encerrar sem enviar mensagem ao cliente
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowCloseModal(false)}
            >
              ❌ Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <InterruptAutoReplyDialog
        open={showInterruptDialog}
        onOpenChange={setShowInterruptDialog}
        isPausing={isPausingAutoReply}
        onConfirmPause={({ close }) => {
          pauseAutoReply({ conversationId: conversation.id });
          if (close) {
            closeConversation({ conversationId: conversation.id, generateSummary: true, skipCsat: true, skipClosureMessage: true, isGroup: isGroupConv });
          }
        }}
      />

      <CleanupConversationDialog
        open={showCleanupDialog}
        onOpenChange={setShowCleanupDialog}
        conversationId={conversation.id}
        isDeleting={isDeletingMessages}
        onConfirm={(messageIds) => {
          deleteMessagesByIds({ conversationId: conversation.id, messageIds });
          setShowCleanupDialog(false);
        }}
        isResuming={isResumingAutoReply}
        onResume={() => {
          resumeAutoReply(conversation.id);
          setShowCleanupDialog(false);
        }}
      />

      <GroupLinkClienteModal
        open={showGroupLinkModal}
        onOpenChange={setShowGroupLinkModal}
        conversationId={conversation.id}
        onLinked={handleGroupLinked}
      />
      <ScheduleAttendanceDialog
        open={showScheduleDialog}
        onOpenChange={setShowScheduleDialog}
        currentScheduledUntil={scheduledUntil}
        isScheduling={isSchedulingAttendance}
        isUnscheduling={isUnschedulingAttendance}
        onConfirmSchedule={(iso) => {
          if (!attendance?.id) return;
          scheduleAttendance({ attendanceId: attendance.id, scheduledUntilIso: iso });
          setShowScheduleDialog(false);
        }}
        onConfirmUnschedule={() => {
          if (!attendance?.id) return;
          unscheduleAttendance(attendance.id);
          setShowScheduleDialog(false);
        }}
      />
      <GroupParticipantsSheet
        open={showParticipants}
        onOpenChange={setShowParticipants}
        conversationId={conversation?.id || ""}
        providerType={(conversation as any)?.instance?.provider_type ?? null}
      />


      <Dialog open={showDeleteDialog} onOpenChange={(o) => { if (!o) { setShowDeleteDialog(false); setDeleteConfirmText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Excluir conversa permanentemente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta ação é <strong>irreversível</strong>. Todas as mensagens, atendimentos e dados desta conversa serão excluídos permanentemente.
            </p>
            <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
              <p className="text-sm font-medium">Para confirmar, digite o nome abaixo:</p>
              <p className="text-sm font-bold mt-1">{deleteTargetName}</p>
            </div>
            <input
              type="text"
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              placeholder="Digite o nome para confirmar..."
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== deleteTargetName || isDeleting}
              onClick={handleDeleteConversation}
            >
              {isDeleting ? "Excluindo..." : "Excluir permanentemente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
