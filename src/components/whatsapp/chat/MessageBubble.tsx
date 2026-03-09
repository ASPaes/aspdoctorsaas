import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Check, CheckCheck } from "lucide-react";
import type { Message } from "../hooks/useWhatsAppMessages";
import { MediaContent } from "./MediaContent";

interface Props {
  msg: Message;
  onReply?: (msg: Message) => void;
}

export function MessageBubble({ msg, onReply }: Props) {
  const isMe = msg.is_from_me;
  const time = (() => {
    try { return format(new Date(msg.timestamp), "HH:mm"); } catch { return ""; }
  })();

  const statusIcon = isMe && (
    msg.status === "read" || msg.status === "delivered" ? (
      <CheckCheck className={cn("h-3 w-3", msg.status === "read" ? "text-blue-400" : "text-muted-foreground/60")} />
    ) : msg.status === "sending" ? (
      <Clock className="h-3 w-3 text-muted-foreground/40" />
    ) : (
      <Check className="h-3 w-3 text-muted-foreground/60" />
    )
  );

  return (
    <div
      className={cn("flex mb-1 group", isMe ? "justify-end" : "justify-start")}
      onDoubleClick={() => onReply?.(msg)}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-1.5 text-sm relative",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        {msg.quoted_message_id && (
          <div className={cn(
            "text-[10px] px-2 py-1 rounded mb-1 border-l-2",
            isMe ? "bg-primary-foreground/10 border-primary-foreground/30" : "bg-background/50 border-primary/30"
          )}>
            <span className="opacity-70">Mensagem citada</span>
          </div>
        )}

        {msg.media_url && msg.message_type !== "text" && (
          <MediaContent messageType={msg.message_type} mediaUrl={msg.media_url} metadata={msg.metadata} />
        )}
        {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        <div className={cn("flex items-center gap-1 mt-0.5", isMe ? "justify-end" : "justify-start")}>
          <span className="text-[10px] opacity-60">{time}</span>
          {statusIcon}
        </div>
      </div>
    </div>
  );
}

function Clock(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
