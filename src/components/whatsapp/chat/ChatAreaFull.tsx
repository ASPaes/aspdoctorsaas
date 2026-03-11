import { useState, useCallback, useMemo } from "react";
import { MessageSquare, Trash2, Forward, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import type { Message } from "../hooks/useWhatsAppMessages";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { DetailsSidebar } from "./DetailsSidebar";
import { ForwardMessageDialog } from "./ForwardMessageDialog";
import { useDeleteMessages } from "../hooks/useDeleteMessages";
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

type DeleteMode = 'local' | 'everyone';

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
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('everyone');

  const deleteMutation = useDeleteMessages();
  const queryClient = useQueryClient();

  const messages: Message[] = queryClient.getQueryData(
    ['whatsapp', 'messages', conversation?.id]
  ) ?? [];

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

  // Check if all selected messages can be deleted for everyone (from me + < 5 min)
  const allSelectedCanDeleteEveryone = useMemo(() => {
    if (selectedMessages.size === 0) return false;
    const now = Date.now();
    return [...selectedMessages].every(id => {
      if (id.startsWith('temp-')) return false;
      const msg = messages.find(m => m.id === id);
      return msg && msg.is_from_me && (msg as any).delete_status !== 'revoked' && (now - new Date(msg.timestamp).getTime()) <= FIVE_MINUTES;
    });
  }, [selectedMessages, messages]);

  // Handlers
  const handleDeleteLocal = (msgId: string) => {
    setDeleteIds([msgId]);
    setDeleteMode('local');
    setDeleteConfirmOpen(true);
  };

  const handleDeleteEveryone = (msgId: string) => {
    setDeleteIds([msgId]);
    setDeleteMode('everyone');
    setDeleteConfirmOpen(true);
  };

  const handleRetryDelete = (msgId: string) => {
    setDeleteIds([msgId]);
    setDeleteMode('everyone');
    setDeleteConfirmOpen(true);
  };

  const handleForwardSingle = (msgId: string) => {
    setForwardIds([msgId]);
    setForwardOpen(true);
  };

  const handleBulkDeleteLocal = () => {
    setDeleteIds([...selectedMessages]);
    setDeleteMode('local');
    setDeleteConfirmOpen(true);
  };

  const handleBulkDeleteEveryone = () => {
    setDeleteIds([...selectedMessages]);
    setDeleteMode('everyone');
    setDeleteConfirmOpen(true);
  };

  const handleBulkForward = () => {
    setForwardIds([...selectedMessages]);
    setForwardOpen(true);
  };

  const confirmDelete = async () => {
    if (!conversation) return;
    await deleteMutation.mutateAsync({
      messageIds: deleteIds,
      conversationId: conversation.id,
      mode: deleteMode,
    });
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
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <ChatHeader
          conversation={conversation}
          onToggleDetails={() => setShowDetails(!showDetails)}
          showDetails={showDetails}
          onClose={onClose}
        />
        <ChatMessages
          conversationId={conversation.id}
          unreadCount={conversation.unread_count ?? 0}
          onReply={setReplyTo}
          selectionMode={selectionMode}
          selectedMessages={selectedMessages}
          onToggleSelect={toggleSelect}
          onDeleteLocal={handleDeleteLocal}
          onDeleteEveryone={handleDeleteEveryone}
          onRetryDelete={handleRetryDelete}
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
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkDeleteLocal}
                disabled={selectedMessages.size === 0 || deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Excluir do sistema
              </Button>
              {allSelectedCanDeleteEveryone && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleBulkDeleteEveryone}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Apagar para todos ({selectedMessages.size})
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

      {showDetails && (
        <DetailsSidebar
          conversation={conversation}
          onClose={() => setShowDetails(false)}
        />
      )}

      <ForwardMessageDialog
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        messageIds={forwardIds}
        onDone={() => { setForwardIds([]); exitSelectionMode(); }}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteMode === 'local'
                ? `Excluir do sistema?`
                : `Apagar para todos?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMode === 'local'
                ? `${deleteIds.length === 1 ? 'A mensagem será removida apenas da sua visualização.' : `${deleteIds.length} mensagens serão removidas apenas da sua visualização.`} O destinatário continuará vendo.`
                : deleteIds.length === 1
                  ? 'A mensagem será apagada no WhatsApp do destinatário.'
                  : `${deleteIds.length} mensagens serão apagadas no WhatsApp do destinatário.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMode === 'local' ? 'Excluir' : 'Apagar para todos'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
