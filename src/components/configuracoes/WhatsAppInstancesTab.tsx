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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface FormState {
  instance_name: string;
  display_name: string;
  api_url: string;
  api_key: string;
  provider_type: "self_hosted" | "zapi" | "meta_cloud";
  zapi_instance_id: string;
  zapi_token: string;
  zapi_client_token: string;
  meta_phone_number_id: string;
  meta_access_token: string;
  meta_app_secret: string;
  meta_verify_token: string;
}

const EMPTY_FORM: FormState = {
  instance_name: "",
  display_name: "",
  api_url: "",
  api_key: "",
  provider_type: "self_hosted",
  zapi_instance_id: "",
  zapi_token: "",
  zapi_client_token: "",
  meta_phone_number_id: "",
  meta_access_token: "",
  meta_app_secret: "",
  meta_verify_token: "",
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "Conectado", variant: "default" },
  disconnected: { label: "Desconectado", variant: "destructive" },
  connecting: { label: "Conectando...", variant: "secondary" },
};

const PROVIDER_LABEL: Record<string, string> = {
  self_hosted: "Evolution",
  cloud: "Evolution",
  zapi: "Z-API",
  meta_cloud: "Meta Cloud",
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
  const [showZapiToken, setShowZapiToken] = useState(false);
  const [showZapiClientToken, setShowZapiClientToken] = useState(false);
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [showMetaAppSecret, setShowMetaAppSecret] = useState(false);
  const [showMetaVerifyToken, setShowMetaVerifyToken] = useState(false);
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
    setShowZapiToken(false);
    setShowZapiClientToken(false);
    setShowMetaToken(false);
    setShowMetaAppSecret(false);
    setShowMetaVerifyToken(false);
    setDialogOpen(true);
  };

  // ── Open edit dialog ──
  const openEdit = async (inst: Instance) => {
    setEditingId(inst.id);
    setShowApiKey(false);
    setShowZapiToken(false);
    setShowZapiClientToken(false);
    setShowMetaToken(false);
    setShowMetaAppSecret(false);
    setShowMetaVerifyToken(false);
    // Load secrets
    const { data: secret } = await (supabase
      .from("whatsapp_instance_secrets") as any)
      .select("api_url, api_key, zapi_instance_id, zapi_token, zapi_client_token, meta_access_token, meta_app_secret, meta_verify_token")
      .eq("instance_id", inst.id)
      .maybeSingle();
    setForm({
      instance_name: inst.instance_name,
      display_name: inst.display_name ?? "",
      api_url: secret?.api_url ?? "",
      api_key: secret?.api_key ?? "",
      zapi_instance_id: secret?.zapi_instance_id ?? "",
      zapi_token: secret?.zapi_token ?? "",
      zapi_client_token: secret?.zapi_client_token ?? "",
      meta_phone_number_id: (inst as any).meta_phone_number_id ?? "",
      meta_access_token: secret?.meta_access_token ?? "",
      meta_app_secret: secret?.meta_app_secret ?? "",
      meta_verify_token: secret?.meta_verify_token ?? "",
      provider_type: (inst.provider_type as FormState["provider_type"]) ?? "self_hosted",
    });
    setDialogOpen(true);
  };

  // ── Save (create or update) ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.instance_name.trim()) throw new Error("Nome da instância é obrigatório");

      // Validate provider-specific fields
      if (form.provider_type === "self_hosted") {
        if (!form.api_url.trim()) throw new Error("URL da API é obrigatória");
        if (!form.api_key.trim()) throw new Error("API Key é obrigatória");
      } else if (form.provider_type === "zapi") {
        if (!form.zapi_instance_id.trim()) throw new Error("ID da Instância Z-API é obrigatório");
        if (!form.zapi_token.trim()) throw new Error("Token Z-API é obrigatório");
      } else if (form.provider_type === "meta_cloud") {
        if (!form.meta_phone_number_id.trim()) throw new Error("Phone Number ID é obrigatório");
        if (!form.meta_access_token.trim()) throw new Error("Access Token é obrigatório");
        if (!form.meta_app_secret.trim()) throw new Error("App Secret é obrigatório");
        if (!form.meta_verify_token.trim()) throw new Error("Verify Token é obrigatório");
      }

      if (editingId) {
        // Update instance
        const instUpdate: any = {
          instance_name: form.instance_name.trim(),
          display_name: form.display_name.trim() || null,
          provider_type: form.provider_type,
        };
        if (form.provider_type === "meta_cloud") {
          instUpdate.meta_phone_number_id = form.meta_phone_number_id.trim();
        }
        const { error: instErr } = await (supabase
          .from("whatsapp_instances") as any)
          .update(instUpdate)
          .eq("id", editingId);
        if (instErr) throw instErr;

        // Build secrets payload
        const secretsPayload: any = {};
        if (form.provider_type === "self_hosted") {
          secretsPayload.api_url = form.api_url.trim();
          secretsPayload.api_key = form.api_key.trim();
        } else if (form.provider_type === "zapi") {
          secretsPayload.zapi_instance_id = form.zapi_instance_id.trim();
          secretsPayload.zapi_token = form.zapi_token.trim();
          secretsPayload.zapi_client_token = form.zapi_client_token.trim() || null;
        } else if (form.provider_type === "meta_cloud") {
          secretsPayload.meta_access_token = form.meta_access_token.trim();
        }

        // Upsert secrets
        const { data: existingSecret } = await supabase
          .from("whatsapp_instance_secrets")
          .select("id")
          .eq("instance_id", editingId)
          .maybeSingle();

        if (existingSecret) {
          const { error: secErr } = await (supabase
            .from("whatsapp_instance_secrets") as any)
            .update(secretsPayload)
            .eq("instance_id", editingId);
          if (secErr) throw secErr;
        } else {
          const { error: secErr } = await (supabase
            .from("whatsapp_instance_secrets") as any)
            .insert({
              instance_id: editingId,
              tenant_id: tid ?? (instances.find((i) => i.id === editingId) as any)?.tenant_id,
              ...secretsPayload,
            });
          if (secErr) throw secErr;
        }
      } else {
        // Create instance
        const instPayload: any = {
          instance_name: form.instance_name.trim(),
          display_name: form.display_name.trim() || null,
          provider_type: form.provider_type,
        };
        if (form.provider_type === "meta_cloud") {
          instPayload.meta_phone_number_id = form.meta_phone_number_id.trim();
        }

        const { data: newInst, error: instErr } = await (supabase
          .from("whatsapp_instances") as any)
          .insert(instPayload)
          .select("id, tenant_id")
          .single();
        if (instErr) throw instErr;

        // Build secrets payload
        const secretsPayload: any = {
          instance_id: newInst.id,
          tenant_id: newInst.tenant_id,
        };
        if (form.provider_type === "self_hosted") {
          secretsPayload.api_url = form.api_url.trim();
          secretsPayload.api_key = form.api_key.trim();
        } else if (form.provider_type === "zapi") {
          secretsPayload.zapi_instance_id = form.zapi_instance_id.trim();
          secretsPayload.zapi_token = form.zapi_token.trim();
          secretsPayload.zapi_client_token = form.zapi_client_token.trim() || null;
        } else if (form.provider_type === "meta_cloud") {
          secretsPayload.meta_access_token = form.meta_access_token.trim();
        }

        const { error: secErr } = await (supabase
          .from("whatsapp_instance_secrets") as any)
          .insert(secretsPayload);
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
            Gerencie suas conexões WhatsApp (Evolution API, Z-API ou Meta Cloud).
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
              Adicione sua primeira instância para começar a usar o WhatsApp.
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
            const providerLabel = PROVIDER_LABEL[inst.provider_type] ?? inst.provider_type;
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
                  <div className="flex items-center gap-1.5">
                    {inst.display_name && (
                      <CardDescription className="text-xs truncate">{inst.instance_name}</CardDescription>
                    )}
                    <Badge variant="outline" className="text-xs shrink-0">
                      {providerLabel}
                    </Badge>
                  </div>
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
              <Label>Provider *</Label>
              <Select
                value={form.provider_type}
                onValueChange={(v) => setForm((f) => ({ ...f, provider_type: v as FormState["provider_type"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self_hosted">Evolution API</SelectItem>
                  <SelectItem value="zapi">Z-API</SelectItem>
                  <SelectItem value="meta_cloud">Meta Cloud (Oficial)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nome da Instância *</Label>
              <Input
                placeholder="minha-instancia"
                value={form.instance_name}
                onChange={(e) => setForm((f) => ({ ...f, instance_name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Identificador único da instância.
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

            {/* ── Provider-specific fields ── */}
            {form.provider_type === "self_hosted" && (
              <>
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
                      autoComplete="off"
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
              </>
            )}

            {form.provider_type === "zapi" && (
              <>
                <div className="space-y-1.5">
                  <Label>ID da Instância Z-API *</Label>
                  <Input
                    placeholder="ID da instância no Z-API"
                    value={form.zapi_instance_id}
                    onChange={(e) => setForm((f) => ({ ...f, zapi_instance_id: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Token Z-API *</Label>
                  <div className="relative">
                    <Input
                      type={showZapiToken ? "text" : "password"}
                      placeholder="seu-token-zapi"
                      value={form.zapi_token}
                      onChange={(e) => setForm((f) => ({ ...f, zapi_token: e.target.value }))}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-10 w-10"
                      onClick={() => setShowZapiToken(!showZapiToken)}
                    >
                      {showZapiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Client-Token Z-API</Label>
                  <div className="relative">
                    <Input
                      type={showZapiClientToken ? "text" : "password"}
                      placeholder="client-token da conta Z-API (opcional)"
                      value={form.zapi_client_token}
                      onChange={(e) => setForm((f) => ({ ...f, zapi_client_token: e.target.value }))}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-10 w-10"
                      onClick={() => setShowZapiClientToken(!showZapiClientToken)}
                    >
                      {showZapiClientToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Encontrado em Z-API → Conta → Security. Necessário em algumas contas.
                  </p>
                </div>
              </>
            )}

            {form.provider_type === "meta_cloud" && (
              <>
                <div className="space-y-1.5">
                  <Label>Phone Number ID *</Label>
                  <Input
                    placeholder="ID do número no Meta Business"
                    value={form.meta_phone_number_id}
                    onChange={(e) => setForm((f) => ({ ...f, meta_phone_number_id: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Access Token *</Label>
                  <div className="relative">
                    <Input
                      type={showMetaToken ? "text" : "password"}
                      placeholder="token de acesso Meta"
                      value={form.meta_access_token}
                      onChange={(e) => setForm((f) => ({ ...f, meta_access_token: e.target.value }))}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-10 w-10"
                      onClick={() => setShowMetaToken(!showMetaToken)}
                    >
                      {showMetaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Verify Token *</Label>
                  <div className="relative">
                    <Input
                      type={showMetaVerifyToken ? "text" : "password"}
                      value={form.meta_verify_token}
                      onChange={(e) => setForm((f) => ({ ...f, meta_verify_token: e.target.value }))}
                      placeholder="meu-token-verificacao"
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-10 w-10"
                      onClick={() => setShowMetaVerifyToken(!showMetaVerifyToken)}
                    >
                      {showMetaVerifyToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Token de verificação usado na configuração do webhook da Meta.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>App Secret *</Label>
                  <div className="relative">
                    <Input
                      type={showMetaAppSecret ? "text" : "password"}
                      value={form.meta_app_secret}
                      onChange={(e) => setForm((f) => ({ ...f, meta_app_secret: e.target.value }))}
                      placeholder="app-secret-da-meta"
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-10 w-10"
                      onClick={() => setShowMetaAppSecret(!showMetaAppSecret)}
                    >
                      {showMetaAppSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Chave secreta do App na Meta. Usado para verificar assinaturas de webhooks (X-Hub-Signature-256).
                  </p>
                </div>
              </>
            )}
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
