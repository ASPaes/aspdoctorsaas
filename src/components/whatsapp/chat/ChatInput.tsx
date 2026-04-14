import { useState, useRef, useCallback, useEffect, KeyboardEvent, DragEvent, ClipboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Mic, Paperclip } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmojiPickerButton } from "./input/EmojiPickerButton";
import { AIComposerButton } from "./input/AIComposerButton";
import { AudioRecorder } from "./input/AudioRecorder";
import { MacroSuggestions } from "./input/MacroSuggestions";
import { SmartReplySuggestions } from "./input/SmartReplySuggestions";
import { ReplyPreview } from "./input/ReplyPreview";
import { AttachmentChip } from "./input/AttachmentChip";
import { useWhatsAppMacros } from "../hooks/useWhatsAppMacros";
import { useSmartReply } from "../hooks/useSmartReply";
import { useWhatsAppSend } from "../hooks/useWhatsAppSend";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import type { Message } from "../hooks/useWhatsAppMessages";
import type { MediaSendParams } from "./input/types";
import { toast } from "sonner";

interface Props {
  conversationId: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  initialMessage?: string;
  disabled?: boolean;
}

function getMessageType(mimeType: string): MediaSendParams['messageType'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function ChatInput({ conversationId, replyTo, onCancelReply, initialMessage, disabled }: Props) {
  const [message, setMessage] = useState(initialMessage || "");
  const [isRecording, setIsRecording] = useState(false);
  const [showMacroSuggestions, setShowMacroSuggestions] = useState(false);
  const [filteredMacros, setFilteredMacros] = useState<any[]>([]);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendMutation = useWhatsAppSend();
  const { isBlocked: presenceBlocked } = useAgentPresence();
  const isBlocked = presenceBlocked || !!disabled;

  const { macros, incrementUsage } = useWhatsAppMacros();
  const { suggestions, isLoading: isLoadingSmartReplies, isRefreshing, refresh, error: smartReplyError } = useSmartReply(conversationId);

  useEffect(() => {
    const match = message.match(/\/macro:\s*(\S*)$/i);
    if (match) {
      const searchTerm = match[1].toLowerCase();
      const filtered = macros.filter(m =>
        (m.shortcut?.toLowerCase().includes(searchTerm)) ||
        m.title.toLowerCase().includes(searchTerm)
      );
      setFilteredMacros(filtered);
      setShowMacroSuggestions(filtered.length > 0);
    } else {
      setShowMacroSuggestions(false);
      setFilteredMacros([]);
    }
  }, [message, macros]);

  // Send attached file as media
  const sendAttachedFile = useCallback(async (file: File, caption?: string) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    if (sendMutation.isPending) return;

    const reader = new FileReader();
    const base64Data = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const messageType = getMessageType(file.type || 'application/octet-stream');

    sendMutation.mutate(
      {
        conversationId,
        content: caption || undefined,
        messageType,
        mediaBase64: base64Data,
        mediaMimetype: file.type || 'application/octet-stream',
        fileName: file.name,
      },
      {
        onSuccess: () => {
          setAttachedFile(null);
          setMessage("");
          onCancelReply?.();
          if (fileInputRef.current) fileInputRef.current.value = "";
          setTimeout(() => textareaRef.current?.focus(), 50);
        },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mídia"); },
      }
    );
  }, [isBlocked, sendMutation, conversationId, onCancelReply]);

  const handleSend = useCallback(() => {
    if (attachedFile) {
      sendAttachedFile(attachedFile, message.trim() || undefined);
      return;
    }
    // Normal text send
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    const content = message.trim();
    if (!content) return;

    setMessage("");
    onCancelReply?.();
    setTimeout(() => textareaRef.current?.focus(), 50);

    sendMutation.mutate(
      { conversationId, content, messageType: "text", quotedMessageId: replyTo?.message_id || undefined },
      {
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mensagem"); },
      }
    );
  }, [attachedFile, sendAttachedFile, message, isBlocked, sendMutation, conversationId, replyTo, onCancelReply]);

  const handleSendMedia = useCallback((params: MediaSendParams) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    sendMutation.mutate(
      { conversationId, content: params.content, messageType: params.messageType, mediaUrl: params.mediaUrl, mediaBase64: params.mediaBase64, mediaMimetype: params.mediaMimetype, fileName: params.fileName },
      {
        onSuccess: () => { setIsRecording(false); },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mídia"); },
      }
    );
  }, [conversationId, sendMutation]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Paste handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          setAttachedFile(file);
          return;
        }
      }
    }
  }, []);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) setAttachedFile(file);
  }, []);

  // File input handler
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setAttachedFile(file);
  }, []);

  const handleEmojiSelect = (emoji: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newText = message.substring(0, start) + emoji + message.substring(end);
    setMessage(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = start + emoji.length;
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleMacroSelect = (macro: any) => {
    setMessage(macro.content);
    incrementUsage(macro.id);
    setShowMacroSuggestions(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleSmartReplySelect = (text: string) => {
    setMessage(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  if (isRecording) {
    return (
      <div className="p-4 border-t border-border bg-card">
        <AudioRecorder
          onSend={(params) => { handleSendMedia(params); setIsRecording(false); }}
          onCancel={() => setIsRecording(false)}
        />
      </div>
    );
  }

  const hasContent = message.trim() || attachedFile;

  return (
    <div
      className="border-t border-border bg-card relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-primary/10 border-2 border-dashed border-primary rounded-md flex items-center justify-center pointer-events-none">
          <p className="text-sm font-medium text-primary">Solte o arquivo aqui</p>
        </div>
      )}

      {replyTo && onCancelReply && <ReplyPreview message={replyTo} onCancel={onCancelReply} />}

      <SmartReplySuggestions
        suggestions={suggestions}
        isLoading={isLoadingSmartReplies}
        isRefreshing={isRefreshing}
        error={smartReplyError}
        onSelectSuggestion={handleSmartReplySelect}
        onRefresh={refresh}
      />

      <div className="p-4">
        {isBlocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-center text-muted-foreground py-2 px-3 bg-muted/50 rounded-md mb-2 cursor-default">
                Você precisa estar ATIVO para atender.
              </div>
            </TooltipTrigger>
            <TooltipContent>Inicie seu expediente ou volte da pausa para enviar mensagens.</TooltipContent>
          </Tooltip>
        )}

        {/* Attachment chip */}
        {attachedFile && (
          <div className="mb-2">
            <AttachmentChip file={attachedFile} onRemove={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
          </div>
        )}

        <div className="relative flex gap-2 items-end">
          {showMacroSuggestions && <MacroSuggestions macros={filteredMacros} onSelect={handleMacroSelect} />}

          <EmojiPickerButton onEmojiSelect={handleEmojiSelect} disabled={sendMutation.isPending || isBlocked} />

          {/* File attach button */}
          <input ref={fileInputRef} type="file" accept="*/*" onChange={handleFileSelect} className="hidden" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendMutation.isPending || isBlocked}
            aria-label="Anexar arquivo"
          >
            <Paperclip className="w-5 h-5" />
          </Button>

          <AIComposerButton message={message} onComposed={(newMessage) => setMessage(newMessage)} disabled={sendMutation.isPending || isBlocked} />

          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isBlocked ? "Você precisa estar ATIVO para atender." : "Digite uma mensagem..."}
            className="min-h-[44px] max-h-32 resize-none"
            disabled={sendMutation.isPending || isBlocked}
          />

          {hasContent ? (
            <Button onClick={handleSend} size="icon" disabled={sendMutation.isPending || isBlocked}>
              <Send className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={() => setIsRecording(true)} size="icon" variant="outline" disabled={sendMutation.isPending || isBlocked}>
              <Mic className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Enter para enviar, Shift+Enter para nova linha</p>
      </div>
    </div>
  );
}
