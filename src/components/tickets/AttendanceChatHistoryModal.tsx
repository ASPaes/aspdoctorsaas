import { useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MediaContent } from "@/components/whatsapp/chat/MediaContent";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  attendanceCode: string;
  contactName?: string;
  openedAt: string | null;
  closedAt: string | null;
}

const mediaLabels: Record<string, string> = {
  image: "📷 Imagem",
  audio: "🎵 Áudio",
  video: "🎬 Vídeo",
  document: "📎 Documento",
  sticker: "🏷️ Sticker",
};

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function AttendanceChatHistoryModal({
  open,
  onOpenChange,
  conversationId,
  attendanceCode,
  contactName,
  openedAt,
  closedAt,
}: Props) {
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["attendance_chat_history", conversationId, openedAt, closedAt],
    enabled: !!conversationId && open,
    queryFn: async () => {
      let q = (supabase.from("whatsapp_messages" as any) as any)
        .select(
          "id, content, audio_transcription, is_from_me, sender_name, sender_role, message_type, media_kind, media_url, media_path, media_filename, media_ext, media_size_bytes, media_mimetype, timestamp, deleted_at"
        )
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("timestamp", { ascending: true });
      if (openedAt) q = q.gte("timestamp", openedAt);
      if (closedAt) {
        const closedPlus = new Date(
          new Date(closedAt).getTime() + 5 * 60000
        ).toISOString();
        q = q.lte("timestamp", closedPlus);
      }
      q = q.limit(500);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [open, messages.length]);

  const items = useMemo(() => {
    const result: Array<
      | { type: "date"; key: string; label: string }
      | {
          type: "msg";
          key: string;
          msg: any;
          showSender: boolean;
          tightTop: boolean;
        }
    > = [];
    let lastDay = "";
    let lastSender: string | null = null;
    let lastIsFromMe: boolean | null = null;
    for (const msg of messages) {
      const dk = dayKey(msg.timestamp);
      if (dk !== lastDay) {
        result.push({
          type: "date",
          key: `d-${dk}`,
          label: formatDateLabel(msg.timestamp),
        });
        lastDay = dk;
        lastSender = null;
        lastIsFromMe = null;
      }
      const isSystem =
        msg.message_type === "system" ||
        (!msg.sender_name && !msg.is_from_me && !msg.content?.trim());
      const senderKey = isSystem
        ? "__sys__"
        : `${msg.is_from_me ? "me" : "them"}::${msg.sender_name ?? ""}`;
      const sameAsPrev =
        !isSystem &&
        lastSender === senderKey &&
        lastIsFromMe === msg.is_from_me;
      result.push({
        type: "msg",
        key: msg.id,
        msg,
        showSender: !sameAsPrev && !isSystem && !!msg.sender_name,
        tightTop: sameAsPrev,
      });
      lastSender = isSystem ? null : senderKey;
      lastIsFromMe = isSystem ? null : msg.is_from_me;
    }
    return result;
  }, [messages]);

  const header = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold">Histórico do atendimento</span>
        <Badge variant="secondary" className="shrink-0">
          {messages.length} {messages.length === 1 ? "mensagem" : "mensagens"}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
        <span className="font-mono text-primary">{attendanceCode}</span>
        {contactName && (
          <>
            <span>•</span>
            <span className="truncate">{contactName}</span>
          </>
        )}
      </div>
    </div>
  );

  const body = (
    <ScrollArea className="h-[70vh] bg-background rounded-md border border-border/50">
      <div ref={scrollRef} className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            Nenhuma mensagem encontrada neste período
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((item) => {
              if (item.type === "date") {
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 my-3"
                  >
                    <div className="flex-1 border-t border-border/50" />
                    <span className="text-[10px] text-muted-foreground">
                      {item.label}
                    </span>
                    <div className="flex-1 border-t border-border/50" />
                  </div>
                );
              }
              const { msg, showSender, tightTop } = item;
              const hasMedia =
                (msg.message_type === "image" ||
                  msg.message_type === "audio" ||
                  msg.message_type === "video" ||
                  msg.message_type === "document") &&
                !!msg.media_url;
              const isSystem =
                msg.message_type === "system" ||
                (!msg.sender_name && !msg.is_from_me && !msg.content?.trim() && !hasMedia);
              const isClient = !msg.is_from_me;
              const textContent = msg.content || "";

              if (isSystem) {
                return (
                  <div
                    key={item.key}
                    className={cn(
                      "flex justify-center",
                      tightTop ? "mt-0.5" : "mt-1.5"
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground italic bg-muted/30 px-3 py-1 rounded-full max-w-[80%] text-center">
                      {textContent || "—"}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={item.key}
                  className={cn(
                    "flex flex-col",
                    isClient ? "items-start" : "items-end",
                    tightTop ? "mt-0.5" : "mt-1.5"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] p-2.5 rounded-lg",
                      isClient
                        ? "bg-muted/50 rounded-tl-sm"
                        : "bg-primary/10 rounded-tr-sm ml-auto"
                    )}
                  >
                    {showSender && msg.sender_name && (
                      <div
                        className={cn(
                          "text-[11px] font-medium mb-0.5 flex items-center gap-1",
                          isClient ? "text-primary" : "text-foreground"
                        )}
                      >
                        <span>{msg.sender_name}</span>
                        {!isClient && msg.sender_role && (
                          <Badge
                            variant="outline"
                            className="h-3.5 px-1 text-[9px] font-normal"
                          >
                            {msg.sender_role}
                          </Badge>
                        )}
                      </div>
                    )}
                    {hasMedia && (
                      <div className="mb-1">
                        <MediaContent
                          messageId={msg.id}
                          messageType={msg.message_type}
                          mediaUrl={msg.media_url}
                          mediaFilename={msg.media_filename}
                          mediaExt={msg.media_ext}
                          mediaSizeBytes={msg.media_size_bytes}
                          mediaKind={msg.media_kind}
                          mediaMimetype={msg.media_mimetype}
                        />
                      </div>
                    )}
                    {msg.message_type === "audio" && msg.audio_transcription && (
                      <div className="text-xs italic text-muted-foreground mt-1">
                        💬 {msg.audio_transcription}
                      </div>
                    )}
                    {textContent && textContent.trim() && msg.message_type !== "audio" && (
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {textContent}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground text-right mt-1">
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] flex flex-col p-4 gap-3">
          <SheetHeader>
            <SheetTitle asChild>
              <div>{header}</div>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle asChild>
            <div>{header}</div>
          </DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

export default AttendanceChatHistoryModal;
