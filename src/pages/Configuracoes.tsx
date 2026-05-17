import { useEffect, useState } from "react";
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
import { Save, Loader2, Plus, Upload, Users, RefreshCw, ChevronRight, Layers, FolderOpen } from "lucide-react";
import ImportModulosModal from "@/components/configuracoes/ImportModulosModal";
import ImportCategoriasModal from "@/components/configuracoes/ImportCategoriasModal";
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
import TicketSettingsTab from "@/components/configuracoes/TicketSettingsTab";
import SettingsSidebar, { CADASTRO_SECTIONS } from "@/components/configuracoes/SettingsSidebar";
import { useSearchParams, useNavigate } from "react-router-dom";
import { SetupGuideCollapsible } from "@/components/configuracoes/whatsapp/SetupGuideCollapsible";
import { InstanceSetupCollapsible } from "@/components/configuracoes/whatsapp/InstanceSetupCollapsible";
import { InstancesList } from "@/components/configuracoes/whatsapp/InstancesList";
import { AddInstanceDialog } from "@/components/configuracoes/whatsapp/AddInstanceDialog";
import { MacrosManager } from "@/components/configuracoes/whatsapp/MacrosManager";
import { AssignmentRulesManager } from "@/components/configuracoes/whatsapp/AssignmentRulesManager";
import AtendimentoCsatTab from "@/components/configuracoes/whatsapp/AtendimentoCsatTab";
import WhatsAppGroupsTab from "@/components/configuracoes/whatsapp/WhatsAppGroupsTab";

import SetoresInstanciasTab from "@/components/configuracoes/whatsapp/SetoresInstanciasTab";
import AISettingsTab from "@/components/configuracoes/AISettingsTab";
import AttendancePauseReasonsTab from "@/components/configuracoes/AttendancePauseReasonsTab";
import KBTab from "@/components/configuracoes/KBTab";
import SecuritySettingsTab from "@/components/configuracoes/whatsapp/SecuritySettingsTab";
import HorarioPlantaoTab from "@/components/configuracoes/HorarioPlantaoTab";
import ClienteImportModal from "@/components/import/ClienteImportModal";
import { DuplicateContactsTab } from "@/components/whatsapp/settings/DuplicateContactsTab";
import CategoriasServicosTab from "@/components/configuracoes/CategoriasServicosTab";

const schema = z.object({
  imposto_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
  custo_fixo_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
});

type FormValues = z.infer<typeof schema>;

const ADMIN_ONLY_SECTIONS = ["acessos", "ia", "horario-plantao"];

const SECTION_META: Record<string, { breadcrumb: string[]; title: string; description: string }> = {
  percentuais: { breadcrumb: ["Financeiro", "Percentuais"], title: "Percentuais", description: "Valores padrão de imposto e custo fixo aplicados a novos clientes." },
  "despesas-cac": { breadcrumb: ["Financeiro", "Despesas CAC"], title: "Despesas CAC", description: "Gerencie as despesas de aquisição de clientes." },
  produtos: { breadcrumb: ["Cadastros", "Comercial", "Produtos"], title: "Produtos", description: "Catálogo de produtos e módulos da operação." },
  fornecedores: { breadcrumb: ["Cadastros", "Comercial", "Fornecedores"], title: "Fornecedores", description: "Fornecedores de software e serviços." },
  "modelos-contrato": { breadcrumb: ["Cadastros", "Comercial", "Modelos de contrato"], title: "Modelos de contrato", description: "Modelos de contrato disponíveis para vendas." },
  "origens-venda": { breadcrumb: ["Cadastros", "Comercial", "Origens de venda"], title: "Origens de venda", description: "Canais e origens de aquisição de clientes." },
  "formas-pagamento": { breadcrumb: ["Cadastros", "Comercial", "Formas de pagamento"], title: "Formas de pagamento", description: "Métodos de pagamento aceitos." },
  setores: { breadcrumb: ["Cadastros", "Operacional", "Setores"], title: "Setores", description: "Setores de atendimento da sua operação." },
  funcionarios: { breadcrumb: ["Cadastros", "Operacional", "Funcionários"], title: "Funcionários", description: "Equipe e colaboradores." },
  "tickets-config": { breadcrumb: ["Cadastros", "Operacional", "Tickets"], title: "Tickets", description: "Status personalizados por setor e tags de classificação." },
  "categorias-servico": { breadcrumb: ["Cadastros", "Serviços", "Categorias"], title: "Categorias de serviço", description: "Categorias e subcategorias para classificação de serviços." },
  "tipos-servico": { breadcrumb: ["Cadastros", "Serviços", "Tipos de serviço"], title: "Tipos de serviço", description: "Tipos de serviço prestados." },
  segmentos: { breadcrumb: ["Cadastros", "Classificação", "Segmentos"], title: "Segmentos", description: "Segmentos de mercado dos clientes." },
  "areas-atuacao": { breadcrumb: ["Cadastros", "Classificação", "Áreas de atuação"], title: "Áreas de atuação", description: "Áreas de atuação dos clientes." },
  "unidades-base": { breadcrumb: ["Cadastros", "Classificação", "Unidades base"], title: "Unidades base", description: "Unidades de medida base usadas no sistema." },
  "motivos-cancelamento": { breadcrumb: ["Cadastros", "Ciclo de vida", "Motivos de cancelamento"], title: "Motivos de cancelamento", description: "Motivos disponíveis para cancelamento de contratos." },
  "motivos-pausa": { breadcrumb: ["Cadastros", "Ciclo de vida", "Motivos de pausa"], title: "Motivos de pausa", description: "Motivos para pausa de atendimentos." },
  acessos: { breadcrumb: ["Equipe", "Acessos & permissões"], title: "Acessos & permissões", description: "Gerencie usuários, papéis e permissões da equipe." },
  whatsapp: { breadcrumb: ["Atendimento", "WhatsApp"], title: "WhatsApp", description: "Configurações de instâncias, atendimento, macros e segurança." },
  ia: { breadcrumb: ["Atendimento", "Inteligência artificial"], title: "Inteligência artificial", description: "Modelos, prompts e comportamento da IA." },
  "horario-plantao": { breadcrumb: ["Atendimento", "Horário & plantão"], title: "Horário & plantão", description: "Horário de atendimento e plantões fora do expediente." },
  kb: { breadcrumb: ["Atendimento", "Base de conhecimento"], title: "Base de conhecimento", description: "Artigos e documentos para suporte ao atendimento." },
  importacao: { breadcrumb: ["Dados", "Importação"], title: "Importação de Dados", description: "Importe sua base de clientes a partir de um arquivo CSV ou planilha." },
};

function WhatsAppSettingsContent({ isAdmin }: { isAdmin?: boolean }) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [whatsappSubTab, setWhatsappSubTab] = useState("setup");

  return (
    <div className="space-y-4">
      <Tabs value={whatsappSubTab} onValueChange={setWhatsappSubTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="instancias">Instâncias</TabsTrigger>
          <TabsTrigger value="grupos">Grupos</TabsTrigger>
          <TabsTrigger value="atendimento">Atendimento / CSAT</TabsTrigger>
          <TabsTrigger value="pausas">Pausas</TabsTrigger>
          <TabsTrigger value="macros">Macros</TabsTrigger>
          <TabsTrigger value="atribuicao">Atribuição</TabsTrigger>
          <TabsTrigger value="setores">Setores</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
          {isAdmin && <TabsTrigger value="ferramentas">Duplicidades</TabsTrigger>}
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <SetupGuideCollapsible />
        </TabsContent>

        <TabsContent value="grupos" className="mt-4">
          <WhatsAppGroupsTab />
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

        <TabsContent value="setores" className="mt-4">
          <SetoresInstanciasTab />
        </TabsContent>

        <TabsContent value="seguranca" className="mt-4">
          <SecuritySettingsTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="ferramentas" className="mt-4">
            <DuplicateContactsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function PercentuaisCard({
  form,
  mutation,
  bulkCustoFixo,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  mutation: ReturnType<typeof useMutation<void, Error, FormValues>>;
  bulkCustoFixo: ReturnType<typeof useMutation<void, Error, void>>;
}) {
  return (
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
                <div className="flex items-center gap-2">
                  <FormControl>
                    <NumericInput value={field.value} onChange={field.onChange} placeholder="8,00" suffix="%" />
                  </FormControl>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={bulkCustoFixo.isPending}>
                              {bulkCustoFixo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Atualizar toda a base?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso irá alterar o Custo Fixo de <strong>todos os clientes</strong> para <strong>{field.value?.toFixed(2).replace(".", ",")}%</strong>. Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => bulkCustoFixo.mutate()}>
                                Confirmar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Aplicar este percentual a todos os clientes</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
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
  );
}

function ImportacaoContent({ onOpen, onOpenModulos, onOpenCategorias }: { onOpen: () => void; onOpenModulos: () => void; onOpenCategorias: () => void }) {
  return (
    <div className="space-y-4 max-w-xl">
      <Card>
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
              <Button onClick={onOpen} className="gap-2 mt-3" size="sm">
                <Upload className="w-4 h-4" />
                Iniciar Importação
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Importar Módulos de Produto</p>
              <p className="text-xs text-muted-foreground">
                Importe módulos em massa via CSV. Selecione o produto e faça upload do arquivo com nome e descrição dos módulos.
              </p>
              <Button onClick={onOpenModulos} className="gap-2 mt-3" size="sm">
                <Upload className="w-4 h-4" />
                Iniciar Importação
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Importar Categorias de Serviço</p>
              <p className="text-xs text-muted-foreground">
                Importe categorias e subcategorias de serviço via CSV. Vincule a um produto ou crie como universal.
              </p>
              <Button onClick={onOpenCategorias} className="gap-2 mt-3" size="sm">
                <Upload className="w-4 h-4" />
                Iniciar Importação
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Configuracoes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;

  const { profile } = useAuth();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importModulosOpen, setImportModulosOpen] = useState(false);
  const [importCategoriasOpen, setImportCategoriasOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (profile && profile.role !== "admin" && !profile.is_super_admin) {
      navigate("/dashboard", { replace: true });
    }
  }, [profile, navigate]);

  const isAdmin = !!(profile?.role === "admin" || profile?.is_super_admin);

  const rawSection = searchParams.get("section") || "percentuais";
  const activeSection = (!isAdmin && ADMIN_ONLY_SECTIONS.includes(rawSection)) ? "percentuais" : rawSection;

  useEffect(() => {
    if (rawSection !== activeSection) {
      setSearchParams({ section: activeSection }, { replace: true });
    }
  }, [rawSection, activeSection, setSearchParams]);

  const handleSectionChange = (section: string) => {
    setSearchParams({ section });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };



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

  const meta = SECTION_META[activeSection] ?? { breadcrumb: [activeSection], title: activeSection, description: "" };

  const renderContent = () => {
    if (activeSection === "categorias-servico") {
      return <CategoriasServicosTab />;
    }
    if (CADASTRO_SECTIONS.includes(activeSection)) {
      return <CadastrosTab section={activeSection} />;
    }
    switch (activeSection) {
      case "percentuais":
        return <PercentuaisCard form={form} mutation={mutation} bulkCustoFixo={bulkCustoFixo} />;
      case "despesas-cac":
        return <CacDespesasTab />;
      case "acessos":
        return isAdmin ? <AcessosEquipeTab /> : null;
      case "whatsapp":
        return <WhatsAppSettingsContent isAdmin={isAdmin} />;
      case "ia":
        return isAdmin ? <AISettingsTab /> : null;
      case "horario-plantao":
        return isAdmin ? <HorarioPlantaoTab /> : null;
      case "kb":
        return <KBTab />;
      case "importacao":
        return (
          <>
            <ImportacaoContent
              onOpen={() => setImportModalOpen(true)}
              onOpenModulos={() => setImportModulosOpen(true)}
            />
            <ClienteImportModal open={importModalOpen} onOpenChange={setImportModalOpen} />
            <ImportModulosModal open={importModulosOpen} onOpenChange={setImportModulosOpen} />
          </>
        );
      case "tickets-config":
        return <TicketSettingsTab />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="mt-1 text-muted-foreground">Percentuais, despesas CAC, cadastros auxiliares, usuários e WhatsApp.</p>
      </div>

      <div className="flex border rounded-lg overflow-hidden bg-background min-h-[600px]">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
          isAdmin={isAdmin}
        />

        <div className="flex-1 p-6 overflow-auto">
          <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            {meta.breadcrumb.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <span className={i === meta.breadcrumb.length - 1 ? "text-foreground" : ""}>{part}</span>
              </span>
            ))}
          </nav>

          <div className="mb-6">
            <h2 className="text-xl font-semibold">{meta.title}</h2>
            {meta.description && (
              <p className="text-sm text-muted-foreground mt-1">{meta.description}</p>
            )}
          </div>

          {renderContent()}
        </div>
      </div>
    </div>
  );
}
