import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

interface AttendanceLite {
  id: string;
  attendance_code: string | number | null;
  conversation_id: string;
  opened_at: string;
  closed_at: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  attendance: AttendanceLite | null;
}

interface Msg {
  id?: string;
  content: string | null;
  timestamp: string;
  is_from_me: boolean;
  sender_name: string | null;
  message_type: string | null;
  audio_transcription: string | null;
}

function mediaPlaceholder(m: Msg): string | null {
  const t = (m.message_type || "").toLowerCase();
  if (m.content && m.content.trim()) return null;
  if (t.includes("image")) return "📷 Imagem";
  if (t.includes("audio") || t.includes("voice") || t.includes("ptt")) {
    return m.audio_transcription ? `🎤 Áudio: ${m.audio_transcription}` : "🎤 Áudio";
  }
  if (t.includes("video")) return "🎬 Vídeo";
  if (t.includes("document") || t.includes("file")) return "📎 Documento";
  if (t.includes("sticker")) return "🌟 Sticker";
  if (t.includes("location")) return "📍 Localização";
  if (t.includes("contact") || t.includes("vcard")) return "👤 Contato";
  return null;
}

export function AttendanceMessagesDialog({ open, onOpenChange, attendance }: Props) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ["attendance-messages", attendance?.id],
    enabled: open && !!attendance?.id,
    queryFn: async () => {
      const end = attendance!.closed_at ?? new Date().toISOString();
      const { data, error } = await (supabase.from("whatsapp_messages" as any) as any)
        .select("id, content, timestamp, is_from_me, sender_name, message_type, audio_transcription")
        .eq("conversation_id", attendance!.conversation_id)
        .gte("timestamp", attendance!.opened_at)
        .lte("timestamp", end)
        .order("timestamp", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data || []) as Msg[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Atendimento #{attendance?.attendance_code ?? "—"}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh] pr-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando mensagens...
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
              Nenhuma mensagem encontrada no período.
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {messages.map((m, idx) => {
                const placeholder = mediaPlaceholder(m);
                const text = m.content?.trim() || placeholder || "—";
                const time = m.timestamp ? format(new Date(m.timestamp), "HH:mm") : "";
                return (
                  <div
                    key={m.id ?? idx}
                    className={`flex ${m.is_from_me ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 ${
                        m.is_from_me ? "bg-primary/10" : "bg-muted"
                      }`}
                    >
                      {m.sender_name && (
                        <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
                          {m.sender_name}
                        </p>
                      )}
                      <p className="text-xs whitespace-pre-wrap break-words">{text}</p>
                      <p className="text-[10px] text-muted-foreground text-right mt-1">{time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
