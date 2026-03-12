import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Mic } from "lucide-react";
import { EmojiPickerButton } from "./input/EmojiPickerButton";
import { MediaUploadButton } from "./input/MediaUploadButton";
import { AIComposerButton } from "./input/AIComposerButton";
import { AudioRecorder } from "./input/AudioRecorder";
import { MacroSuggestions } from "./input/MacroSuggestions";
import { SmartReplySuggestions } from "./input/SmartReplySuggestions";
import { ReplyPreview } from "./input/ReplyPreview";
import { useWhatsAppMacros } from "../hooks/useWhatsAppMacros";
import { useSmartReply } from "../hooks/useSmartReply";
import { useWhatsAppSend } from "../hooks/useWhatsAppSend";
import type { Message } from "../hooks/useWhatsAppMessages";
import type { MediaSendParams } from "./input/types";
import { toast } from "sonner";

interface Props {
  conversationId: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

export function ChatInput({ conversationId, replyTo, onCancelReply }: Props) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [showMacroSuggestions, setShowMacroSuggestions] = useState(false);
  const [filteredMacros, setFilteredMacros] = useState<any[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMutation = useWhatsAppSend();

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

  const handleSendText = useCallback(() => {
    const content = message.trim();
    if (!content || sendMutation.isPending) return;

    sendMutation.mutate(
      { conversationId, content, messageType: "text", quotedMessageId: replyTo?.message_id || undefined },
      {
        onSuccess: () => { setMessage(""); onCancelReply?.(); setTimeout(() => textareaRef.current?.focus(), 50); },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mensagem"); },
      }
    );
  }, [message, conversationId, sendMutation, replyTo, onCancelReply]);

  const handleSendMedia = useCallback((params: MediaSendParams) => {
    sendMutation.mutate(
      { conversationId, content: params.content, messageType: params.messageType, mediaUrl: params.mediaUrl, mediaBase64: params.mediaBase64, mediaMimetype: params.mediaMimetype, fileName: params.fileName },
      {
        onSuccess: () => { setIsRecording(false); },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mídia"); },
      }
    );
  }, [conversationId, sendMutation]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); }
  };

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

  return (
    <div className="border-t border-border bg-card">
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
        <div className="relative flex gap-2 items-end">
          {showMacroSuggestions && <MacroSuggestions macros={filteredMacros} onSelect={handleMacroSelect} />}

          <EmojiPickerButton onEmojiSelect={handleEmojiSelect} disabled={sendMutation.isPending} />
          <MediaUploadButton conversationId={conversationId} onSendMedia={handleSendMedia} disabled={sendMutation.isPending} />
          <AIComposerButton message={message} onComposed={(newMessage) => setMessage(newMessage)} disabled={sendMutation.isPending} />

          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma mensagem..."
            className="min-h-[44px] max-h-32 resize-none"
            disabled={sendMutation.isPending}
          />

          {message.trim() ? (
            <Button onClick={handleSendText} size="icon" disabled={sendMutation.isPending}>
              <Send className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={() => setIsRecording(true)} size="icon" variant="outline" disabled={sendMutation.isPending}>
              <Mic className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Enter para enviar, Shift+Enter para nova linha</p>
      </div>
    </div>
  );
}
