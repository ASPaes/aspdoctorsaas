import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Archive, MoreVertical, X, RotateCcw, PanelRightOpen, BellOff, RefreshCw, Pencil, Settings, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import { CreateCSTicketFromChat } from "./CreateCSTicketFromChat";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import { useConversationTopics } from "../hooks/useConversationTopics";
import { Badge } from "@/components/ui/badge";
import { SentimentCard } from "./SentimentCard";
import { TopicBadges } from "./TopicBadges";
import { EditContactModal } from "./EditContactModal";
import { QueueIndicator } from "./QueueIndicator";
import { TransferDialog } from "./TransferDialog";
import { CSTicketAlert } from "./CSTicketAlert";

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
  const contact = conversation.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";

  const statusLabel = conversation.status === "active" ? "Ativa" : conversation.status === "closed" ? "Encerrada" : "Arquivada";
  const statusVariant = conversation.status === "active" ? "default" : "secondary";

  return (
    <div className="shrink-0">
      <div className="h-auto min-h-[56px] border-b border-border flex items-center px-4 py-2 gap-3 bg-background">
        {onClose && (
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}

        <Avatar className="h-9 w-9 shrink-0">
          {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
          <AvatarFallback className="text-xs">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{name}</p>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setIsEditContactOpen(true)} title="Editar contato">
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
            <Badge variant={statusVariant as any} className="text-[10px] h-4">{statusLabel}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{contact?.phone_number}</p>
          {topicsData?.topics && topicsData.topics.length > 0 && (
            <div className="mt-0.5">
              <TopicBadges topics={topicsData.topics} size="sm" showIcon={true} maxTopics={3} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <QueueIndicator
            conversationId={conversation.id}
            assignedTo={conversation.assigned_to || null}
            onTransferClick={() => setIsTransferOpen(true)}
          />
          <SentimentCard sentiment={sentimentData} />

          <Button variant="ghost" size="sm" onClick={analyze} disabled={isAnalyzing} title="Analisar sentimento">
            <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
          </Button>

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleDetails}>
            <PanelRightOpen className="h-4 w-4" />
          </Button>

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
            </DropdownMenuContent>
          </DropdownMenu>

          <Link to="/whatsapp/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <EditContactModal
          open={isEditContactOpen}
          onOpenChange={setIsEditContactOpen}
          contactId={contact?.id || ''}
          contactName={contact?.name || ''}
          contactPhone={contact?.phone_number || ''}
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
      </div>

      {/* CS Ticket Alert Banner */}
      <CSTicketAlert sentiment={sentimentData} conversation={conversation} variant="banner" />
    </div>
  );
}
