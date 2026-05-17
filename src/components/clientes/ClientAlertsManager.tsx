import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Loader2, Trash2, AlertTriangle, Ban, ScrollText } from "lucide-react";

interface ClientAlert {
  id: string;
  kind: "aviso" | "bloqueio";
  block_behavior: "confirm" | "hard" | null;
  titulo: string;
  mensagem: string;
  expires_at: string | null;
  created_at: string;
}

interface Props {
  clienteId?: string;
  contactId?: string;
  canManage?: boolean;
}

export function ClientAlertsManager({ clienteId, contactId, canManage = true }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const targetCol = clienteId ? "cliente_id" : "contact_id";
  const targetVal = clienteId ?? contactId ?? null;
  const queryKey = ["client-alerts", targetCol, targetVal];

  const { data: alerts = [], isLoading } = useQuery({
    queryKey,
    enabled: !!targetVal,
    queryFn: async () => {
      const { data, error } = await (supabase.from("client_alerts" as any) as any)
        .select("id, kind, block_behavior, titulo, mensagem, expires_at, created_at")
        .eq(targetCol, targetVal)
        .eq("ativo", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientAlert[];
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [kind, setKind] = useState<"aviso" | "bloqueio">("aviso");
  const [blockBehavior, setBlockBehavior] = useState<"confirm" | "hard">("confirm");
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const resetForm = () => {
    setKind("aviso"); setBlockBehavior("confirm");
    setTitulo(""); setMensagem(""); setExpiresAt("");
    setShowForm(false);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tid) throw new Error("Tenant não identificado");
      if (!titulo.trim() || !mensagem.trim()) throw new Error("Preencha título e mensagem");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Usuário não autenticado");
      const payload = {
        tenant_id: tid,
        cliente_id: clienteId ?? null,
        contact_id: contactId ?? null,
        kind,
        block_behavior: kind === "bloqueio" ? blockBehavior : null,
        titulo: titulo.trim(),
        mensagem: mensagem.trim(),
        expires_at: expiresAt ? `${expiresAt}T23:59:59` : null,
        created_by: auth.user.id,
      };
      const { error } = await (supabase.from("client_alerts" as any) as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["client-alerts-active"] });
      toast({ title: "Salvo!", description: "Aviso/bloqueio criado." });
      resetForm();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await (supabase.from("client_alerts" as any) as any)
        .update({ ativo: false, resolved_at: new Date().toISOString(), resolved_by: auth?.user?.id ?? null })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["client-alerts-active"] });
      toast({ title: "Removido", description: "Aviso/bloqueio desativado." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    },
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum aviso ou bloqueio ativo.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const isBlock = a.kind === "bloqueio";
            return (
              <div
                key={a.id}
                className={`rounded-md border p-3 ${isBlock ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isBlock
                      ? <Ban className="h-4 w-4 text-destructive shrink-0" />
                      : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                    <span className="text-xs font-medium">
                      {isBlock ? (a.block_behavior === "hard" ? "Bloqueio · trava" : "Bloqueio · confirmação") : "Aviso"}
                    </span>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => resolveMutation.mutate(a.id)}
                      disabled={resolveMutation.isPending}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold leading-snug">{a.titulo}</p>
                <p className="text-xs text-muted-foreground leading-snug">{a.mensagem}</p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {a.expires_at ? `Expira em ${fmtDate(a.expires_at)}` : "Sem validade"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        showForm ? (
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-sm font-medium">Novo aviso ou bloqueio</p>

            <div className="flex gap-2">
              <button
                onClick={() => setKind("aviso")}
                className={`rounded-md border p-2 text-left transition-colors ${kind === "aviso" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="block text-xs font-medium">Aviso</span>
                <span className="block text-[10px] text-muted-foreground">Só alerta, não impede</span>
              </button>
              <button
                onClick={() => setKind("bloqueio")}
                className={`rounded-md border p-2 text-left transition-colors ${kind === "bloqueio" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="block text-xs font-medium">Bloqueio</span>
                <span className="block text-[10px] text-muted-foreground">Confirmar ou travar</span>
              </button>
            </div>

            {kind === "bloqueio" && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Modo do bloqueio</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBlockBehavior("confirm")}
                    className={`rounded-md border p-2 text-xs ${blockBehavior === "confirm" ? "border-primary bg-primary/5" : "border-border"}`}>
                    Exige confirmação
                  </button>
                  <button
                    onClick={() => setBlockBehavior("hard")}
                    className={`rounded-md border p-2 text-xs ${blockBehavior === "hard" ? "border-primary bg-primary/5" : "border-border"}`}>
                    Trava — impede abrir
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Título</p>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Inadimplência — falar com financeiro" className="h-8 text-xs" />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Mensagem para o time</p>
              <Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="O que o atendente precisa saber / fazer" className="text-xs min-h-[56px]" rows={2} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Validade (opcional)</p>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-8 text-xs" />
            </div>

            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Salvar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={resetForm}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={() => setShowForm(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo aviso ou bloqueio
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAuditOpen(true)}>
              <ScrollText className="h-3.5 w-3.5" /> Auditoria
            </Button>
          </div>
        )
      )}

      <AuditDialog
        open={auditOpen}
        onOpenChange={setAuditOpen}
        clienteId={clienteId}
        contactId={contactId}
      />
    </div>
  );
}

interface AuditRow {
  id: string;
  performed_at: string;
  performed_by_name: string;
  action: string;
  alert_titulo: string;
  alert_kind: string;
  alert_block_behavior: string | null;
}

function AuditDialog({
  open,
  onOpenChange,
  clienteId,
  contactId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId?: string;
  contactId?: string;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["client-alert-audit", clienteId, contactId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_client_alert_audit", {
        p_cliente_id: clienteId ?? null,
        p_contact_id: contactId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Auditoria de bloqueios
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nenhum bloqueio foi furado até agora.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto py-1">
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{r.performed_by_name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{fmt(r.performed_at)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground leading-snug">
                  Assumiu o atendimento confirmando ciência do bloqueio &ldquo;{r.alert_titulo}&rdquo;.
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
