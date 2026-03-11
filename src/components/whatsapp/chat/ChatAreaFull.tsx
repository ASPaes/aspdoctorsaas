import { useState, useCallback, useMemo } from "react";
import { MessageSquare, Trash2, Forward, X } from "lucide-react";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import type { Message } from "../hooks/useWhatsAppMessages";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { DetailsSidebar } from "./DetailsSidebar";
import { ForwardMessageDialog } from "./ForwardMessageDialog";
import { useDeleteMessages } from "../hooks/useDeleteMessages";
import { useWhatsAppMessages } from "../hooks/useWhatsAppMessages";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  conversation: ConversationWithContact | null;
  onClose?: () => void;
}

const FIVE_MINUTES = 5 * 60 * 1000;

export function ChatAreaFull({ conversation, onClose }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  // Forward dialog
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardIds, setForwardIds] = useState<string[]>([]);

  // Delete confirm
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const deleteMutation = useDeleteMessages();
  const { messages } = useWhatsAppMessages(conversation?.id || null);

  const toggleSelect = useCallback((msgId: string) => {
    setSelectedMessages(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedMessages(new Set());
  }, []);

  const enterSelectionMode = useCallback((msgId: string) => {
    setSelectionMode(true);
    setSelectedMessages(new Set([msgId]));
  }, []);

  // Check if all selected messages can be deleted
  const allSelectedCanDelete = useMemo(() => {
    if (selectedMessages.size === 0) return false;
    const now = Date.now();
    return [...selectedMessages].every(id => {
      if (id.startsWith('temp-')) return false;
      const msg = messages.find(m => m.id === id);
      return msg && msg.is_from_me && msg.status !== 'deleted' && (now - new Date(msg.timestamp).getTime()) <= FIVE_MINUTES;
    });
  }, [selectedMessages, messages]);

  // Handlers
  const handleDeleteSingle = (msgId: string) => {
    setDeleteIds([msgId]);
    setDeleteConfirmOpen(true);
  };

  const handleForwardSingle = (msgId: string) => {
    setForwardIds([msgId]);
    setForwardOpen(true);
  };

  const handleBulkDelete = () => {
    setDeleteIds([...selectedMessages]);
    setDeleteConfirmOpen(true);
  };

  const handleBulkForward = () => {
    setForwardIds([...selectedMessages]);
    setForwardOpen(true);
  };

  const confirmDelete = async () => {
    if (!conversation) return;
    await deleteMutation.mutateAsync({ messageIds: deleteIds, conversationId: conversation.id });
    setDeleteConfirmOpen(false);
    setDeleteIds([]);
    exitSelectionMode();
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <MessageSquare className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Selecione uma conversa</p>
        <p className="text-sm mt-1">Escolha uma conversa na lista para começar</p>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <ChatHeader
          conversation={conversation}
          onToggleDetails={() => setShowDetails(!showDetails)}
          showDetails={showDetails}
          onClose={onClose}
        />
        <ChatMessages
          conversationId={conversation.id}
          onReply={setReplyTo}
          selectionMode={selectionMode}
          selectedMessages={selectedMessages}
          onToggleSelect={toggleSelect}
          onDeleteSingle={handleDeleteSingle}
          onForwardSingle={handleForwardSingle}
          onEnterSelectionMode={enterSelectionMode}
        />

        {/* Selection action bar */}
        {selectionMode ? (
          <div className="border-t bg-background px-4 py-2 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedMessages.size} selecionada{selectedMessages.size !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              {allSelectedCanDelete && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Apagar ({selectedMessages.size})
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkForward}
                disabled={selectedMessages.size === 0}
              >
                <Forward className="h-4 w-4 mr-1" />
                Encaminhar ({selectedMessages.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={exitSelectionMode}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <ChatInput
            conversationId={conversation.id}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        )}
      </div>

      {/* Details sidebar */}
      {showDetails && (
        <DetailsSidebar
          conversation={conversation}
          onClose={() => setShowDetails(false)}
        />
      )}

      {/* Forward dialog */}
      <ForwardMessageDialog
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        messageIds={forwardIds}
        onDone={() => { setForwardIds([]); exitSelectionMode(); }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem{deleteIds.length !== 1 ? 'ns' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIds.length === 1
                ? 'Esta mensagem será apagada para todos.'
                : `${deleteIds.length} mensagens serão apagadas para todos.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
