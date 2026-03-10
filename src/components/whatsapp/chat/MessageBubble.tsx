import { cn } from "@/lib/utils";
import { Check, CheckCheck, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { Message } from "../hooks/useWhatsAppMessages";
import { MediaContent } from "./MediaContent";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatTime as formatTzTime } from "@/lib/formatDateWithTimezone";

interface Props {
  msg: Message;
  onReply?: (msg: Message) => void;
}

export function MessageBubble({ msg, onReply }: Props) {
  const isMe = msg.is_from_me;
  const { timezone } = useChatTimezone();
  const time = formatTzTime(msg.timestamp, timezone);
  const [showTranscription, setShowTranscription] = useState(false);

  const hasTranscription = msg.message_type === 'audio' && msg.audio_transcription;
  const isTranscribing = msg.message_type === 'audio' && msg.transcription_status === 'processing';

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
        {isMe && msg.sender_name && (
          <p className={cn(
            "text-[10px] font-semibold mb-0.5",
            isMe ? "text-primary-foreground/80" : "text-foreground/80"
          )}>
            {msg.sender_name}{msg.sender_role ? ` · ${msg.sender_role}` : ''}
          </p>
        )}

        {msg.quoted_message_id && (
          <div className={cn(
            "text-[10px] px-2 py-1 rounded mb-1 border-l-2",
            isMe ? "bg-primary-foreground/10 border-primary-foreground/30" : "bg-background/50 border-primary/30"
          )}>
            <span className="opacity-70">Mensagem citada</span>
          </div>
        )}

        {msg.media_url && msg.message_type !== "text" && (
          <MediaContent messageId={msg.id} messageType={msg.message_type} mediaUrl={msg.media_url} metadata={msg.metadata} mediaFilename={(msg as any).media_filename} mediaExt={(msg as any).media_ext} mediaSizeBytes={(msg as any).media_size_bytes} mediaKind={(msg as any).media_kind} mediaMimetype={msg.media_mimetype} />
        )}
        {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}

        {/* Audio transcription */}
        {hasTranscription && (
          <div className="mt-1">
            <button
              onClick={() => setShowTranscription(!showTranscription)}
              className={cn(
                "flex items-center gap-1 text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity",
                isMe ? "text-primary-foreground" : "text-foreground"
              )}
            >
              {showTranscription ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Transcrição
            </button>
            {showTranscription && (
              <p className={cn(
                "text-[11px] mt-0.5 whitespace-pre-wrap break-words italic opacity-80",
                isMe ? "text-primary-foreground" : "text-foreground"
              )}>
                {msg.audio_transcription}
              </p>
            )}
          </div>
        )}
        {isTranscribing && (
          <p className={cn("text-[10px] mt-0.5 italic opacity-50", isMe ? "text-primary-foreground" : "text-foreground")}>
            Transcrevendo áudio...
          </p>
        )}

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
