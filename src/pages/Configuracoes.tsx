import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CacDespesasTab from "@/components/configuracoes/CacDespesasTab";
import CadastrosTab from "@/components/configuracoes/CadastrosTab";
import UsuariosTab from "@/components/configuracoes/UsuariosTab";
import AprovacaoAcessosTab from "@/components/configuracoes/AprovacaoAcessosTab";
import WhatsAppInstancesTab from "@/components/configuracoes/WhatsAppInstancesTab";
import { useSearchParams } from "react-router-dom";

const schema = z.object({
  imposto_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
  custo_fixo_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
});

type FormValues = z.infer<typeof schema>;

export default function Configuracoes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "percentuais";
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { imposto_percentual: 13.5, custo_fixo_percentual: 8 },
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ["configuracoes", tid],
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("configuracoes").select("*")).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        imposto_percentual: config.imposto_percentual * 100,
        custo_fixo_percentual: config.custo_fixo_percentual * 100,
      });
    }
  }, [config]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        imposto_percentual: values.imposto_percentual / 100,
        custo_fixo_percentual: values.custo_fixo_percentual / 100,
      };
      if (config?.id) {
        const { error } = await supabase.from("configuracoes").update(payload).eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("configuracoes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
      toast({ title: "Configurações salvas!", description: "Valores atualizados com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full max-w-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="mt-1 text-muted-foreground">Percentuais, despesas CAC, cadastros auxiliares, usuários e WhatsApp.</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="percentuais">Percentuais</TabsTrigger>
          <TabsTrigger value="cac">Despesas CAC</TabsTrigger>
          <TabsTrigger value="cadastros">Cadastros</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="aprovacoes">Aprovação de Acessos</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
        </TabsList>

        <TabsContent value="percentuais">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Percentuais Financeiros</CardTitle>
              <CardDescription>Valores padrão aplicados a novos clientes. Insira o percentual diretamente (ex: 13,5 para 13,5%).</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
                  <FormField control={form.control} name="imposto_percentual" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Imposto %</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="13,50" suffix="%" />
                      </FormControl>
                      <FormDescription>Ex: 13,50 para 13,5%</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="custo_fixo_percentual" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Custo Fixo %</FormLabel>
                      <FormControl>
                        <NumericInput value={field.value} onChange={field.onChange} placeholder="8,00" suffix="%" />
                      </FormControl>
                      <FormDescription>Ex: 8,00 para 8%</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={mutation.isPending}>
                    {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cac">
          <CacDespesasTab />
        </TabsContent>

        <TabsContent value="cadastros">
          <CadastrosTab />
        </TabsContent>

        <TabsContent value="usuarios">
          <UsuariosTab />
        </TabsContent>

        <TabsContent value="aprovacoes">
          <AprovacaoAcessosTab />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppInstancesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
