import { cn } from "@/lib/utils";
import { Check, CheckCheck, ChevronDown, ChevronUp, Trash2, Forward, CheckSquare, EyeOff, Loader2, AlertCircle, RotateCcw, MoreVertical } from "lucide-react";
import { useState } from "react";
import type { Message } from "../hooks/useWhatsAppMessages";
import { MediaContent } from "./MediaContent";
import { ContactCard } from "./ContactCard";
import { useChatTimezone } from "@/hooks/useChatTimezone";
import { formatTime as formatTzTime } from "@/lib/formatDateWithTimezone";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  msg: Message;
  onReply?: (msg: Message) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (msgId: string) => void;
  onDeletePanelOnly?: (msgId: string) => void;
  onDeleteEveryone?: (msgId: string) => void;
  onRetryDelete?: (msgId: string) => void;
  onForward?: (msgId: string) => void;
  onEnterSelectionMode?: (msgId: string) => void;
}

function canDeletePanelOnly(msg: Message): boolean {
  if (msg.id.startsWith('temp-')) return false;
  const deleteStatus = (msg as any).delete_status;
  return !deleteStatus || deleteStatus === 'active' || deleteStatus === 'failed';
}

export function MessageBubble({
  msg,
  onReply,
  selectionMode,
  isSelected,
  onToggleSelect,
  onDeletePanelOnly,
  onDeleteEveryone,
  onRetryDelete,
  onForward,
  onEnterSelectionMode,
}: Props) {
  const isFromMe = Boolean(msg.isFromMe ?? msg.is_from_me ?? (msg as any).fromMe ?? (msg as any).key?.fromMe ?? false);
  const rawKind = (msg.message_type ?? (msg as any).messageType ?? (msg as any).type ?? 'text') as string;
  const isSystem = Boolean(
    msg.isSystem ?? (
      rawKind === 'system' ||
      rawKind === 'event' ||
      (msg as any).metadata?.system === true ||
      (msg as any).protocolMessage?.type === 'REVOKE' ||
      (msg as any).metadata?.protocolMessage?.type === 'REVOKE'
    )
  );

  const { timezone } = useChatTimezone();
  const time = formatTzTime(msg.timestamp, timezone);
  const [showTranscription, setShowTranscription] = useState(false);

  const deleteStatus = (msg as any).delete_status as string | undefined;
  const deleteScope = (msg as any).delete_scope as string | undefined;
  const isDeleted = msg.status === 'deleted' || deleteStatus === 'revoked' || msg.message_type === 'revoked';
  const isPending = deleteStatus === 'pending';
  const isFailed = deleteStatus === 'failed';

  const hasTranscription = msg.message_type === 'audio' && msg.audio_transcription;
  const isTranscribing = msg.message_type === 'audio' && msg.transcription_status === 'processing';

  if (isSystem) {
    return (
      <div className="flex w-full justify-center my-2">
        <span className="inline-flex items-center rounded-full bg-accent/50 px-3 py-1 text-[10px] text-accent-foreground">
          {msg.content?.trim() || 'Evento do sistema'}
        </span>
      </div>
    );
  }

  const statusIcon = isFromMe && !isDeleted && !isPending && (
    msg.status === "read" || msg.status === "delivered" ? (
      <CheckCheck className={cn("h-3 w-3", msg.status === "read" ? "text-blue-400" : "text-muted-foreground/60")} />
    ) : msg.status === "sending" ? (
      <Clock className="h-3 w-3 text-muted-foreground/40" />
    ) : (
      <Check className="h-3 w-3 text-muted-foreground/60" />
    )
  );

  // ─── PENDING state: "Apagando…" ───
  if (isPending) {
    return (
      <div className={cn("flex w-full mb-1", isFromMe ? "justify-end" : "justify-start")}>
        <div className={cn(
          "max-w-[75%] min-w-0 rounded-lg px-3 py-1.5 text-sm italic opacity-70",
          isFromMe
            ? "ml-auto bg-primary/30 text-primary-foreground/70 rounded-br-sm"
            : "mr-auto bg-muted/50 text-foreground/70 rounded-bl-sm"
        )}>
          <div className="flex items-center gap-1.5 min-w-0">
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            <p className="break-words whitespace-normal">Apagando mensagem…</p>
          </div>
          <div className={cn("flex items-center gap-1 mt-0.5", isFromMe ? "justify-end" : "justify-start")}>
            <span className="text-[10px] opacity-60">{time}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── REVOKED state: "Mensagem apagada" ───
  if (isDeleted) {
    return (
      <div className={cn("flex w-full mb-1", isFromMe ? "justify-end" : "justify-start")}>
        <div className={cn(
          "max-w-[75%] min-w-0 rounded-lg px-3 py-1.5 text-sm italic opacity-60",
          isFromMe
            ? "ml-auto bg-primary/30 text-primary-foreground/60 rounded-br-sm"
            : "mr-auto bg-muted/50 text-foreground/60 rounded-bl-sm"
        )}>
          <p className="break-words whitespace-normal">🚫 {deleteScope === 'local' ? 'Removida do painel' : 'Mensagem apagada'}</p>
          <div className={cn("flex items-center gap-1 mt-0.5", isFromMe ? "justify-end" : "justify-start")}>
            <span className="text-[10px] opacity-60">{time}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── FAILED state: show message + error hint ───
  if (isFailed) {
    return (
      <div className={cn("flex w-full mb-1", isFromMe ? "justify-end" : "justify-start")}>
        <div className={cn("flex flex-col gap-1 max-w-[75%] min-w-0", isFromMe ? "ml-auto items-end" : "mr-auto items-start")}>
          <div className={cn(
            "rounded-lg px-3 py-1.5 text-sm relative w-full min-w-0",
            isFromMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
          )}>
            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
            <div className={cn("flex items-center gap-1 mt-0.5", isFromMe ? "justify-end" : "justify-start")}>
              <span className="text-[10px] opacity-60">{time}</span>
              {statusIcon}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>Falha ao apagar para todos</span>
            <button
              onClick={() => onRetryDelete?.(msg.id)}
              className="flex items-center gap-0.5 underline hover:no-underline"
            >
              <RotateCcw className="h-3 w-3" />
              Tentar novamente
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              onClick={() => onDeletePanelOnly?.(msg.id)}
              className="underline hover:no-underline text-muted-foreground"
            >
              Remover do painel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bubbleContent = (
    <div
      className={cn(
        "max-w-[75%] min-w-0 rounded-lg px-3 py-1.5 text-sm relative",
        isFromMe
          ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
          : "mr-auto bg-muted text-foreground rounded-bl-sm"
      )}
    >
      {isFromMe && msg.sender_name && (
        <p className={cn(
          "text-[10px] font-semibold mb-0.5",
          isFromMe ? "text-primary-foreground/80" : "text-foreground/80"
        )}>
          {msg.sender_name}{msg.sender_role ? ` · ${msg.sender_role}` : ''}
        </p>
      )}

      {msg.quoted_message_id && (
        <div className={cn(
          "text-[10px] px-2 py-1 rounded mb-1 border-l-2",
          isFromMe ? "bg-primary-foreground/10 border-primary-foreground/30" : "bg-background/50 border-primary/30"
        )}>
          <span className="opacity-70">Mensagem citada</span>
        </div>
      )}

      {(msg.message_type === 'contact' || msg.message_type === 'contacts') && msg.metadata && (
        <ContactCard
          metadata={msg.metadata}
          messageType={msg.message_type}
          isFromMe={isFromMe}
          onStartConversation={(phone, name) => {
            // Open WhatsApp conversation with this number
            window.open(`https://wa.me/${phone}`, '_blank');
          }}
        />
      )}

      {msg.media_url && msg.message_type !== "text" && msg.message_type !== "contact" && msg.message_type !== "contacts" && (
        <div className="min-w-0">
          <MediaContent messageId={msg.id} messageType={msg.message_type} mediaUrl={msg.media_url} metadata={msg.metadata} mediaFilename={msg.media_filename} mediaExt={msg.media_ext} mediaSizeBytes={msg.media_size_bytes} mediaKind={msg.media_kind} mediaMimetype={msg.media_mimetype} />
        </div>
      )}
      {msg.content && msg.message_type !== 'contact' && msg.message_type !== 'contacts' && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}

      {hasTranscription && (
        <div className="mt-1 min-w-0">
          <button
            onClick={() => setShowTranscription(!showTranscription)}
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity",
              isFromMe ? "text-primary-foreground" : "text-foreground"
            )}
          >
            {showTranscription ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Transcrição
          </button>
          {showTranscription && (
            <p className={cn(
              "text-[11px] mt-0.5 whitespace-pre-wrap break-words italic opacity-80",
              isFromMe ? "text-primary-foreground" : "text-foreground"
            )}>
              {msg.audio_transcription}
            </p>
          )}
        </div>
      )}
      {isTranscribing && (
        <p className={cn("text-[10px] mt-0.5 italic opacity-50", isFromMe ? "text-primary-foreground" : "text-foreground")}>
          Transcrevendo áudio...
        </p>
      )}

      <div className={cn("flex items-center gap-1 mt-0.5", isFromMe ? "justify-end" : "justify-start")}>
        <span className="text-[10px] opacity-60">{time}</span>
        {statusIcon}
      </div>
    </div>
  );

  // Selection mode
  if (selectionMode) {
    return (
      <div
        className={cn(
          "flex w-full mb-1 items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-colors",
          isSelected ? "bg-accent/30" : "hover:bg-accent/10",
          isFromMe ? "justify-end" : "justify-start"
        )}
        onClick={() => onToggleSelect?.(msg.id)}
      >
        {isFromMe ? (
          <>
            {bubbleContent}
            <Checkbox checked={isSelected} className="shrink-0" />
          </>
        ) : (
          <>
            <Checkbox checked={isSelected} className="shrink-0" />
            {bubbleContent}
          </>
        )}
      </div>
    );
  }

  // Normal mode with context menu
  const handleDeleteEveryone = () => {
    if (!isFromMe) {
      toast.error("Só é possível apagar para todos mensagens enviadas por você.");
      return;
    }
    onDeleteEveryone?.(msg.id);
  };

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent/50 shrink-0">
          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isFromMe ? "end" : "start"} className="min-w-[180px]">
        {isFromMe && canDeletePanelOnly(msg) && (
          <DropdownMenuItem onClick={handleDeleteEveryone} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Apagar para todos (WhatsApp)
          </DropdownMenuItem>
        )}
        {canDeletePanelOnly(msg) && (
          <DropdownMenuItem onClick={() => onDeletePanelOnly?.(msg.id)}>
            <EyeOff className="h-4 w-4 mr-2" />
            Remover do painel
          </DropdownMenuItem>
        )}
        {canDeletePanelOnly(msg) && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => onForward?.(msg.id)}>
          <Forward className="h-4 w-4 mr-2" />
          Encaminhar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEnterSelectionMode?.(msg.id)}>
          <CheckSquare className="h-4 w-4 mr-2" />
          Selecionar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      className={cn("group flex w-full mb-1 items-end gap-0.5", isFromMe ? "justify-end" : "justify-start")}
      onDoubleClick={() => onReply?.(msg)}
    >
      {isFromMe && actionsMenu}
      {bubbleContent}
      {!isFromMe && actionsMenu}
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

