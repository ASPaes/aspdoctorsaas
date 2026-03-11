import { useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Save, Loader2, CheckCircle2, XCircle, Brain } from "lucide-react";

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

const schema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini", "custom"]),
  api_key: z.string().optional(),
  model: z.string().optional(),
  base_url: z.string().url("URL inválida").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function AISettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["ai_settings", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("id, provider, api_key_hint, model, base_url, is_active, updated_at")
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const hasConfig = !!settings;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "openai", api_key: "", model: "", base_url: "" },
  });

  const provider = form.watch("provider");
  const models = MODELS_BY_PROVIDER[provider];

  useEffect(() => {
    if (settings) {
      form.reset({
        provider: (settings.provider as FormValues["provider"]) || "openai",
        api_key: "",
        model: settings.model || "",
        base_url: settings.base_url || "",
      });
    }
  }, [settings]);

  useEffect(() => {
    const sub = form.watch((_, { name }) => {
      if (name === "provider") form.setValue("model", "");
    });
    return () => sub.unsubscribe();
  }, [form]);

  const toggleMutation = useMutation({
    mutationFn: async (newVal: boolean) => {
      const { error } = await supabase
        .from("ai_settings")
        .update({ is_active: newVal })
        .eq("id", settings!.id);
      if (error) throw error;
    },
    onSuccess: (_, newVal) => {
      queryClient.invalidateQueries({ queryKey: ["ai_settings", tid] });
      toast({ title: newVal ? "IA ativada com sucesso" : "IA desativada com sucesso" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const body: Record<string, string | undefined> = {
        provider: values.provider,
        model: values.model || undefined,
        base_url: values.provider === "custom" ? values.base_url || undefined : undefined,
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
      toast({ title: "IA configurada com sucesso!" });
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
                  onCheckedChange={(v) => toggleMutation.mutate(v)}
                  disabled={toggleMutation.isPending}
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span><strong className="text-foreground">Provedor:</strong> {formatProviderLabel(settings.provider)}</span>
                {settings.model && <span><strong className="text-foreground">Modelo:</strong> {settings.model}</span>}
                {settings.api_key_hint && <span><strong className="text-foreground">Chave:</strong> {settings.api_key_hint}</span>}
              </div>

              {settings.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(settings.updated_at))}
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

              <Button type="submit" disabled={saveMutation.isPending} className="w-full">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Salvar configuração
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
