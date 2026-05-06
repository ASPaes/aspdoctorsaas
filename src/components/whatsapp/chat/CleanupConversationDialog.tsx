import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Trash2, Sparkles, Info } from "lucide-react";
import { useWhatsAppMessages } from "../hooks/useWhatsAppMessages";

// Snippets específicos de auto-resposta nossa (frases com alta especificidade — não genéricas)
const OUR_AUTO_REPLY_SNIPPETS = [
  "Recebemos sua mensagem",
  "Sua mensagem foi recebida",
  "Estamos encaminhando, aguarde",
  "Percebemos que você tentou algumas vezes sem sucesso",
];

// Snippets de bots/URAs de terceiros (frases típicas de menu/erro de bot)
const THIRD_PARTY_BOT_SNIPPETS = [
  "assistente virtual",
  "Digite o número",
  "Por favor, envie apenas o número de uma das opções",
  "Não entendi sua resposta",
];

// Detector de candidato individual (somente sinais fortes — sem heurística de conteúdo vazio)
function isAutoCandidate(msg: any): boolean {
  if (msg?.metadata?.ura === true) return true;
  if (msg?.metadata?.business_hours === true) return true;
  if (msg?.metadata?.outside_hours === true) return true;
  if (msg?.metadata?.csat === true) return true;

  const content = (msg?.content ?? "").toString();
  if (!content) return false;

  if (msg?.is_from_me && OUR_AUTO_REPLY_SNIPPETS.some((s) => content.includes(s))) return true;

  if (!msg?.is_from_me) {
    const lower = content.toLowerCase();
    if (THIRD_PARTY_BOT_SNIPPETS.some((s) => lower.includes(s.toLowerCase()))) return true;
  }

  return false;
}

// Detecta a primeira RAJADA de auto-respostas (>= 3 candidatos em janela de 3 min)
// Retorna o timestamp da primeira mensagem da rajada, ou null se não houver rajada.
function detectUraBurst(messages: any[]): { cutoffTimestamp: string | null; burstSize: number } {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const BURST_WINDOW_MS = 3 * 60 * 1000;
  const MIN_BURST_SIZE = 3;

  for (let i = 0; i < sorted.length; i++) {
    if (!isAutoCandidate(sorted[i])) continue;
    const windowStart = new Date(sorted[i].timestamp).getTime();
    const windowEnd = windowStart + BURST_WINDOW_MS;

    let burstCount = 0;
    for (let j = i; j < sorted.length; j++) {
      const ts = new Date(sorted[j].timestamp).getTime();
      if (ts > windowEnd) break;
      if (isAutoCandidate(sorted[j])) burstCount++;
    }

    if (burstCount >= MIN_BURST_SIZE) {
      return { cutoffTimestamp: sorted[i].timestamp, burstSize: burstCount };
    }
  }

  return { cutoffTimestamp: null, burstSize: 0 };
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

  const detected = useMemo(() => detectUraBurst(messages), [messages]);

  useEffect(() => {
    if (open && detected.cutoffTimestamp && !cutoff) {
      setCutoff(formatLocalDateTimeForInput(new Date(detected.cutoffTimestamp)));
    }
  }, [open, detected.cutoffTimestamp, cutoff]);

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
    return messages
      .filter((m: any) => new Date(m.timestamp).getTime() >= cutoffMs)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, cutoffDate]);

  const totalMessages = messages.length;
  const isLargeDeletion = messagesToDelete.length > 50;
  const isSuspiciousDeletion = totalMessages > 0 && messagesToDelete.length / totalMessages > 0.3;

  const canConfirm = confirmText === "EXCLUIR" && messagesToDelete.length > 0 && !isCleaning;

  const handleApplyDetected = () => {
    if (detected.cutoffTimestamp) {
      setCutoff(formatLocalDateTimeForInput(new Date(detected.cutoffTimestamp)));
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
          {detected.cutoffTimestamp ? (
            <div className="flex items-start gap-2 p-3 rounded-md border border-primary/30 bg-primary/5">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Rajada de URA detectada</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Encontramos {detected.burstSize} mensagens automáticas em sequência a partir de{" "}
                  <span className="font-medium text-foreground">
                    {new Date(detected.cutoffTimestamp).toLocaleString("pt-BR")}
                  </span>.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleApplyDetected} className="shrink-0">
                Aplicar
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 rounded-md border border-muted bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Nenhuma rajada detectada automaticamente</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Não encontramos uma sequência clara de mensagens automáticas. Defina manualmente o horário de corte abaixo.
                </p>
              </div>
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
              {totalMessages > 0 && (
                <span className="text-muted-foreground"> de {totalMessages} totais</span>
              )}
            </p>
            <ScrollArea className="h-40 rounded-md border p-2">
              <div className="space-y-1">
                {!cutoffDate ? (
                  <p className="text-xs text-muted-foreground">Selecione um horário acima para visualizar.</p>
                ) : messagesToDelete.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma mensagem no intervalo selecionado.</p>
                ) : (
                  messagesToDelete.map((m: any) => (
                    <div key={m.id} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {new Date(m.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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

          {isSuspiciousDeletion && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium">
                  Atenção: você está prestes a excluir mais de 30% do histórico
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verifique se o horário de corte está correto. Excluir mensagens reais é irreversível.
                </p>
              </div>
            </div>
          )}

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
            {isCleaning ? "Excluindo..." : `Excluir ${messagesToDelete.length} ${isLargeDeletion ? "mensagens (!)" : "mensagem(ns)"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
