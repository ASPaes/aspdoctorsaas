import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Save, Loader2, Plus, Upload, Users, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CacDespesasTab from "@/components/configuracoes/CacDespesasTab";
import CadastrosTab from "@/components/configuracoes/CadastrosTab";
import AcessosEquipeTab from "@/components/configuracoes/AcessosEquipeTab";
import { useSearchParams, useNavigate } from "react-router-dom";
import { SetupGuideCollapsible } from "@/components/configuracoes/whatsapp/SetupGuideCollapsible";
import { InstanceSetupCollapsible } from "@/components/configuracoes/whatsapp/InstanceSetupCollapsible";
import { InstancesList } from "@/components/configuracoes/whatsapp/InstancesList";
import { AddInstanceDialog } from "@/components/configuracoes/whatsapp/AddInstanceDialog";
import { MacrosManager } from "@/components/configuracoes/whatsapp/MacrosManager";
import { AssignmentRulesManager } from "@/components/configuracoes/whatsapp/AssignmentRulesManager";
import AtendimentoCsatTab from "@/components/configuracoes/whatsapp/AtendimentoCsatTab";
import AISettingsTab from "@/components/configuracoes/AISettingsTab";
import AttendancePauseReasonsTab from "@/components/configuracoes/AttendancePauseReasonsTab";
import KBTab from "@/components/configuracoes/KBTab";
import SecuritySettingsTab from "@/components/configuracoes/whatsapp/SecuritySettingsTab";
import HorarioPlantaoTab from "@/components/configuracoes/HorarioPlantaoTab";
import ClienteImportModal from "@/components/import/ClienteImportModal";

const schema = z.object({
  imposto_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
  custo_fixo_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
});

type FormValues = z.infer<typeof schema>;

function WhatsAppSettingsContent() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [whatsappSubTab, setWhatsappSubTab] = useState("setup");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future use
  void 0; // placeholder

  return (
    <div className="space-y-4">
      <Tabs value={whatsappSubTab} onValueChange={setWhatsappSubTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="instancias">Instâncias</TabsTrigger>
          <TabsTrigger value="atendimento">Atendimento / CSAT</TabsTrigger>
          <TabsTrigger value="pausas">Pausas</TabsTrigger>
          <TabsTrigger value="macros">Macros</TabsTrigger>
          <TabsTrigger value="atribuicao">Atribuição</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <SetupGuideCollapsible />
        </TabsContent>

        <TabsContent value="atendimento" className="mt-4">
          <AtendimentoCsatTab />
        </TabsContent>

        <TabsContent value="pausas" className="mt-4">
          <AttendancePauseReasonsTab />
        </TabsContent>

        <TabsContent value="instancias" className="mt-4 space-y-4">
          <InstanceSetupCollapsible onOpenAddDialog={() => setAddDialogOpen(true)} />
          <div className="flex justify-end">
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Nova Instância
            </Button>
          </div>
          <InstancesList />
          <AddInstanceDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
        </TabsContent>

        <TabsContent value="macros" className="mt-4">
          <MacrosManager />
        </TabsContent>

        <TabsContent value="atribuicao" className="mt-4">
          <AssignmentRulesManager />
        </TabsContent>

        <TabsContent value="seguranca" className="mt-4">
          <SecuritySettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Configuracoes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;

  // Auth context for role-based UI
  const { profile } = useAuth();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (profile && profile.role !== "admin" && !profile.is_super_admin) {
      navigate("/dashboard", { replace: true });
    }
  }, [profile, navigate]);

  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;

  const ADMIN_ONLY_TABS = ["acessos", "ia", "usuarios", "horario-plantao"];
  const rawTab = searchParams.get("tab") || "percentuais";
  const defaultTab = (!isAdmin && ADMIN_ONLY_TABS.includes(rawTab)) ? "percentuais" : rawTab;

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

  const bulkCustoFixo = useMutation({
    mutationFn: async () => {
      const valor = form.getValues("custo_fixo_percentual");
      if (valor == null) throw new Error("Preencha o Custo Fixo antes de aplicar.");
      const decimal = valor / 100;
      let q = supabase.from("clientes").update({ custo_fixo_percentual: decimal }).not("id", "is", null);
      if (tid) q = q.eq("tenant_id", tid);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Base atualizada!", description: `Custo Fixo aplicado a todos os clientes.` });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao atualizar base", description: err.message, variant: "destructive" });
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

      <Tabs defaultValue={isAdmin ? defaultTab : "percentuais"}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="percentuais">Percentuais</TabsTrigger>
          <TabsTrigger value="cac">Despesas CAC</TabsTrigger>
          <TabsTrigger value="cadastros">Cadastros</TabsTrigger>
          {isAdmin && <TabsTrigger value="acessos">🔐 Acessos & Equipe</TabsTrigger>}
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          {isAdmin && <TabsTrigger value="ia">Inteligência Artificial</TabsTrigger>}
          {isAdmin && <TabsTrigger value="horario-plantao">Horário & Plantão</TabsTrigger>}
          <TabsTrigger value="kb">Base de Conhecimento</TabsTrigger>
          <TabsTrigger value="importacao">Importação de Dados</TabsTrigger>
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

        {isAdmin && (
          <TabsContent value="acessos">
            <AcessosEquipeTab />
          </TabsContent>
        )}

        <TabsContent value="whatsapp">
          <WhatsAppSettingsContent />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="ia">
            <AISettingsTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="horario-plantao">
            <HorarioPlantaoTab />
          </TabsContent>
        )}

        <TabsContent value="kb">
          <KBTab />
        </TabsContent>
        <TabsContent value="importacao">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Importação de Dados</h2>
                <p className="text-sm text-muted-foreground">
                  Importe sua base de clientes a partir de um arquivo CSV ou planilha.
                </p>
              </div>
            </div>

            <Card className="max-w-xl">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
                    <Users className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">Importar Clientes</p>
                    <p className="text-xs text-muted-foreground">
                      Importe clientes em massa via CSV. Suporte a mapeamento de colunas e criação automática de registros relacionados.
                    </p>
                    <Button onClick={() => setImportModalOpen(true)} className="gap-2 mt-3" size="sm">
                      <Upload className="w-4 h-4" />
                      Iniciar Importação
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <ClienteImportModal open={importModalOpen} onOpenChange={setImportModalOpen} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
