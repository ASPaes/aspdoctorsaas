import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Trash2, Sparkles, Filter, Volume2 } from "lucide-react";
import { useWhatsAppMessages } from "../hooks/useWhatsAppMessages";

// Tunables
const REPETITION_LOCAL_WINDOW_MS = 5 * 60 * 1000;
const REPETITION_LOCAL_THRESHOLD = 3;
const REPETITION_GLOBAL_THRESHOLD = 5;
const URA_BATTLE_WINDOW_MS = 2 * 60 * 1000;
const URA_BATTLE_MIN_COUNT = 5;

const SIGNED_MESSAGE_REGEX = /^\*[^*\n]+:\*/;

function normalizeContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

// Mensagens que NUNCA devem ser marcadas como suspeitas (proteção)
function isProtectedMessage(msg: any): boolean {
  const content = (msg?.content ?? "").toString();
  if (SIGNED_MESSAGE_REGEX.test(content)) return true;
  if (msg?.metadata?.system === true) return true;
  if (msg?.metadata?.attendance_event) return true;
  return false;
}

// Detecta TODAS as mensagens suspeitas em uma única passada
function detectSuspiciousMessages(messages: any[]): Set<string> {
  const suspect = new Set<string>();
  if (!messages.length) return suspect;

  const isProtected = (m: any) => isProtectedMessage(m);

  // Regra 1: metadata flags explícitas
  for (const m of messages) {
    if (isProtected(m)) continue;
    if (
      m?.metadata?.ura === true ||
      m?.metadata?.business_hours === true ||
      m?.metadata?.outside_hours === true ||
      m?.metadata?.csat === true
    ) {
      suspect.add(m.id);
    }
  }

  // Regra 2: placeholder literal "Mensagem"
  for (const m of messages) {
    if (isProtected(m)) continue;
    const c = (m.content ?? "").toString().trim();
    if (c === "Mensagem") suspect.add(m.id);
  }

  // Regra 3: repetição global — mesmo conteúdo aparecendo >= 5x em toda a conversa
  const contentCounts = new Map<string, string[]>();
  for (const m of messages) {
    if (isProtected(m)) continue;
    const c = (m.content ?? "").toString();
    if (!c || c.length < 5) continue;
    const norm = normalizeContent(c);
    if (!norm) continue;
    if (!contentCounts.has(norm)) contentCounts.set(norm, []);
    contentCounts.get(norm)!.push(m.id);
  }
  for (const [, ids] of contentCounts) {
    if (ids.length >= REPETITION_GLOBAL_THRESHOLD) {
      for (const id of ids) suspect.add(id);
    }
  }

  // Regra 4: rajada local — 3+ idênticas em 5min
  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (isProtected(m)) continue;
    const content = (m.content ?? "").toString();
    if (!content || content.length < 5) continue;
    const normalized = normalizeContent(content);
    if (!normalized) continue;

    const ts = new Date(m.timestamp).getTime();
    const groupIds: string[] = [];
    for (let j = 0; j < sorted.length; j++) {
      const other = sorted[j];
      if (isProtected(other)) continue;
      const otherTs = new Date(other.timestamp).getTime();
      if (Math.abs(otherTs - ts) > REPETITION_LOCAL_WINDOW_MS) continue;
      if (normalizeContent((other.content ?? "").toString()) === normalized) {
        groupIds.push(other.id);
      }
    }
    if (groupIds.length >= REPETITION_LOCAL_THRESHOLD) {
      for (const id of groupIds) suspect.add(id);
    }
  }

  return suspect;
}

// Detecta IDs que fazem parte de "briga de URA"
function detectUraBattleIds(messages: any[], suspectIds: Set<string>): Set<string> {
  const battleIds = new Set<string>();
  if (!suspectIds.size) return battleIds;

  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (!suspectIds.has(m.id)) continue;
    const ts = new Date(m.timestamp).getTime();

    const windowMessages: any[] = [];
    for (let j = 0; j < sorted.length; j++) {
      const other = sorted[j];
      const otherTs = new Date(other.timestamp).getTime();
      if (Math.abs(otherTs - ts) > URA_BATTLE_WINDOW_MS) continue;
      if (suspectIds.has(other.id)) windowMessages.push(other);
    }

    if (windowMessages.length < URA_BATTLE_MIN_COUNT) continue;

    const hasFromMe = windowMessages.some((w) => w.is_from_me === true);
    const hasFromContact = windowMessages.some((w) => w.is_from_me === false);
    if (!hasFromMe || !hasFromContact) continue;

    const counts = new Map<string, number>();
    for (const w of windowMessages) {
      const c = (w.content ?? "").toString();
      if (!c) continue;
      const norm = normalizeContent(c);
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
    const hasRepetition = Array.from(counts.values()).some((n) => n >= 2);
    if (!hasRepetition) continue;

    for (const w of windowMessages) battleIds.add(w.id);
  }

  return battleIds;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  isDeleting: boolean;
  onConfirm: (messageIds: string[]) => void;
  isResuming: boolean;
  onResume: () => void;
}

export function CleanupConversationDialog({ open, onOpenChange, conversationId, isDeleting, onConfirm, isResuming, onResume }: Props) {
  const { messages } = useWhatsAppMessages(open ? conversationId : null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState("");
  const [didInitSelection, setDidInitSelection] = useState(false);

  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showOnlyUraBattle, setShowOnlyUraBattle] = useState(false);

  const suspectIds = useMemo(() => detectSuspiciousMessages(messages), [messages]);
  const battleIds = useMemo(
    () => detectUraBattleIds(messages, suspectIds),
    [messages, suspectIds]
  );

  const suspiciousMessages = useMemo(() => {
    return messages
      .filter((m: any) => suspectIds.has(m.id))
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, suspectIds]);

  const visibleMessages = useMemo(() => {
    let list = suspiciousMessages;
    if (showOnlyUraBattle) {
      list = list.filter((m: any) => battleIds.has(m.id));
    }
    if (filterFrom) {
      const fromMs = new Date(filterFrom).getTime();
      if (!isNaN(fromMs)) {
        list = list.filter((m: any) => new Date(m.timestamp).getTime() >= fromMs);
      }
    }
    if (filterTo) {
      const toMs = new Date(filterTo).getTime();
      if (!isNaN(toMs)) {
        list = list.filter((m: any) => new Date(m.timestamp).getTime() <= toMs);
      }
    }
    return list;
  }, [suspiciousMessages, battleIds, showOnlyUraBattle, filterFrom, filterTo]);

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
      setFilterFrom("");
      setFilterTo("");
      setShowOnlyUraBattle(false);
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

  const visibleAllSelected =
    visibleMessages.length > 0 &&
    visibleMessages.every((m: any) => selectedIds.has(m.id));

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleAllSelected) {
        for (const m of visibleMessages) next.delete(m.id);
      } else {
        for (const m of visibleMessages) next.add(m.id);
      }
      return next;
    });
  };

  const totalMessages = messages.length;
  const detectedCount = suspiciousMessages.length;
  const visibleCount = visibleMessages.length;
  const selectedCount = selectedIds.size;
  const battleDetectedCount = battleIds.size;

  const canConfirm = confirmText === "EXCLUIR" && selectedCount > 0 && !isDeleting;

  const handleSubmit = () => {
    if (!canConfirm) return;
    onConfirm(Array.from(selectedIds));
  };

  const hasFilters = !!filterFrom || !!filterTo || showOnlyUraBattle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Limpar mensagens da briga de URA
          </DialogTitle>
          <DialogDescription>
            Detectamos mensagens suspeitas por marcadores internos, repetições globais e rajadas. Mensagens assinadas por humanos (com prefixo <span className="font-mono">*Nome:*</span>) e notas do sistema são automaticamente protegidas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1">
          {detectedCount === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Nenhuma mensagem suspeita encontrada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Não há mensagens automáticas, repetições suspeitas ou rajadas nesta conversa.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-3">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">
                    {detectedCount} mensagens suspeitas detectadas
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    de {totalMessages} totais na conversa
                    {battleDetectedCount > 0 && (
                      <> · {battleDetectedCount} com padrão de briga</>
                    )}
                  </p>
                </div>
              </div>

              {/* Filtros de visualização */}
              <div className="rounded-md border border-border p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span>Filtros de visualização</span>
                  {hasFilters && (
                    <span className="text-xs text-muted-foreground font-normal">(não afetam a seleção)</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">De</Label>
                    <Input
                      type="datetime-local"
                      value={filterFrom}
                      onChange={(e) => setFilterFrom(e.target.value)}
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Até</Label>
                    <Input
                      type="datetime-local"
                      value={filterTo}
                      onChange={(e) => setFilterTo(e.target.value)}
                      className="text-xs h-8"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="ura-battle-only" className="text-xs cursor-pointer">
                    🤖 Apenas com padrão de briga (rajada + alternância + repetição)
                  </Label>
                  <Switch
                    id="ura-battle-only"
                    checked={showOnlyUraBattle}
                    onCheckedChange={setShowOnlyUraBattle}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    Selecionadas:{" "}
                    <span className={selectedCount > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                      {selectedCount}
                    </span>{" "}
                    de {detectedCount} detectadas
                    {hasFilters && (
                      <span className="text-muted-foreground"> · {visibleCount} visíveis</span>
                    )}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllVisible}>
                    {visibleAllSelected ? "Desmarcar visíveis" : "Marcar visíveis"}
                  </Button>
                </div>

                <ScrollArea className="h-64 rounded-md border border-border">
                  <div className="p-2 space-y-1">
                    {visibleMessages.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        Nenhuma mensagem visível com os filtros atuais.
                      </div>
                    ) : (
                      visibleMessages.map((m: any) => (
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
                          <span className="truncate flex-1">
                            {(m.content || "(sem conteúdo)").substring(0, 100)}
                          </span>
                          {battleIds.has(m.id) && (
                            <span className="shrink-0" title="Padrão de briga de URA">
                              🤖
                            </span>
                          )}
                        </div>
                      ))
                    )}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting || isResuming}>
            Cancelar
          </Button>
          {detectedCount === 0 ? (
            <Button variant="default" onClick={onResume} disabled={isResuming}>
              <Volume2 className="h-4 w-4 mr-2" />
              {isResuming ? "Reativando..." : "Reativar conversa"}
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleSubmit} disabled={!canConfirm}>
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? "Excluindo..." : `Excluir ${selectedCount} mensagem(ns)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
