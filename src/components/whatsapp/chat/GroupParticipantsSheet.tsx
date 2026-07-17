import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Users, MoreVertical, RefreshCcw, UserPlus, Loader2, AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import { formatBRPhone } from "@/lib/phoneBR";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useGroupRoster, type GroupParticipant } from "../hooks/useGroupRoster";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  providerType?: string | null;
}

type Action = "add" | "remove" | "promote" | "demote";

function initials(name: string | null, fallback: string) {
  if (name) {
    return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  }
  return (fallback || "?").slice(-2).toUpperCase();
}

function displayLabel(p: GroupParticipant): string {
  return p.name || (p.phone ? formatBRPhone(p.phone) : (p.id.split("@")[0] || "Participante"));
}

function sortParticipants(list: GroupParticipant[]): GroupParticipant[] {
  const rank = (p: GroupParticipant) =>
    p.admin === "superadmin" ? 0 : p.admin === "admin" ? 1 : 2;
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return displayLabel(a).localeCompare(displayLabel(b), "pt-BR");
  });
}

export default function GroupParticipantsSheet({
  open, onOpenChange, conversationId, providerType,
}: Props) {
  const supportsMgmt = !providerType || ["self_hosted", "cloud"].includes(providerType);
  const qc = useQueryClient();
  const { can } = usePermissions();

  const rosterQuery = useGroupRoster(conversationId, open && supportsMgmt);
  const roster = rosterQuery.data;

  const [confirm, setConfirm] = useState<
    | { action: "remove" | "promote" | "demote"; participant: GroupParticipant }
    | null
  >(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addChecking, setAddChecking] = useState(false);
  const [addResolved, setAddResolved] = useState<{ phone: string; exists: boolean } | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: {
      action: Action; participantId?: string; phone?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("manage-group-participants", {
        body: { conversationId, ...payload },
      });
      if (error) throw new Error((error as any)?.message ?? "Falha na operação");
      if (!data?.success) throw new Error(data?.error || "Falha na operação");
      if (data.ok === false) throw new Error(data.message || `Falha (status ${data.status})`);
      return data;
    },
    onSuccess: () => {
      toast.success("Operação concluída");
      qc.invalidateQueries({ queryKey: ["group-roster", conversationId] });
    },
    onError: (err: any) => toast.error(err?.message || "Falha na operação"),
  });

  const canView = can("atendimento_grupo_participantes", "view");
  const canInsert = can("atendimento_grupo_participantes", "insert");
  const canUpdate = can("atendimento_grupo_participantes", "update");
  const canDelete = can("atendimento_grupo_participantes", "delete");

  const selfIsAdmin = !!roster?.selfIsAdmin;
  const selfResolved = !!roster?.selfResolved;
  const canManage = selfIsAdmin && selfResolved;
  const canRemoveUi = canManage && canDelete;
  const canPromoteUi = canManage && canUpdate;
  const canAddUi = selfIsAdmin && canInsert;

  const sorted = useMemo(
    () => (roster?.participants ? sortParticipants(roster.participants) : []),
    [roster?.participants],
  );

  const groupName = roster?.groupName || "Grupo";
  const count = sorted.length;

  const runConfirmed = async () => {
    if (!confirm) return;
    await mutation.mutateAsync({ action: confirm.action, participantId: confirm.participant.id });
    setConfirm(null);
  };

  const checkNumber = async () => {
    const clean = addPhone.replace(/\D/g, "");
    if (clean.length < 10) {
      toast.error("Informe um telefone válido com DDD");
      return;
    }
    setAddChecking(true);
    setAddResolved(null);
    try {
      // usa a mesma edge function que o backend usa, para dar feedback antes
      const { data, error } = await supabase.functions.invoke("check-whatsapp-number", {
        body: { instanceId: null, phone: clean, conversationId },
      });
      if (error) throw error;
      if (data?.exists) {
        setAddResolved({ phone: String(data.phone ?? clean), exists: true });
      } else {
        setAddResolved({ phone: clean, exists: false });
        toast.error("Número não encontrado no WhatsApp");
      }
    } catch {
      // se check falhar, deixamos o backend validar de novo
      setAddResolved({ phone: clean, exists: true });
    } finally {
      setAddChecking(false);
    }
  };

  const runAdd = async () => {
    if (!addResolved?.exists) return;
    await mutation.mutateAsync({ action: "add", phone: addResolved.phone });
    setAddOpen(false);
    setAddPhone("");
    setAddResolved(null);
  };

  if (!supportsMgmt) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[340px] p-4">
          <SheetHeader><SheetTitle>Participantes</SheetTitle></SheetHeader>
          <p className="text-sm text-muted-foreground mt-4">
            Este provedor não suporta listar participantes de grupo.
          </p>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0 flex flex-col">
          <SheetHeader className="px-4 py-4 border-b border-border shrink-0">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{groupName}</span>
              </SheetTitle>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => rosterQuery.refetch()}
                  disabled={rosterQuery.isFetching}
                  aria-label="Atualizar"
                >
                  {rosterQuery.isFetching
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCcw className="h-3.5 w-3.5" />}
                </Button>
                {canAddUi && (
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setAddOpen(true)}
                    aria-label="Adicionar participante"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {count} participante{count !== 1 ? "s" : ""}
            </p>
          </SheetHeader>

          {/* Banners */}
          {roster && !selfResolved && (
            <div className="flex items-start gap-2 mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Não foi possível identificar o número da instância neste grupo.
                Ações desabilitadas por segurança.
              </span>
            </div>
          )}
          {roster && selfResolved && !selfIsAdmin && (
            <div className="flex items-start gap-2 mx-4 mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>A instância não é administradora deste grupo. Só é possível visualizar.</span>
            </div>
          )}

          <ScrollArea className="flex-1">
            {rosterQuery.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rosterQuery.error ? (
              <div className="px-6 py-10 text-center text-sm text-destructive">
                {(rosterQuery.error as any)?.message || "Erro ao carregar participantes"}
              </div>
            ) : !canView ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Você não tem permissão para ver a lista.
              </div>
            ) : sorted.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Nenhum participante retornado.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {sorted.map((p) => {
                  const isSelf = p.id === roster?.selfId;
                  const label = displayLabel(p);
                  const showMenu = canManage && (canRemoveUi || canPromoteUi);
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-[10px] bg-muted">
                          {initials(p.name, p.phone ?? p.id)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.phone ? formatBRPhone(p.phone) : `ID ${p.id.split("@")[0].slice(0, 8)}…`}
                        </p>
                      </div>
                      {p.admin === "superadmin" && (
                        <Badge variant="secondary" className="text-[10px] h-5 shrink-0">Dono</Badge>
                      )}
                      {p.admin === "admin" && (
                        <Badge variant="secondary" className="text-[10px] h-5 shrink-0">Admin</Badge>
                      )}
                      {showMenu && (
                        isSelf ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">Esta é a instância conectada</TooltipContent>
                          </Tooltip>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canPromoteUi && p.admin === null && (
                                <DropdownMenuItem onClick={() => setConfirm({ action: "promote", participant: p })}>
                                  Tornar admin
                                </DropdownMenuItem>
                              )}
                              {canPromoteUi && p.admin === "admin" && (
                                <DropdownMenuItem onClick={() => setConfirm({ action: "demote", participant: p })}>
                                  Remover admin
                                </DropdownMenuItem>
                              )}
                              {canRemoveUi && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setConfirm({ action: "remove", participant: p })}
                                >
                                  Remover do grupo
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Confirmação remove / promote / demote */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.action === "remove" && "Remover do grupo?"}
                  {confirm.action === "promote" && "Tornar admin?"}
                  {confirm.action === "demote" && "Remover admin?"}
                </DialogTitle>
                <DialogDescription>
                  {confirm.action === "remove" && (
                    <>Remover <b>{displayLabel(confirm.participant)}</b> do grupo? Todos os participantes verão essa ação no WhatsApp.</>
                  )}
                  {confirm.action === "promote" && (
                    <>Promover <b>{displayLabel(confirm.participant)}</b> a administrador? Administradores podem remover outros participantes, inclusive esta instância.</>
                  )}
                  {confirm.action === "demote" && (
                    <>Rebaixar <b>{displayLabel(confirm.participant)}</b> a participante comum?</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirm(null)} disabled={mutation.isPending}>
                  Cancelar
                </Button>
                <Button
                  variant={confirm.action === "remove" ? "destructive" : "default"}
                  onClick={runConfirmed}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Confirmar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); setAddPhone(""); setAddResolved(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar ao grupo</DialogTitle>
            <DialogDescription>
              Informe o telefone com DDD. Se as configurações de privacidade da pessoa bloquearem
              adição em grupos, ela receberá um convite em vez de entrar direto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="(11) 99999-9999"
              value={addPhone}
              onChange={(e) => { setAddPhone(e.target.value); setAddResolved(null); }}
              disabled={addChecking || mutation.isPending}
            />
            {addResolved?.exists && (
              <p className="text-xs text-muted-foreground">
                Número validado: <b>{formatBRPhone(addResolved.phone)}</b>. Confirme para adicionar.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={mutation.isPending}>
              Cancelar
            </Button>
            {!addResolved?.exists ? (
              <Button onClick={checkNumber} disabled={addChecking || !addPhone.trim()}>
                {addChecking && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Validar número
              </Button>
            ) : (
              <Button onClick={runAdd} disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Adicionar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
