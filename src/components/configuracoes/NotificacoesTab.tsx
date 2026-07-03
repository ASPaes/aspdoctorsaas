import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Loader2, Save } from "lucide-react";

type EventType = {
  key: string;
  label: string;
  descricao: string | null;
  categoria: "gestao" | "sistema";
  default_severity: string | null;
  cooldown_minutes: number | null;
  ativo: boolean;
};

type Subscription = {
  id: string;
  tenant_id: string;
  event_type_key: string;
  user_id: string;
  channels: string[];
  whatsapp_phone: string | null;
  ativo: boolean;
};

type TenantUser = { user_id: string; email: string | null; name: string | null };

const CATEGORY_LABELS: Record<string, string> = {
  gestao: "Gestão",
  sistema: "Sistema",
};

export default function NotificacoesTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: ["notification_event_types_admin"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("notification_event_types" as any) as any)
        .select("key,label,descricao,categoria,default_severity,cooldown_minutes,ativo")
        .eq("ativo", true)
        .order("categoria")
        .order("label");
      if (error) throw error;
      return (data ?? []) as EventType[];
    },
  });

  const subsQuery = useQuery({
    queryKey: ["notification_subscriptions", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("notification_subscriptions" as any) as any)
        .select("id,tenant_id,event_type_key,user_id,channels,whatsapp_phone,ativo")
        .eq("tenant_id", tid);
      if (error) throw error;
      return (data ?? []) as Subscription[];
    },
  });

  const usersQuery = useQuery({
    queryKey: ["notif_tenant_users", tid],
    enabled: !!tid,
    queryFn: async () => {
      const [profilesRes, emailsRes, funcionariosRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, funcionario_id")
          .eq("tenant_id", tid!),
        (supabase.rpc as any)("get_tenant_users_with_email", { p_tenant_id: tid! }),
        supabase.from("funcionarios").select("id, nome").eq("tenant_id", tid!),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (emailsRes.error) throw emailsRes.error;
      if (funcionariosRes.error) throw funcionariosRes.error;

      const emailByUser = new Map<string, string | null>(
        ((emailsRes.data ?? []) as Array<{ user_id: string; email: string | null }>).map(
          (r) => [r.user_id, r.email],
        ),
      );
      const funcById = new Map<number, string>(
        ((funcionariosRes.data ?? []) as Array<{ id: number; nome: string }>).map((f) => [
          f.id,
          f.nome,
        ]),
      );

      return ((profilesRes.data ?? []) as Array<{
        user_id: string;
        funcionario_id: number | null;
      }>).map<TenantUser>((p) => {
        const name = p.funcionario_id ? funcById.get(p.funcionario_id) ?? null : null;
        return { user_id: p.user_id, email: emailByUser.get(p.user_id) ?? null, name };
      });
    },
  });

  const userLabel = (u?: TenantUser | null) =>
    u ? u.name || u.email || u.user_id.slice(0, 8) : "Usuário";

  const usersById = useMemo(() => {
    const m = new Map<string, TenantUser>();
    for (const u of usersQuery.data ?? []) m.set(u.user_id, u);
    return m;
  }, [usersQuery.data]);

  const subsByEvent = useMemo(() => {
    const m = new Map<string, Subscription[]>();
    for (const s of subsQuery.data ?? []) {
      const list = m.get(s.event_type_key) ?? [];
      list.push(s);
      m.set(s.event_type_key, list);
    }
    return m;
  }, [subsQuery.data]);

  const updateSub = useMutation({
    mutationFn: async (payload: Partial<Subscription> & { id: string }) => {
      const { id, ...rest } = payload;
      const { error } = await (supabase.from("notification_subscriptions" as any) as any)
        .update(rest)
        .eq("id", id)
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification_subscriptions", tid] });
    },
    onError: (err: any) =>
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" }),
  });

  const insertSub = useMutation({
    mutationFn: async (payload: { event_type_key: string; user_id: string }) => {
      const { error } = await (supabase.from("notification_subscriptions" as any) as any).insert({
        tenant_id: tid,
        event_type_key: payload.event_type_key,
        user_id: payload.user_id,
        channels: ["in_app"],
        ativo: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification_subscriptions", tid] });
      toast({ title: "Destinatário adicionado" });
    },
    onError: (err: any) =>
      toast({ title: "Erro ao adicionar", description: err.message, variant: "destructive" }),
  });

  const deleteSub = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("notification_subscriptions" as any) as any)
        .delete()
        .eq("id", id)
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification_subscriptions", tid] });
      toast({ title: "Destinatário removido" });
    },
    onError: (err: any) =>
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" }),
  });

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState<Subscription | null>(null);

  if (eventsQuery.isLoading || subsQuery.isLoading || usersQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const events = eventsQuery.data ?? [];
  const grouped: Record<string, EventType[]> = { gestao: [], sistema: [] };
  for (const e of events) (grouped[e.categoria] ??= []).push(e);

  return (
    <div className="space-y-8 max-w-4xl">
      {(["gestao", "sistema"] as const).map((cat) => {
        const list = grouped[cat] ?? [];
        if (!list.length) return null;
        return (
          <div key={cat} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {CATEGORY_LABELS[cat]}
            </h3>
            {list.map((event) => {
              const subs = subsByEvent.get(event.key) ?? [];
              const takenUserIds = new Set(subs.map((s) => s.user_id));
              const availableUsers = (usersQuery.data ?? []).filter(
                (u) => !takenUserIds.has(u.user_id),
              );

              return (
                <Card key={event.key}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-base">{event.label}</CardTitle>
                        {event.descricao && (
                          <CardDescription className="mt-1">{event.descricao}</CardDescription>
                        )}
                      </div>
                      {event.default_severity && (
                        <Badge variant="outline" className="shrink-0">
                          {event.default_severity}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {subs.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        Nenhum destinatário configurado.
                      </p>
                    )}
                    {subs.map((sub) => (
                      <SubscriptionRow
                        key={sub.id}
                        sub={sub}
                        user={usersById.get(sub.user_id) ?? null}
                        userLabel={userLabel}
                        onSave={(patch) => updateSub.mutateAsync({ id: sub.id, ...patch })}
                        onDelete={() => setConfirmDelete(sub)}
                      />
                    ))}
                    <div className="pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddingFor(event.key);
                          setSelectedUser("");
                        }}
                        disabled={availableUsers.length === 0}
                      >
                        <Plus className="h-4 w-4" />
                        Adicionar destinatário
                      </Button>
                      {availableUsers.length === 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Todos os usuários já estão cadastrados.
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })}

      <Dialog open={!!addingFor} onOpenChange={(o) => !o && setAddingFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar destinatário</DialogTitle>
            <DialogDescription>
              Selecione o usuário que receberá este alerta no sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Usuário</Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um usuário" />
              </SelectTrigger>
              <SelectContent>
                {(usersQuery.data ?? [])
                  .filter((u) => {
                    const subs = subsByEvent.get(addingFor ?? "") ?? [];
                    return !subs.some((s) => s.user_id === u.user_id);
                  })
                  .map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {userLabel(u)}
                      {u.email && u.name ? ` (${u.email})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!selectedUser || insertSub.isPending}
              onClick={async () => {
                if (!addingFor || !selectedUser) return;
                await insertSub.mutateAsync({
                  event_type_key: addingFor,
                  user_id: selectedUser,
                });
                setAddingFor(null);
              }}
            >
              {insertSub.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover destinatário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário deixará de receber notificações deste evento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDelete) await deleteSub.mutateAsync(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubscriptionRow({
  sub,
  user,
  userLabel,
  onSave,
  onDelete,
}: {
  sub: Subscription;
  user: TenantUser | null;
  userLabel: (u?: TenantUser | null) => string;
  onSave: (patch: Partial<Subscription>) => Promise<void>;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [ativo, setAtivo] = useState(sub.ativo);
  const [inApp, setInApp] = useState(sub.channels?.includes("in_app") ?? false);
  const [whatsapp, setWhatsapp] = useState(sub.channels?.includes("whatsapp") ?? false);
  const [phone, setPhone] = useState(sub.whatsapp_phone ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    ativo !== sub.ativo ||
    inApp !== (sub.channels?.includes("in_app") ?? false) ||
    whatsapp !== (sub.channels?.includes("whatsapp") ?? false) ||
    (phone ?? "") !== (sub.whatsapp_phone ?? "");

  const handleSave = async () => {
    const channels: string[] = [];
    if (inApp) channels.push("in_app");
    if (whatsapp) channels.push("whatsapp");
    if (whatsapp && !phone.trim()) {
      toast({
        title: "Telefone obrigatório",
        description: "Informe o número do WhatsApp para este canal.",
        variant: "destructive",
      });
      return;
    }
    if (channels.length === 0) {
      toast({
        title: "Selecione ao menos um canal",
        description: "Marque No sistema e/ou WhatsApp.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ativo,
        channels,
        whatsapp_phone: whatsapp ? phone.trim() : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{userLabel(user)}</p>
          {user?.email && user?.name && (
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-xs text-muted-foreground">Ativo</Label>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={inApp} onCheckedChange={(v) => setInApp(!!v)} />
          No sistema
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={whatsapp} onCheckedChange={(v) => setWhatsapp(!!v)} />
          WhatsApp
        </label>
      </div>

      {whatsapp && (
        <div className="space-y-1">
          <Label className="text-xs">Telefone</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="DDI+DDD+número, ex: 5549999999999"
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Remover
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
