import { X } from "lucide-react";

/**
 * Toast de mensagem de chat, no estilo do WhatsApp: contato em cima, prévia
 * embaixo, clique em qualquer lugar abre a conversa.
 *
 * Existe como componente próprio porque o Sonner 1.7.4 não expõe onClick no
 * corpo do toast — só no botão de ação. Renderizado via `toast.custom()`.
 *
 * O contador vem do banco: process_notification_dispatch_queue coalesce as
 * mensagens seguidas da mesma conversa numa notificação só e incrementa
 * metadata.unread_count. Aqui isso vira "3 mensagens" no lugar da prévia — a
 * prévia de uma mensagem no meio de várias engana mais do que informa.
 */
export type ChatToastProps = {
  title: string;
  body: string;
  unreadCount?: number;
  onOpen: () => void;
  onDismiss: () => void;
};

export function ChatToast({ title, body, unreadCount, onOpen, onDismiss }: ChatToastProps) {
  const agrupado = (unreadCount ?? 1) > 1;

  return (
    <div className="relative flex w-full items-start gap-3 rounded-md border border-border bg-background p-4 pr-10 shadow-lg">
      <button
        type="button"
        data-testid="chat-toast-body"
        onClick={onOpen}
        className="flex-1 text-left transition-opacity hover:opacity-80"
      >
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {agrupado ? `${unreadCount} mensagens` : body}
        </p>
      </button>
      <button
        type="button"
        data-testid="chat-toast-close"
        aria-label="Dispensar"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default ChatToast;
