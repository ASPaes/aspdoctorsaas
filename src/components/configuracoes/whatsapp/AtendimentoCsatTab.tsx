import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const schema = z.object({
  // Atendimento
  support_reopen_window_minutes: z.number().min(1).max(1440),
  support_auto_close_inactivity_minutes: z.number().min(1).max(1440),
  support_send_inactivity_warning: z.boolean(),
  support_inactivity_warning_before_minutes: z.number().min(1).max(60),
  support_inactivity_warning_template: z.string().min(1, "Obrigatório"),
  // CSAT
  support_csat_enabled: z.boolean(),
  support_csat_prompt_template: z.string().min(1, "Obrigatório"),
  support_csat_timeout_minutes: z.number().min(1).max(60),
  support_csat_score_min: z.number().min(0).max(10),
  support_csat_score_max: z.number().min(1).max(10),
  support_csat_reason_threshold: z.number().min(0).max(10),
  support_csat_reason_prompt_template: z.string().min(1, "Obrigatório"),
  support_csat_thanks_template: z.string().min(1, "Obrigatório"),
  // URA
  support_ura_enabled: z.boolean(),
  support_ura_welcome_template: z.string().min(1, "Obrigatório"),
  support_ura_invalid_option_template: z.string().min(1, "Obrigatório"),
  support_ura_timeout_minutes: z.number().min(1).max(60),
  support_ura_default_department_id: z.string().nullable(),
});

type FormValues = z.infer<typeof schema>;

export default function AtendimentoCsatTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      support_reopen_window_minutes: 10,
      support_auto_close_inactivity_minutes: 30,
      support_send_inactivity_warning: true,
      support_inactivity_warning_before_minutes: 5,
      support_inactivity_warning_template: "",
      support_csat_enabled: true,
      support_csat_prompt_template: "",
      support_csat_timeout_minutes: 5,
      support_csat_score_min: 0,
      support_csat_score_max: 5,
      support_csat_reason_threshold: 3,
      support_csat_reason_prompt_template: "",
      support_csat_thanks_template: "",
      support_ura_enabled: false,
      support_ura_welcome_template: "",
      support_ura_invalid_option_template: "",
      support_ura_timeout_minutes: 2,
      support_ura_default_department_id: null,
    },
  });

  // Fetch active departments for the default department selector
  const { data: departments = [] } = useQuery({
    queryKey: ["support_departments_active", tid],
    queryFn: async () => {
      let q = supabase
        .from("support_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!tid,
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ["configuracoes-atendimento", tid],
    queryFn: async () => {
      let q = supabase.from("configuracoes").select(
        "id, support_reopen_window_minutes, support_auto_close_inactivity_minutes, support_send_inactivity_warning, support_inactivity_warning_before_minutes, support_inactivity_warning_template, support_csat_enabled, support_csat_prompt_template, support_csat_timeout_minutes, support_csat_score_min, support_csat_score_max, support_csat_reason_threshold, support_csat_reason_prompt_template, support_csat_thanks_template, support_ura_enabled, support_ura_welcome_template, support_ura_invalid_option_template, support_ura_timeout_minutes, support_ura_default_department_id"
      );
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        support_reopen_window_minutes: config.support_reopen_window_minutes,
        support_auto_close_inactivity_minutes: config.support_auto_close_inactivity_minutes,
        support_send_inactivity_warning: config.support_send_inactivity_warning,
        support_inactivity_warning_before_minutes: config.support_inactivity_warning_before_minutes,
        support_inactivity_warning_template: config.support_inactivity_warning_template,
        support_csat_enabled: config.support_csat_enabled,
        support_csat_prompt_template: config.support_csat_prompt_template,
        support_csat_timeout_minutes: config.support_csat_timeout_minutes,
        support_csat_score_min: config.support_csat_score_min,
        support_csat_score_max: config.support_csat_score_max,
        support_csat_reason_threshold: config.support_csat_reason_threshold,
        support_csat_reason_prompt_template: config.support_csat_reason_prompt_template,
        support_csat_thanks_template: config.support_csat_thanks_template,
        support_ura_enabled: config.support_ura_enabled,
        support_ura_welcome_template: config.support_ura_welcome_template,
        support_ura_invalid_option_template: config.support_ura_invalid_option_template,
        support_ura_timeout_minutes: config.support_ura_timeout_minutes ?? 2,
        support_ura_default_department_id: config.support_ura_default_department_id ?? null,
      });
    }
  }, [config]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!config?.id) throw new Error("Configuração não encontrada");
      const { error } = await supabase
        .from("configuracoes")
        .update(values as any)
        .eq("id", config.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracoes-atendimento"] });
      queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
      toast({ title: "Salvo!", description: "Configurações de atendimento atualizadas." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const csatEnabled = form.watch("support_csat_enabled");
  const warningEnabled = form.watch("support_send_inactivity_warning");
  const uraEnabled = form.watch("support_ura_enabled");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
        {/* ── Atendimento ── */}
        <Card>
          <CardHeader>
            <CardTitle>Ciclo de Vida do Atendimento</CardTitle>
            <CardDescription>
              Controle de reabertura e encerramento automático por inatividade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="support_reopen_window_minutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Janela de reabertura (min)</FormLabel>
                  <FormControl>
                    <NumericInput value={field.value} onChange={field.onChange} placeholder="10" suffix="min" />
                  </FormControl>
                  <FormDescription>Tempo após fechamento em que nova msg do cliente reabre o mesmo atendimento.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="support_auto_close_inactivity_minutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Encerramento por inatividade (min)</FormLabel>
                  <FormControl>
                    <NumericInput value={field.value} onChange={field.onChange} placeholder="30" suffix="min" />
                  </FormControl>
                  <FormDescription>Minutos de inatividade para fechar automaticamente.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <Separator />

            <FormField control={form.control} name="support_send_inactivity_warning" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>Aviso de inatividade</FormLabel>
                  <FormDescription>Enviar aviso antes de encerrar por inatividade.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            {warningEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="support_inactivity_warning_before_minutes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aviso X min antes do encerramento</FormLabel>
                    <FormControl>
                      <NumericInput value={field.value} onChange={field.onChange} placeholder="5" suffix="min" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="support_inactivity_warning_template" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Mensagem de aviso</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="Use {{minutes}} para inserir o tempo restante" />
                    </FormControl>
                    <FormDescription>Variáveis: {"{{minutes}}"}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── CSAT ── */}
        <Card>
          <CardHeader>
            <CardTitle>Pesquisa de Satisfação (CSAT)</CardTitle>
            <CardDescription>
              Pesquisa enviada automaticamente após o encerramento do atendimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField control={form.control} name="support_csat_enabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>CSAT ativo</FormLabel>
                  <FormDescription>Enviar pesquisa de satisfação ao encerrar atendimentos.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            {csatEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField control={form.control} name="support_csat_score_min" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nota mínima</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="0" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="support_csat_score_max" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nota máxima</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="5" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="support_csat_timeout_minutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeout (min)</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="5" suffix="min" />
                      </FormControl>
                      <FormDescription>Tempo para responder a pesquisa.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="support_csat_reason_threshold" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pedir motivo se nota ≤</FormLabel>
                    <FormControl>
                      <NumericInput value={field.value} onChange={field.onChange} placeholder="3" />
                    </FormControl>
                    <FormDescription>Notas iguais ou abaixo deste valor disparam a pergunta de motivo.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <Separator />

                <FormField control={form.control} name="support_csat_prompt_template" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagem de pesquisa</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="Mensagem enviada ao cliente pedindo a nota" />
                    </FormControl>
                    <FormDescription>Variáveis: {"{{customer_name}}"}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="support_csat_reason_prompt_template" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagem pedindo motivo</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} placeholder="Mensagem enviada para pedir o motivo da nota baixa" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="support_csat_thanks_template" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagem de agradecimento</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} placeholder="Mensagem enviada após receber a nota" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}
          </CardContent>
        </Card>

        {/* ── URA ── */}
        <Card>
          <CardHeader>
            <CardTitle>URA (Menu Inicial)</CardTitle>
            <CardDescription>
              Menu de opções enviado automaticamente na primeira mensagem do cliente para roteamento por setor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField control={form.control} name="support_ura_enabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>URA ativa</FormLabel>
                  <FormDescription>Enviar menu de opções automaticamente ao cliente na primeira mensagem.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            {uraEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="support_ura_timeout_minutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeout da URA (min)</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="2" suffix="min" />
                      </FormControl>
                      <FormDescription>Tempo máximo para o cliente responder. Após expirar, encaminha para o setor padrão.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="support_ura_default_department_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setor Padrão (fallback)</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? "none"}
                          onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o setor padrão" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum (usar fallback geral)</SelectItem>
                            {departments.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>Setor para onde encaminhar se o cliente não responder ou a URA expirar.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <Separator />

                <FormField control={form.control} name="support_ura_welcome_template" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagem de boas-vindas</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={4} placeholder="Mensagem com as opções do menu" />
                    </FormControl>
                    <FormDescription>
                      Variáveis: {"{{customer_name}}"}, {"{{options}}"} (lista automática de setores numerados)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="support_ura_invalid_option_template" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagem de opção inválida</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} placeholder="Mensagem quando o cliente envia opção inválida" />
                    </FormControl>
                    <FormDescription>
                      Variáveis: {"{{options}}"} (reenvia a lista de opções)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </form>
    </Form>
  );
}
