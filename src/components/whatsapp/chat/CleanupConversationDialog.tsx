import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Trash2, Sparkles } from "lucide-react";
import { useWhatsAppMessages } from "../hooks/useWhatsAppMessages";

const REPETITION_WINDOW_MS = 5 * 60 * 1000;
const REPETITION_THRESHOLD = 3;

function normalizeContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function detectSuspiciousMessages(messages: any[]): Set<string> {
  const suspect = new Set<string>();
  if (!messages.length) return suspect;

  for (const m of messages) {
    if (
      m?.metadata?.ura === true ||
      m?.metadata?.business_hours === true ||
      m?.metadata?.outside_hours === true ||
      m?.metadata?.csat === true
    ) {
      suspect.add(m.id);
    }
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const content = (m.content ?? "").toString();
    if (!content || content.length < 5) continue;

    const normalized = normalizeContent(content);
    if (!normalized) continue;

    const ts = new Date(m.timestamp).getTime();
    let countInWindow = 0;
    const groupIds: string[] = [];

    for (let j = 0; j < sorted.length; j++) {
      const other = sorted[j];
      const otherTs = new Date(other.timestamp).getTime();
      if (Math.abs(otherTs - ts) > REPETITION_WINDOW_MS) continue;
      if (normalizeContent((other.content ?? "").toString()) === normalized) {
        countInWindow++;
        groupIds.push(other.id);
      }
    }

    if (countInWindow >= REPETITION_THRESHOLD) {
      for (const id of groupIds) suspect.add(id);
    }
  }

  return suspect;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  isDeleting: boolean;
  onConfirm: (messageIds: string[]) => void;
}

export function CleanupConversationDialog({ open, onOpenChange, conversationId, isDeleting, onConfirm }: Props) {
  const { messages } = useWhatsAppMessages(open ? conversationId : null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState("");
  const [didInitSelection, setDidInitSelection] = useState(false);

  const suspectIds = useMemo(() => detectSuspiciousMessages(messages), [messages]);

  const suspiciousMessages = useMemo(() => {
    return messages
      .filter((m: any) => suspectIds.has(m.id))
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, suspectIds]);

  useEffect(() => {
    if (open && !didInitSelection && suspiciousMessages.length > 0) {
      setSelectedIds(new Set(suspiciousMessages.map((m: any) => m.id)));
      setDidInitSelection(true);
    }
  }, [open, didInitSelection, suspiciousMessages]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setConfirmText("");
      setDidInitSelection(false);
    }
  }, [open]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === suspiciousMessages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(suspiciousMessages.map((m: any) => m.id)));
    }
  };

  const totalMessages = messages.length;
  const selectedCount = selectedIds.size;
  const allSelected = suspiciousMessages.length > 0 && selectedCount === suspiciousMessages.length;

  const canConfirm = confirmText === "EXCLUIR" && selectedCount > 0 && !isDeleting;

  const handleSubmit = () => {
    if (!canConfirm) return;
    onConfirm(Array.from(selectedIds));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Limpar mensagens da briga de URA
          </DialogTitle>
          <DialogDescription>
            Detectamos mensagens suspeitas de briga de URA por dois critérios: marcadores internos do sistema e conteúdo idêntico repetido em sequência. Revise a lista — você pode desmarcar mensagens que não são da briga.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1">
          {suspiciousMessages.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Nenhuma mensagem suspeita encontrada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Não detectamos repetições suspeitas nem mensagens com marcadores de URA nesta conversa.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-3">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">
                    {suspiciousMessages.length} mensagens suspeitas detectadas
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    de {totalMessages} mensagens totais na conversa.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    Selecionadas:{" "}
                    <span className={selectedCount > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                      {selectedCount}
                    </span>{" "}
                    de {suspiciousMessages.length}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                    {allSelected ? "Desmarcar todas" : "Marcar todas"}
                  </Button>
                </div>

                <ScrollArea className="h-64 rounded-md border border-border">
                  <div className="p-2 space-y-1">
                    {suspiciousMessages.map((m: any) => (
                      <div
                        key={m.id}
                        className="flex items-start gap-2 rounded-sm p-2 text-xs hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedIds.has(m.id)}
                          onCheckedChange={() => toggleId(m.id)}
                          className="mt-0.5"
                        />
                        <span className="font-mono text-muted-foreground shrink-0">
                          {new Date(m.timestamp).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {m.is_from_me ? "→" : "←"}
                        </span>
                        <span className="truncate">
                          {(m.content || "(sem conteúdo)").substring(0, 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-destructive">Ação irreversível</p>
                    <p className="text-xs text-muted-foreground mt-1">
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
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={!canConfirm}>
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? "Excluindo..." : `Excluir ${selectedCount} mensagem(ns)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
