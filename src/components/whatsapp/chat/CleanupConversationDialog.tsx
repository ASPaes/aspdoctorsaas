import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Trash2, Sparkles } from "lucide-react";
import { useWhatsAppMessages } from "../hooks/useWhatsAppMessages";

const KNOWN_SYSTEM_AUTO_REPLY_SNIPPETS = [
  "Recebemos sua mensagem",
  "Sua mensagem foi recebida",
  "vai te chamar",
  "encerrar este atendimento",
];

const URA_KEYWORDS = [
  "assistente virtual",
  "menu de atendimento",
  "Digite o número",
  "selecione uma opção",
  "para falar com",
  "muito prazer",
  "olá! tudo bem",
];

function isLikelyAutoReply(msg: any): boolean {
  if (msg?.metadata?.ura === true) return true;
  if (msg?.metadata?.business_hours === true) return true;
  if (msg?.metadata?.outside_hours === true) return true;
  if (msg?.metadata?.csat === true) return true;
  const content = (msg?.content ?? "").toString();
  if (msg?.is_from_me && KNOWN_SYSTEM_AUTO_REPLY_SNIPPETS.some((s) => content.includes(s))) return true;
  if (!msg?.is_from_me) {
    const lower = content.toLowerCase();
    if (URA_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return true;
  }
  if (!content || content.trim() === "") return true;
  return false;
}

function formatLocalDateTimeForInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  isCleaning: boolean;
  onConfirm: (cutoffIso: string) => void;
}

export function CleanupConversationDialog({ open, onOpenChange, conversationId, isCleaning, onConfirm }: Props) {
  const { messages } = useWhatsAppMessages(open ? conversationId : null);
  const [cutoff, setCutoff] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const detectedFirstAutoReplyTs = useMemo(() => {
    const sorted = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let firstSuspect: string | null = null;
    for (let i = 0; i < sorted.length; i++) {
      if (isLikelyAutoReply(sorted[i])) {
        let last = i;
        for (let j = i + 1; j < Math.min(i + 5, sorted.length); j++) {
          if (isLikelyAutoReply(sorted[j])) last = j;
        }
        if ((last - i) >= 1) {
          firstSuspect = sorted[i].timestamp;
          break;
        }
        if (!firstSuspect) firstSuspect = sorted[i].timestamp;
      }
    }
    return firstSuspect;
  }, [messages]);

  useEffect(() => {
    if (open && detectedFirstAutoReplyTs && !cutoff) {
      const d = new Date(detectedFirstAutoReplyTs);
      setCutoff(formatLocalDateTimeForInput(d));
    }
  }, [open, detectedFirstAutoReplyTs, cutoff]);

  useEffect(() => {
    if (!open) {
      setCutoff("");
      setConfirmText("");
    }
  }, [open]);

  const cutoffDate = cutoff ? new Date(cutoff) : null;
  const messagesToDelete = useMemo(() => {
    if (!cutoffDate) return [];
    const cutoffMs = cutoffDate.getTime();
    return messages.filter((m) => new Date(m.timestamp).getTime() >= cutoffMs);
  }, [messages, cutoffDate]);

  const canConfirm = confirmText === "EXCLUIR" && messagesToDelete.length > 0 && !isCleaning;

  const handleApplyDetected = () => {
    if (detectedFirstAutoReplyTs) {
      setCutoff(formatLocalDateTimeForInput(new Date(detectedFirstAutoReplyTs)));
    }
  };

  const handleSubmit = () => {
    if (!canConfirm || !cutoffDate) return;
    onConfirm(cutoffDate.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Limpar mensagens da briga de URA
          </DialogTitle>
          <DialogDescription>
            As mensagens excluídas a partir do horário escolhido serão apagadas permanentemente. Mensagens anteriores ao corte permanecem intactas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {detectedFirstAutoReplyTs && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-primary/30 bg-primary/5">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Detecção automática</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A primeira mensagem suspeita de briga de URA foi em{" "}
                  <span className="font-medium text-foreground">
                    {new Date(detectedFirstAutoReplyTs).toLocaleString("pt-BR")}
                  </span>.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleApplyDetected} className="shrink-0">
                Aplicar
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cutoff">Excluir mensagens a partir de:</Label>
            <Input
              id="cutoff"
              type="datetime-local"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs">
              Mensagens que serão excluídas:{" "}
              <span className={messagesToDelete.length > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                {messagesToDelete.length}
              </span>
            </p>
            <ScrollArea className="h-40 rounded-md border p-2">
              <div className="space-y-1">
                {messagesToDelete.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma mensagem no intervalo selecionado.</p>
                ) : (
                  messagesToDelete.map((m: any) => (
                    <div key={m.id} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {m.is_from_me ? "→" : "←"}
                      </span>
                      <span className="truncate">
                        {(m.content || "(sem conteúdo)").substring(0, 80)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2 p-3 rounded-md border border-destructive/30 bg-destructive/5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium">Ação irreversível</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Para confirmar, digite <span className="font-mono font-semibold">EXCLUIR</span> abaixo.
                </p>
              </div>
            </div>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              className="text-sm font-mono"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isCleaning}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={!canConfirm}>
            <Trash2 className="h-4 w-4 mr-2" />
            {isCleaning ? "Excluindo..." : `Excluir ${messagesToDelete.length} mensagem(ns)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
