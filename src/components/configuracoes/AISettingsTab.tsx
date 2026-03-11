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
import { Shield, Save, Loader2 } from "lucide-react";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "gemini", label: "Google Gemini" },
  { value: "custom", label: "Personalizado" },
] as const;

const MODEL_PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5-20251001",
  gemini: "gemini-1.5-pro",
  custom: "nome-do-modelo",
};

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

  const { data: settings } = useQuery({
    queryKey: ["ai_settings", tid],
    queryFn: async () => {
      let q = supabase
        .from("ai_settings")
        .select("id, provider, api_key_hint, model, base_url, is_active");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "openai", api_key: "", model: "", base_url: "" },
  });

  const provider = form.watch("provider");

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

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

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
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_settings"] });
      toast({ title: "Configurações de IA salvas!", description: "Provedor atualizado com sucesso." });
      form.setValue("api_key", "");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Inteligência Artificial</CardTitle>
        <CardDescription>Configure o provedor de IA para funcionalidades inteligentes do sistema.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            Sua chave de API é armazenada com criptografia e nunca é exibida após salva. Apenas os últimos 4 caracteres ficam visíveis para confirmação.
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="provider" render={({ field }) => (
              <FormItem>
                <FormLabel>Provedor</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o provedor" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
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
                      : "Insira sua chave de API"}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {settings?.api_key_hint
                    ? "Deixe em branco para manter a chave atual."
                    : "Obrigatório na primeira configuração."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="model" render={({ field }) => (
              <FormItem>
                <FormLabel>Modelo</FormLabel>
                <FormControl>
                  <Input placeholder={MODEL_PLACEHOLDERS[provider] || "nome-do-modelo"} {...field} />
                </FormControl>
                <FormDescription>Deixe em branco para usar o modelo padrão do provedor.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />

            {provider === "custom" && (
              <FormField control={form.control} name="base_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>URL Base</FormLabel>
                  <FormControl>
                    <Input placeholder="https://sua-api.com/v1" {...field} />
                  </FormControl>
                  <FormDescription>Endpoint da API compatível com OpenAI.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
