import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Paperclip, Smile, X } from "lucide-react";
import { useWhatsAppSend } from "../hooks/useWhatsAppSend";
import { toast } from "sonner";
import type { Message } from "../hooks/useWhatsAppMessages";
import { cn } from "@/lib/utils";

interface Props {
  conversationId: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

export function ChatInput({ conversationId, replyTo, onCancelReply }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMutation = useWhatsAppSend();

  const handleSend = useCallback(() => {
    const content = text.trim();
    if (!content || sendMutation.isPending) return;

    sendMutation.mutate(
      {
        conversationId,
        content,
        messageType: "text",
        quotedMessageId: replyTo?.message_id || undefined,
      },
      {
        onSuccess: () => {
          setText("");
          onCancelReply?.();
          textareaRef.current?.focus();
        },
        onError: (err: any) => {
          toast.error(err.message || "Erro ao enviar mensagem");
        },
      }
    );
  }, [text, conversationId, sendMutation, replyTo, onCancelReply]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-background">
      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 pt-2 flex items-center gap-2">
          <div className="flex-1 bg-muted rounded-md px-3 py-1.5 text-xs border-l-2 border-primary truncate">
            <span className="font-medium">{replyTo.is_from_me ? "Você" : "Contato"}: </span>
            <span className="text-muted-foreground">{replyTo.content || `[${replyTo.message_type}]`}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onCancelReply}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma mensagem..."
            className="min-h-[40px] max-h-[120px] resize-none"
            rows={1}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            className="shrink-0"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
