import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Archive, MoreVertical, X, RotateCcw, Phone, PanelRightOpen, BellOff } from "lucide-react";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { Badge } from "@/components/ui/badge";

interface Props {
  conversation: ConversationWithContact;
  onToggleDetails: () => void;
  showDetails: boolean;
  onClose?: () => void;
}

export function ChatHeader({ conversation, onToggleDetails, showDetails, onClose }: Props) {
  const { archiveConversation, closeConversation, reopenConversation, markAsUnread } = useWhatsAppActions();
  const contact = conversation.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";

  const statusLabel = conversation.status === "active" ? "Ativa" : conversation.status === "closed" ? "Encerrada" : "Arquivada";
  const statusVariant = conversation.status === "active" ? "default" : "secondary";

  return (
    <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-background">
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
          <Badge variant={statusVariant} className="text-[10px] h-4">{statusLabel}</Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{contact?.phone_number}</p>
      </div>

      <div className="flex items-center gap-1">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
