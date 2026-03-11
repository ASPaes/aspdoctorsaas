import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Shield,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
  Upload,
  FileText,
  FlaskConical,
  AlertTriangle,
  Clock,
} from "lucide-react";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "gemini", label: "Google Gemini" },
  { value: "custom", label: "Personalizado" },
] as const;

const MODELS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-5.4", label: "GPT-5.4 — Mais recente" },
    { value: "gpt-5.4-pro", label: "GPT-5.4 Pro — Máxima performance" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5-mini", label: "GPT-5 Mini — Rápido e econômico" },
  ],
  anthropic: [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6 — Mais avançado" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — Equilibrado" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — Rápido e econômico" },
  ],
  gemini: [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro — Mais recente" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash — Rápido" },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite — Econômico" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
};

function formatProviderLabel(provider: string): string {
  return PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
}

const MAX_SYSTEM_PROMPT = 30000;
const TEST_VALIDITY_MINUTES = 30;

const schema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini", "custom"]),
  api_key: z.string().optional(),
  model: z.string().optional(),
  base_url: z.string().url("URL inválida").optional().or(z.literal("")),
  system_prompt: z
    .string()
    .max(MAX_SYSTEM_PROMPT, `Máximo de ${MAX_SYSTEM_PROMPT.toLocaleString("pt-BR")} caracteres`)
    .optional()
    .or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

function isTestRecent(lastTestedAt: string | null): boolean {
  if (!lastTestedAt) return false;
  const diff = Date.now() - new Date(lastTestedAt).getTime();
  return diff < TEST_VALIDITY_MINUTES * 60 * 1000;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default function AISettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [pendingActivation, setPendingActivation] = useState<boolean | null>(null);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["ai_settings", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("id, provider, api_key_hint, model, base_url, is_active, updated_at, system_prompt, last_tested_at, last_test_ok, last_test_error")
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const hasConfig = !!settings;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "openai", api_key: "", model: "", base_url: "", system_prompt: "" },
  });

  const provider = form.watch("provider");
  const systemPromptValue = form.watch("system_prompt") ?? "";
  const models = MODELS_BY_PROVIDER[provider];

  useEffect(() => {
    if (settings) {
      form.reset({
        provider: (settings.provider as FormValues["provider"]) || "openai",
        api_key: "",
        model: settings.model || "",
        base_url: settings.base_url || "",
        system_prompt: settings.system_prompt ?? "",
      });
    }
  }, [settings]);

  useEffect(() => {
    const sub = form.watch((_, { name }) => {
      if (name === "provider") form.setValue("model", "");
    });
    return () => sub.unsubscribe();
  }, [form]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let text = (event.target?.result as string) || "";
      if (text.length > MAX_SYSTEM_PROMPT) {
        text = text.substring(0, MAX_SYSTEM_PROMPT);
        toast({ title: "Conteúdo truncado", description: `O arquivo excedia ${MAX_SYSTEM_PROMPT.toLocaleString("pt-BR")} caracteres e foi truncado.` });
      }
      form.setValue("system_prompt", text, { shouldDirty: true, shouldValidate: true });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // --- Toggle (activate/deactivate) with confirmation ---
  const toggleMutation = useMutation({
    mutationFn: async (newVal: boolean) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");

      const { error } = await supabase
        .from("ai_settings")
        .update({ is_active: newVal })
        .eq("id", settings!.id);
      if (error) throw error;

      // Audit
      await supabase.from("audit_events").insert({
        tenant_id: tid,
        actor_user_id: session.user.id,
        event_type: newVal ? "ai_config_activated" : "ai_config_deactivated",
        metadata: {
          provider: settings?.provider,
          model: settings?.model,
          last_test_ok: settings?.last_test_ok,
        },
      });
    },
    onSuccess: (_, newVal) => {
      queryClient.invalidateQueries({ queryKey: ["ai_settings", tid] });
      toast({ title: newVal ? "IA ativada com sucesso" : "IA desativada com sucesso" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const handleToggleRequest = (newVal: boolean) => {
    if (newVal) {
      // Activating — show confirmation dialog
      setPendingActivation(true);
      setRiskAcknowledged(false);
      setActivateDialogOpen(true);
    } else {
      // Deactivating — direct
      toggleMutation.mutate(false);
    }
  };

  const confirmActivation = () => {
    setActivateDialogOpen(false);
    toggleMutation.mutate(true);
  };

  const testRecentAndOk = settings?.last_test_ok && isTestRecent(settings?.last_tested_at);

  // --- Test mutation ---
  const testMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");

      const { data, error } = await supabase.functions.invoke("test-ai-config", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      return data as { ok: boolean; latency_ms: number; model_used: string; provider_used: string; error_message?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai_settings", tid] });
      if (data.ok) {
        toast({ title: "✅ Configuração validada", description: `Resposta em ${data.latency_ms}ms — Modelo: ${data.model_used}` });
      } else {
        toast({ title: "❌ Teste falhou", description: data.error_message || "Erro desconhecido", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro ao testar", description: err.message, variant: "destructive" });
    },
  });

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const body: Record<string, string | undefined> = {
        provider: values.provider,
        model: values.model || undefined,
        base_url: values.provider === "custom" ? values.base_url || undefined : undefined,
        system_prompt: values.system_prompt || undefined,
      };
      if (values.api_key && values.api_key.length > 0) {
        body.api_key = values.api_key;
      }

      const { data, error } = await supabase.functions.invoke("save-ai-settings", {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_settings", tid] });
      toast({ title: "Configuração salva como rascunho", description: "Use o toggle para ativar a IA após testar." });
      form.setValue("api_key", "");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-lg">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const charCount = systemPromptValue.length;
  const charWarning = charCount >= 27000;

  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>{hasConfig ? "Configuração de IA" : "Inteligência Artificial"}</CardTitle>
          <CardDescription>
            {hasConfig
              ? "Gerencie o provedor de IA e suas credenciais."
              : "Configure um provedor para habilitar funcionalidades inteligentes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Empty state */}
          {!hasConfig && (
            <>
              <div className="flex flex-col items-center text-center gap-3 pb-2">
                <Brain className="h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-semibold">Nenhuma IA configurada</p>
                <p className="text-sm text-muted-foreground">
                  Configure um provedor de IA para habilitar funcionalidades inteligentes como análise de sentimento, resumos e sugestões de resposta.
                </p>
              </div>
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  Sem configuração ativa, todas as funcionalidades de IA ficam desabilitadas.
                </AlertDescription>
              </Alert>
            </>
          )}

          {/* Existing config status */}
          {hasConfig && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {settings.is_active ? (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> IA Ativa
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" /> IA Desativada
                    </Badge>
                  )}
                </div>
                <Switch
                  checked={settings.is_active}
                  onCheckedChange={handleToggleRequest}
                  disabled={toggleMutation.isPending}
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span><strong className="text-foreground">Provedor:</strong> {formatProviderLabel(settings.provider)}</span>
                {settings.model && <span><strong className="text-foreground">Modelo:</strong> {settings.model}</span>}
                {settings.api_key_hint && <span><strong className="text-foreground">Chave:</strong> {settings.api_key_hint}</span>}
              </div>

              {settings.system_prompt ? (
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                    Diretrizes configuradas
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({settings.system_prompt.length.toLocaleString("pt-BR")} caracteres)
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem diretrizes personalizadas</p>
              )}

              {/* Test status */}
              <div className="flex items-center gap-2 text-sm">
                {settings.last_tested_at ? (
                  <>
                    {settings.last_test_ok ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Teste OK
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive text-destructive">
                        <XCircle className="h-3 w-3 mr-1" /> Teste falhou
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(settings.last_tested_at)}
                      {!isTestRecent(settings.last_tested_at) && (
                        <span className="text-amber-600 dark:text-amber-400 ml-1">(expirado)</span>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Nenhum teste realizado</span>
                )}
              </div>

              {settings.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {formatDateTime(settings.updated_at)}
                </p>
              )}

              <Separator />
            </>
          )}

          {/* Form — always visible */}
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              Sua chave de API é armazenada com criptografia e nunca é exibida após salva. Apenas os últimos 4 caracteres ficam visíveis para confirmação.
            </AlertDescription>
          </Alert>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="provider" render={({ field }) => (
                <FormItem>
                  <FormLabel>Provedor</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione o provedor" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="api_key" render={({ field }) => (
                <FormItem>
                  <FormLabel>Chave de API</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={settings?.api_key_hint
                        ? `Chave salva: ${settings.api_key_hint} — deixe em branco para manter`
                        : "Cole sua chave de API aqui"}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {settings?.api_key_hint ? "Deixe em branco para manter a chave atual." : "Obrigatório na primeira configuração."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem>
                  <FormLabel>Modelo</FormLabel>
                  {models ? (
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione o modelo" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {models.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <FormControl><Input placeholder="nome-do-modelo" {...field} /></FormControl>
                  )}
                  <FormDescription>
                    {provider === "custom" ? "Informe o nome do modelo personalizado." : "Selecione o modelo desejado."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              {provider === "custom" && (
                <FormField control={form.control} name="base_url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL Base</FormLabel>
                    <FormControl><Input placeholder="https://sua-api.com/v1" {...field} /></FormControl>
                    <FormDescription>Endpoint da API compatível com OpenAI.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <Separator />

              {/* System Prompt / Diretrizes */}
              <FormField control={form.control} name="system_prompt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Diretrizes da IA (System Prompt)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex: Você é um assistente médico especializado em cardiologia. Sempre responda em português formal..."
                      rows={8}
                      maxLength={MAX_SYSTEM_PROMPT}
                      {...field}
                    />
                  </FormControl>
                  <div className="flex items-center justify-between">
                    <FormDescription>
                      Define o comportamento base da IA em todas as análises.
                    </FormDescription>
                    <span className={`text-xs tabular-nums ${charWarning ? "text-amber-500" : "text-muted-foreground"}`}>
                      {charCount.toLocaleString("pt-BR")} / {MAX_SYSTEM_PROMPT.toLocaleString("pt-BR")} caracteres
                    </span>
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt"
                      hidden
                      onChange={handleFileUpload}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Importar arquivo (.txt)
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Action buttons */}
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button type="submit" disabled={saveMutation.isPending} className="flex-1">
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Salvar configuração
                </Button>
                {hasConfig && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testMutation.isPending || !settings.api_key_hint}
                    onClick={() => testMutation.mutate()}
                  >
                    {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FlaskConical className="h-4 w-4 mr-1" />}
                    Testar configuração
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Activation confirmation dialog */}
      <Dialog open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ativar IA para este tenant?</DialogTitle>
            <DialogDescription>
              Revise as informações abaixo antes de confirmar a ativação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              <span className="text-muted-foreground">Provedor</span>
              <span className="font-medium">{formatProviderLabel(settings?.provider || "")}</span>

              <span className="text-muted-foreground">Modelo</span>
              <span className="font-medium">{settings?.model || "—"}</span>

              <span className="text-muted-foreground">Último teste</span>
              <span className="font-medium">
                {settings?.last_tested_at ? (
                  <span className="flex items-center gap-1">
                    {settings.last_test_ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    {formatDateTime(settings.last_tested_at)}
                  </span>
                ) : (
                  "Nunca testado"
                )}
              </span>

              <span className="text-muted-foreground">Última atualização</span>
              <span className="font-medium">{settings?.updated_at ? formatDateTime(settings.updated_at) : "—"}</span>
            </div>

            {!testRecentAndOk && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  {!settings?.last_tested_at
                    ? "Nenhum teste foi realizado. Recomendamos testar antes de ativar."
                    : !settings?.last_test_ok
                      ? "O último teste falhou. Recomendamos testar novamente."
                      : `O teste foi realizado há mais de ${TEST_VALIDITY_MINUTES} minutos. Recomendamos testar novamente.`}
                </AlertDescription>
              </Alert>
            )}

            {!testRecentAndOk && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="risk-ack"
                  checked={riskAcknowledged}
                  onCheckedChange={(v) => setRiskAcknowledged(v === true)}
                />
                <label htmlFor="risk-ack" className="text-sm text-muted-foreground cursor-pointer leading-tight">
                  Entendo o risco e desejo ativar sem teste recente válido.
                </label>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={confirmActivation}
              disabled={!testRecentAndOk && !riskAcknowledged}
            >
              Confirmar ativação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
