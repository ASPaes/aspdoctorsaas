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
import { Save, Loader2, Upload, Users, RefreshCw, ChevronRight, Layers, FolderOpen, Wrench } from "lucide-react";
import ImportModulosModal from "@/components/configuracoes/ImportModulosModal";
import ImportCategoriasModal from "@/components/configuracoes/ImportCategoriasModal";
import ImportTiposServicoModal from "@/components/configuracoes/ImportTiposServicoModal";
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
import CacDespesasTab from "@/components/configuracoes/CacDespesasTab";
import CadastrosTab from "@/components/configuracoes/CadastrosTab";
import AcessosEquipeTab from "@/components/configuracoes/AcessosEquipeTab";
import TicketSettingsTab from "@/components/configuracoes/TicketSettingsTab";
import SettingsSidebar, { CADASTRO_SECTIONS } from "@/components/configuracoes/SettingsSidebar";
import { useSearchParams, useNavigate } from "react-router-dom";
import CanaisTab from "@/components/configuracoes/whatsapp/CanaisTab";
import { ChatTimezoneSelector } from "@/components/configuracoes/whatsapp/ChatTimezoneSelector";
import { SetupGuideCollapsible } from "@/components/configuracoes/whatsapp/SetupGuideCollapsible";
import DistribuicaoTab from "@/components/configuracoes/whatsapp/DistribuicaoTab";
import OperacaoTab from "@/components/configuracoes/whatsapp/OperacaoTab";
import AISettingsTab from "@/components/configuracoes/AISettingsTab";
import KBTab from "@/components/configuracoes/KBTab";
import SecuritySettingsTab from "@/components/configuracoes/whatsapp/SecuritySettingsTab";
import HorarioPlantaoTab from "@/components/configuracoes/HorarioPlantaoTab";
import ClienteImportModal from "@/components/import/ClienteImportModal";
import { DuplicateContactsTab } from "@/components/whatsapp/settings/DuplicateContactsTab";
import CategoriasServicosTab from "@/components/configuracoes/CategoriasServicosTab";
import PermissoesPapeisContent from "@/components/configuracoes/PermissoesPapeisContent";
import { usePermissions } from "@/hooks/usePermissions";
import AccessDenied from "@/pages/AccessDenied";
import { SECTION_TO_RESOURCE } from "@/components/configuracoes/SettingsSidebar";


const schema = z.object({
  imposto_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
  custo_fixo_percentual: z.number().min(0, "Mínimo 0%").max(100, "Máximo 100%"),
});

type FormValues = z.infer<typeof schema>;



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
  permissoes: { breadcrumb: ["Equipe", "Permissões e papéis"], title: "Permissões e papéis", description: "Configure o que cada papel pode fazer no seu tenant." },

  canais: { breadcrumb: ["Atendimento", "Canais"], title: "Canais", description: "Conexão dos números WhatsApp (Evolution, Z-API, Meta)." },
  distribuicao: { breadcrumb: ["Atendimento", "Distribuição"], title: "Distribuição", description: "Para qual setor e agente cada atendimento é encaminhado." },
  operacao: { breadcrumb: ["Atendimento", "Operação"], title: "Operação", description: "CSAT, pausas, macros e grupos do atendimento." },
  seguranca: { breadcrumb: ["Equipe", "Segurança"], title: "Segurança", description: "Aprovação de novas contas e restrição de domínio de email." },
  duplicidades: { breadcrumb: ["Dados", "Duplicidades"], title: "Duplicidades", description: "Unificação de contatos duplicados." },
  ia: { breadcrumb: ["Atendimento", "Inteligência artificial"], title: "Inteligência artificial", description: "Modelos, prompts e comportamento da IA." },
  "horario-plantao": { breadcrumb: ["Atendimento", "Horário & plantão"], title: "Horário & plantão", description: "Horário de atendimento e plantões fora do expediente." },
  kb: { breadcrumb: ["Atendimento", "Base de conhecimento"], title: "Base de conhecimento", description: "Artigos e documentos para suporte ao atendimento." },
  importacao: { breadcrumb: ["Dados", "Importação"], title: "Importação de Dados", description: "Importe sua base de clientes a partir de um arquivo CSV ou planilha." },
  geral: { breadcrumb: ["Sistema", "Geral"], title: "Geral", description: "Fuso horário e configurações globais do sistema." },
  setup: { breadcrumb: ["Sistema", "Guia de configuração"], title: "Guia de configuração", description: "Passos recomendados para configurar a plataforma." },
};


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

function ImportacaoContent({ onOpen, onOpenModulos, onOpenCategorias, onOpenTipos }: { onOpen: () => void; onOpenModulos: () => void; onOpenCategorias: () => void; onOpenTipos: () => void }) {
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

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
              <Wrench className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Importar Tipos de Serviço</p>
              <p className="text-xs text-muted-foreground">
                Importe tipos de serviço via CSV com código, nome e descrição. Duplicatas são ignoradas automaticamente.
              </p>
              <Button onClick={onOpenTipos} className="gap-2 mt-3" size="sm">
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
  const [importTiposOpen, setImportTiposOpen] = useState(false);
  const navigate = useNavigate();

  const isAdmin = !!(profile?.role === "admin" || profile?.is_super_admin);
  const { can, rbacEnabled, rbacLoading } = usePermissions();
  const canSeeSection = (section: string) => {
    if (!rbacEnabled) return isAdmin;
    const resource = SECTION_TO_RESOURCE[section];
    if (!resource) return isAdmin;
    return can(resource, "view");
  };

  useEffect(() => {
    if (!profile || rbacLoading) return;
    if (!rbacEnabled && !isAdmin) {
      navigate("/dashboard", { replace: true });
    }
  }, [profile, rbacEnabled, rbacLoading, isAdmin, navigate]);

  const rawSection = searchParams.get("section") || "percentuais";
  const activeSection = rawSection;

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
    if (!canSeeSection(activeSection)) return <AccessDenied />;
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
        return <AcessosEquipeTab />;
      case "permissoes":
        return <PermissoesPapeisContent />;

      case "canais":
        return <CanaisTab />;
      case "distribuicao":
        return <DistribuicaoTab />;
      case "operacao":
        return <OperacaoTab />;
      case "seguranca":
        return <SecuritySettingsTab />;
      case "duplicidades":
        return <DuplicateContactsTab />;
      case "ia":
        return <AISettingsTab />;
      case "horario-plantao":
        return <HorarioPlantaoTab />;
      case "kb":
        return <KBTab />;
      case "importacao":
        return (
          <>
            <ImportacaoContent
              onOpen={() => setImportModalOpen(true)}
              onOpenModulos={() => setImportModulosOpen(true)}
              onOpenCategorias={() => setImportCategoriasOpen(true)}
              onOpenTipos={() => setImportTiposOpen(true)}
            />
            <ClienteImportModal open={importModalOpen} onOpenChange={setImportModalOpen} />
            <ImportModulosModal open={importModulosOpen} onOpenChange={setImportModulosOpen} />
            <ImportCategoriasModal open={importCategoriasOpen} onOpenChange={setImportCategoriasOpen} />
            <ImportTiposServicoModal
              open={importTiposOpen}
              onOpenChange={setImportTiposOpen}
              tenantId={tid}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["crud_service_types"] })}
            />
          </>
        );
      case "tickets-config":
        return <TicketSettingsTab />;
      case "geral":
        return <ChatTimezoneSelector />;
      case "setup":
        return <SetupGuideCollapsible />;
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
