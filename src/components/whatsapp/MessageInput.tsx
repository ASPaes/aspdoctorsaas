import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2 } from "lucide-react";
import { useSendMessage } from "./hooks/useMessages";
import { useToast } from "@/hooks/use-toast";

interface Props {
  conversationId: string;
}

export function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const sendMutation = useSendMessage();

  const handleSend = useCallback(() => {
    const content = text.trim();
    if (!content || sendMutation.isPending) return;

    sendMutation.mutate(
      { conversationId, content },
      {
        onSuccess: () => {
          setText("");
          textareaRef.current?.focus();
        },
        onError: (err: any) => {
          toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
        },
      }
    );
  }, [text, conversationId, sendMutation, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-3">
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
  );
}
