import { useState, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Archive, MoreVertical, X, RotateCcw, PanelRightOpen, BellOff, RefreshCw, Pencil, Settings, Ticket, ArrowLeftRight } from "lucide-react";
import { Link } from "react-router-dom";
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

interface Props {
  conversation: ConversationWithContact;
  onToggleDetails: () => void;
  showDetails: boolean;
  onClose?: () => void;
}

export function ChatHeader({ conversation, onToggleDetails, showDetails, onClose }: Props) {
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
  const contact = conversation.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";

  const statusLabel = conversation.status === "active" ? "Ativa" : conversation.status === "closed" ? "Encerrada" : "Arquivada";
  const statusVariant = conversation.status === "active" ? "default" : "secondary";

  return (
    <div className="shrink-0">
      <div className="border-b border-border bg-background">
        {/* Main row */}
        <div className="flex items-center gap-3 px-4 py-2.5 min-h-[56px]">

          {/* ─── LEFT: Identity ─── */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            {onClose && (
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}

            <Avatar className="h-9 w-9 shrink-0">
              {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
              <AvatarFallback className="text-xs font-medium">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold truncate">{name}</p>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => setIsEditContactOpen(true)} title="Editar contato">
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </Button>
                <Badge variant={statusVariant as any} className="text-[10px] h-4 shrink-0">{statusLabel}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{contact?.phone_number}</p>
            </div>
          </div>

          {/* ─── CENTER: Context chips ─── */}
          <div className="flex-1 flex items-center justify-center gap-2 overflow-x-auto scrollbar-none min-w-0 px-2">
            <SignatureControl conversationId={conversation.id} />
            <SentimentChip sentiment={sentimentData} />
            {topicsData?.topics && topicsData.topics.length > 0 && (
              <TopicBadges topics={topicsData.topics} size="sm" showIcon={false} maxTopics={2} />
            )}
          </div>

          {/* ─── RIGHT: Actions ─── */}
          <div className="flex items-center gap-1 shrink-0">
            <QueueIndicator
              conversationId={conversation.id}
              assignedTo={conversation.assigned_to || null}
              onTransferClick={() => setIsTransferOpen(true)}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={analyze} disabled={isAnalyzing}>
                  <RefreshCw className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Analisar sentimento</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleDetails}>
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Detalhes</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {conversation.status === "active" && (
                  <>
                    <DropdownMenuItem onClick={() => closeConversation({ conversationId: conversation.id, generateSummary: true })}>
                      <X className="h-4 w-4 mr-2" /> Encerrar conversa
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => archiveConversation(conversation.id)}>
                      <Archive className="h-4 w-4 mr-2" /> Arquivar
                    </DropdownMenuItem>
                  </>
                )}
                {(conversation.status === "closed" || conversation.status === "archived") && (
                  <DropdownMenuItem onClick={() => reopenConversation(conversation.id)}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Reabrir conversa
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
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
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/whatsapp/settings" className="flex items-center">
                    <Settings className="h-4 w-4 mr-2" /> Configurações
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
      />
    </div>
  );
}
