import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
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
import {
  Plus,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Pencil,
  Zap,
  Eye,
  EyeOff,
  Phone,
} from "lucide-react";

interface Instance {
  id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  provider_type: string;
  created_at: string;
}

interface InstanceSecret {
  id: string;
  api_url: string;
  api_key: string;
}

interface FormState {
  instance_name: string;
  display_name: string;
  api_url: string;
  api_key: string;
}

const EMPTY_FORM: FormState = { instance_name: "", display_name: "", api_url: "", api_key: "" };

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "Conectado", variant: "default" },
  disconnected: { label: "Desconectado", variant: "destructive" },
  connecting: { label: "Conectando...", variant: "secondary" },
};

export default function WhatsAppInstancesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => (tid ? q.eq("tenant_id", tid) : q);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  // ── Queries ──
  const { data: instances = [], isLoading } = useQuery({
    queryKey: ["whatsapp-instances", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        supabase.from("whatsapp_instances").select("id, instance_name, display_name, phone_number, status, provider_type, created_at")
      ).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Instance[];
    },
  });

  // ── Open create dialog ──
  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowApiKey(false);
    setDialogOpen(true);
  };

  // ── Open edit dialog ──
  const openEdit = async (inst: Instance) => {
    setEditingId(inst.id);
    setShowApiKey(false);
    // Load secrets
    const { data: secret } = await supabase
      .from("whatsapp_instance_secrets")
      .select("api_url, api_key")
      .eq("instance_id", inst.id)
      .maybeSingle();
    setForm({
      instance_name: inst.instance_name,
      display_name: inst.display_name ?? "",
      api_url: secret?.api_url ?? "",
      api_key: secret?.api_key ?? "",
    });
    setDialogOpen(true);
  };

  // ── Save (create or update) ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.instance_name.trim()) throw new Error("Nome da instância é obrigatório");
      if (!form.api_url.trim()) throw new Error("URL da API é obrigatória");
      if (!form.api_key.trim()) throw new Error("API Key é obrigatória");

      if (editingId) {
        // Update instance
        const { error: instErr } = await supabase
          .from("whatsapp_instances")
          .update({
            instance_name: form.instance_name.trim(),
            display_name: form.display_name.trim() || null,
          })
          .eq("id", editingId);
        if (instErr) throw instErr;

        // Upsert secrets
        const { data: existingSecret } = await supabase
          .from("whatsapp_instance_secrets")
          .select("id")
          .eq("instance_id", editingId)
          .maybeSingle();

        if (existingSecret) {
          const { error: secErr } = await supabase
            .from("whatsapp_instance_secrets")
            .update({ api_url: form.api_url.trim(), api_key: form.api_key.trim() })
            .eq("instance_id", editingId);
          if (secErr) throw secErr;
        } else {
          const { error: secErr } = await supabase
            .from("whatsapp_instance_secrets")
            .insert({
              instance_id: editingId,
              tenant_id: tid ?? (instances.find((i) => i.id === editingId) as any)?.tenant_id,
              api_url: form.api_url.trim(),
              api_key: form.api_key.trim(),
            });
          if (secErr) throw secErr;
        }
      } else {
        // Create instance
        const { data: newInst, error: instErr } = await supabase
          .from("whatsapp_instances")
          .insert({
            instance_name: form.instance_name.trim(),
            display_name: form.display_name.trim() || null,
            provider_type: "self_hosted",
          } as any)
          .select("id, tenant_id")
          .single();
        if (instErr) throw instErr;

        // Create secrets
        const { error: secErr } = await supabase
          .from("whatsapp_instance_secrets")
          .insert({
            instance_id: newInst.id,
            tenant_id: newInst.tenant_id,
            api_url: form.api_url.trim(),
            api_key: form.api_key.trim(),
          });
        if (secErr) throw secErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
      setDialogOpen(false);
      toast({ title: editingId ? "Instância atualizada!" : "Instância criada!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // ── Delete ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete secrets first
      await supabase.from("whatsapp_instance_secrets").delete().eq("instance_id", id);
      const { error } = await supabase.from("whatsapp_instances").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
      setDeleteTarget(null);
      toast({ title: "Instância removida" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    },
  });

  // ── Test Connection ──
  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("test-instance-connection", {
        body: { instanceId: id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      const result = res.data;
      if (result?.connected) {
        toast({ title: "Conexão OK!", description: `Instância conectada. Número: ${result.phoneNumber || "N/A"}` });
      } else {
        toast({ title: "Sem conexão", description: result?.error || "Instância não respondeu", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
    } catch (err: any) {
      toast({ title: "Erro no teste", description: err.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  // ── Check All Status ──
  const checkAllStatus = async () => {
    setCheckingAll(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("check-instances-status", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
      toast({ title: "Status atualizado", description: `${res.data?.checked ?? 0} instância(s) verificada(s)` });
    } catch (err: any) {
      toast({ title: "Erro ao verificar status", description: err.message, variant: "destructive" });
    } finally {
      setCheckingAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Instâncias WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie suas conexões com a Evolution API.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkAllStatus} disabled={checkingAll || instances.length === 0}>
            {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar Status
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nova Instância
          </Button>
        </div>
      </div>

      {instances.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Phone className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <CardTitle className="text-lg mb-1">Nenhuma instância cadastrada</CardTitle>
            <CardDescription>
              Adicione sua primeira instância da Evolution API para começar a usar o WhatsApp.
            </CardDescription>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nova Instância
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {instances.map((inst) => {
            const st = STATUS_MAP[inst.status] ?? { label: inst.status, variant: "outline" as const };
            return (
              <Card key={inst.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate">
                      {inst.display_name || inst.instance_name}
                    </CardTitle>
                    <Badge variant={st.variant} className="shrink-0">
                      {inst.status === "connected" ? (
                        <Wifi className="h-3 w-3 mr-1" />
                      ) : (
                        <WifiOff className="h-3 w-3 mr-1" />
                      )}
                      {st.label}
                    </Badge>
                  </div>
                  {inst.display_name && (
                    <CardDescription className="text-xs truncate">{inst.instance_name}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {inst.phone_number && (
                    <p className="text-sm text-muted-foreground mb-3">
                      <Phone className="h-3 w-3 inline mr-1" />
                      {inst.phone_number}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testConnection(inst.id)}
                      disabled={testingId === inst.id}
                    >
                      {testingId === inst.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      Testar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(inst)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteTarget(inst)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Instância" : "Nova Instância"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome da Instância *</Label>
              <Input
                placeholder="minha-instancia"
                value={form.instance_name}
                onChange={(e) => setForm((f) => ({ ...f, instance_name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Deve corresponder ao nome configurado na Evolution API.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Nome de Exibição</Label>
              <Input
                placeholder="Atendimento Principal"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>URL da Evolution API *</Label>
              <Input
                placeholder="https://evolution.meudominio.com"
                value={form.api_url}
                onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>API Key *</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder="sua-api-key"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-10 w-10"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover instância?</AlertDialogTitle>
            <AlertDialogDescription>
              A instância <strong>{deleteTarget?.display_name || deleteTarget?.instance_name}</strong> será removida
              permanentemente, incluindo suas credenciais. Conversas e mensagens existentes serão mantidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
