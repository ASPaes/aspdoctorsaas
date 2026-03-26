import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatBRPhone } from "@/lib/phoneBR";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Archive, MoreVertical, X, RotateCcw, PanelRightOpen, BellOff, Pencil, Ticket, ArrowLeftRight, XCircle, Brain, Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateCSTicketFromChat } from "./CreateCSTicketFromChat";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import { useConversationTopics } from "../hooks/useConversationTopics";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { Badge } from "@/components/ui/badge";
import { EditContactModal } from "./EditContactModal";
import { QueueIndicator } from "./QueueIndicator";
import { TransferDialog } from "./TransferDialog";
import { CSTicketAlert } from "./CSTicketAlert";
import { ChangeInstanceDialog } from "./ChangeInstanceDialog";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { SignatureControl } from "./SignatureControl";
import { SentimentChip } from "./SentimentChip";
import { TopicBadges } from "./TopicBadges";
import { useSenderMap } from "../hooks/useSenderMap";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAgentPresence } from "@/hooks/useAgentPresence";

interface Props {
  conversation: ConversationWithContact;
  onToggleDetails: () => void;
  showDetails: boolean;
  onClose?: () => void;
  onNavigateToConversation?: (conversationId: string) => void;
  onDepartmentTransferred?: () => void;
}

export function ChatHeader({ conversation, onToggleDetails, showDetails, onClose, onNavigateToConversation, onDepartmentTransferred }: Props) {
  const { archiveConversation, closeConversation, reopenConversation, markAsUnread } = useWhatsAppActions();
  const { sentiment, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentimentData = sentiment as any;
  const { data: topicsData } = useConversationTopics(conversation.id);
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isManualTicketOpen, setIsManualTicketOpen] = useState(false);
  const [isChangeInstanceOpen, setIsChangeInstanceOpen] = useState(false);
  const { instances } = useWhatsAppInstances();
  const hasMultipleInstances = instances.length > 1;
  const { isBlocked: presenceBlocked } = useAgentPresence();

  // Fetch department name from conversation.department_id
  const { effectiveTenantId: tid } = useTenantFilter();
  const convDeptId = (conversation as any).department_id;
  const { data: convDepartment } = useQuery({
    queryKey: ["conv-department", convDeptId],
    enabled: !!convDeptId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_departments")
        .select("id, name")
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

  // Use attendance status as single source of truth for status display
  const { attendanceMap } = useAttendanceStatus([conversation.id], true);
  const attendance = attendanceMap.get(conversation.id);

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
    if (attendance) {
      if (attendance.status === "waiting") return "waiting";
      if (attendance.status === "in_progress") return "in_progress";
      if (attendance.status === "closed" || attendance.status === "inactive_closed") return "closed";
    }
    return conversation.status;
  }, [attendance, conversation.status]);

  const statusLabel = effectiveStatus === "waiting" ? "Na Fila"
    : effectiveStatus === "in_progress" ? "Em Atendimento"
    : effectiveStatus === "closed" ? "Encerrada"
    : effectiveStatus === "active" ? "Ativa"
    : effectiveStatus === "archived" ? "Arquivada"
    : conversation.status;
  const statusVariant = (effectiveStatus === "waiting" || effectiveStatus === "in_progress" || effectiveStatus === "active") ? "default" : "secondary";

  return (
    <div className="shrink-0">
      <div className="border-b border-border bg-background px-3 py-2">
        {/* Row 1: Identity + primary actions */}
        <div className="flex items-center gap-2 min-h-[40px]">

          {/* Close (mobile) */}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Avatar */}
          <Avatar className="h-9 w-9 shrink-0">
            {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
            <AvatarFallback className="text-xs font-medium">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>

          {/* Name + status */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold truncate min-w-0">{name}</p>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => setIsEditContactOpen(true)} title="Editar contato">
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </Button>
              <Badge variant={statusVariant as any} className="text-[10px] h-4 shrink-0 whitespace-nowrap">{statusLabel}</Badge>
              {attendance?.created_from === 'billing_automation' && (
                <Badge variant="outline" className="text-[10px] h-4 shrink-0 whitespace-nowrap border-amber-500 text-amber-600 dark:text-amber-400">
                  💰 Cobrança
                </Badge>
              )}
              {assignedOperatorName && (
                <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                  Técnico: {assignedOperatorName}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{contact?.phone_number ? formatBRPhone(contact.phone_number) : ""}</p>
          </div>

          {/* Primary actions — always visible */}
          <div className="flex items-center gap-0.5 shrink-0">
            {presenceBlocked ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground px-2 cursor-default">Fique ATIVO para atender</span>
                </TooltipTrigger>
                <TooltipContent>Inicie seu expediente ou volte da pausa.</TooltipContent>
              </Tooltip>
            ) : (
              <QueueIndicator
                conversationId={conversation.id}
                assignedTo={conversation.assigned_to || null}
                onTransferClick={() => setIsTransferOpen(true)}
              />
            )}

            {/* Analisar sentimento — visible button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={analyze} disabled={isAnalyzing}>
                  <Brain className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Analisar sentimento</TooltipContent>
            </Tooltip>

            {/* Encerrar conversa — visible button */}
            {conversation.status === "active" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => closeConversation({ conversationId: conversation.id, generateSummary: true })}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Encerrar conversa</TooltipContent>
              </Tooltip>
            )}

            {/* Reabrir — visible when closed */}
            {(conversation.status === "closed" || conversation.status === "archived") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => reopenConversation(conversation.id)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Reabrir conversa</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onToggleDetails}>
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Detalhes</TooltipContent>
            </Tooltip>

            {/* Menu de ações secundárias */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {conversation.status === "active" && (
                  <DropdownMenuItem onClick={() => archiveConversation(conversation.id)}>
                    <Archive className="h-4 w-4 mr-2" /> Arquivar
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => markAsUnread(conversation.id)}>
                  <BellOff className="h-4 w-4 mr-2" /> Marcar como não lida
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsManualTicketOpen(true)}>
                  <Ticket className="h-4 w-4 mr-2" /> Abrir Ticket CS
                </DropdownMenuItem>
                {hasMultipleInstances && (
                  <DropdownMenuItem onClick={() => setIsChangeInstanceOpen(true)}>
                    <ArrowLeftRight className="h-4 w-4 mr-2" /> Trocar Instância
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Row 2: Context chips — wraps naturally */}
        <div className="flex items-center gap-1.5 flex-wrap mt-1 pl-12">
          <SignatureControl conversationId={conversation.id} />
          {convDepartment && (
            <Badge variant="outline" className="text-[10px] h-4 gap-1 border-primary/30 text-primary">
              <Building2 className="h-2.5 w-2.5" />
              Setor: {convDepartment.name}
            </Badge>
          )}
          {!convDepartment && selectedDepartment && (
            <Badge variant="outline" className="text-[10px] h-4 gap-1">
              <Building2 className="h-2.5 w-2.5" />
              Setor: {selectedDepartment.name}
            </Badge>
          )}
          {conversationInstance && hasMultipleInstances && (
            <Badge variant="secondary" className="text-[10px] h-4">
              Canal: {conversationInstance.display_name || conversationInstance.instance_name}
            </Badge>
          )}
          <SentimentChip sentiment={sentimentData} />
          {effectiveStatus !== "closed" && topicsData?.topics && topicsData.topics.length > 0 && (
            <TopicBadges topics={topicsData.topics} size="sm" showIcon={false} maxTopics={2} />
          )}
        </div>
      </div>

      {/* CS Ticket Alert Banner */}
      <CSTicketAlert sentiment={sentimentData} conversation={conversation} variant="banner" />

      {/* Modals */}
      <EditContactModal
        open={isEditContactOpen}
        onOpenChange={setIsEditContactOpen}
        contactId={contact?.id || ""}
        contactName={contact?.name || ""}
        contactPhone={contact?.phone_number || ""}
        contactNotes={contact?.notes}
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
    </div>
  );
}
