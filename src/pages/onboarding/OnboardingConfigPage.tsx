import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { usePortao } from "@/hooks/usePortao";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Sparkles, LayoutTemplate } from "lucide-react";
import { PipelinesPanel } from "./config/PipelinesPanel";
import { PauseReasonsPanel } from "./config/PauseReasonsPanel";
import { DemandTypesPanel } from "./config/DemandTypesPanel";
import { TrainingTypesPanel } from "./config/TrainingTypesPanel";
import { VendorReturnReasonsPanel } from "./config/VendorReturnReasonsPanel";
import { AccountingFieldsPanel } from "./config/AccountingFieldsPanel";
import { ParticipantRolesPanel } from "./config/ParticipantRolesPanel";
import { DistribuicaoPanel } from "./config/DistribuicaoPanel";
import { PhasesPanel } from "./config/PhasesPanel";
import { IndicatorsPanel } from "./config/IndicatorsPanel";
import { SaleSummaryTemplatesPanel } from "./config/SaleSummaryTemplatesPanel";
import { GenerateOperationAIDialog } from "./config/GenerateOperationAIDialog";
import { ApplyTemplateDialog } from "./config/ApplyTemplateDialog";

export default function OnboardingConfigPage() {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const { canAccess, isLoading: accessLoading } = useOnboardingAccess();
  const phases = useOnboardingPhases(effectiveTenantId, { enabled: canAccess }).data ?? [];
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [tab, setTab] = useState<"jornadas" | "pipelines" | "distribuicao" | "motivos" | "demandas" | "treinos" | "retornos" | "contabilidade" | "papeis" | "indicadores" | "resumo_venda">("pipelines");

  useEffect(() => {
    if (phases.length === 0) { setPhaseId(null); return; }
    if (!phases.some((p) => p.id === phaseId)) setPhaseId(phases[0].id);
  }, [phases, phaseId]);
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const ehAdmin = profile?.role === "admin" || profile?.is_super_admin === true;
  /** "Usar template" e "Gerar com IA" são as duas portas do mesmo poder — montar
   *  a operação de uma vez. Hoje as duas são só de administrador, e continuam
   *  respondendo pela mesma chave. */
  const canGenerateAI = usePortao("onb.cfg.templates", ehAdmin);

  /** As 11 abas. Hoje nenhuma tem restrição de papel: quem abre a tela vê todas,
   *  e é esse o valor com que cada portão nasce. */
  const podeAba = {
    jornadas: usePortao("onb.cfg.jornadas"),
    pipelines: usePortao("onb.cfg.pipelines"),
    distribuicao: usePortao("onb.cfg.distribuicao"),
    motivos: usePortao("onb.cfg.motivos"),
    demandas: usePortao("onb.cfg.demandas"),
    treinos: usePortao("onb.cfg.tipos_treino"),
    papeis: usePortao("onb.cfg.papeis"),
    retornos: usePortao("onb.cfg.retornos"),
    contabilidade: usePortao("onb.cfg.contabilidade"),
    indicadores: usePortao("onb.cfg.indicadores"),
    resumo_venda: usePortao("onb.cfg.resumo_venda"),
  } as const;

  /** Se a aba aberta for negada ao grupo, cair na primeira liberada — senão a
   *  tela abriria com a barra de abas e o corpo vazio. A dependência é a
   *  assinatura das abas (string), não o objeto, que nasce novo a cada render. */
  const ordemAbas = Object.keys(podeAba) as (keyof typeof podeAba)[];
  const assinaturaAbas = ordemAbas.map((k) => (podeAba[k] ? "1" : "0")).join("");
  useEffect(() => {
    if (podeAba[tab]) return;
    const primeira = ordemAbas.find((k) => podeAba[k]);
    if (primeira) setTab(primeira);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaAbas, tab]);






  /** Grupo sem nenhuma aba liberada veria a tela vazia. Diz o motivo. */
  const nenhumaAba = !ordemAbas.some((k) => podeAba[k]);

  if (profileLoading || accessLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso não liberado a este módulo.</div>;
  }

  if (nenhumaAba) {
    return <div className="p-6 text-sm text-muted-foreground">Seu perfil não tem acesso a nenhuma aba da configuração de Implantação.</div>;
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/onboarding-implantacao"><ArrowLeft className="h-4 w-4 mr-1" />Kanban</Link>
          </Button>
          <h1 className="text-lg font-semibold">Configuração · Implantação</h1>
        </div>
        <div className="flex items-center gap-2">
          {canGenerateAI && (
            <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}>
              <LayoutTemplate className="h-4 w-4 mr-1" />
              Usar template
            </Button>
          )}
          {canGenerateAI && (
            <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1" />
              Gerar com IA
            </Button>
          )}
          {tab === "pipelines" && phases.length > 1 && (
            <div className="inline-flex rounded-md border border-border p-0.5 flex-wrap">
              {phases.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPhaseId(p.id)}
                  className={`px-3 py-1 text-xs rounded whitespace-nowrap ${p.id === phaseId ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {p.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 self-start">
          {podeAba.jornadas && <TabsTrigger value="jornadas">Jornadas</TabsTrigger>}
          {podeAba.pipelines && <TabsTrigger value="pipelines">Pipelines & Etapas</TabsTrigger>}
          {podeAba.distribuicao && <TabsTrigger value="distribuicao">Distribuição</TabsTrigger>}
          {podeAba.motivos && <TabsTrigger value="motivos">Motivos de Parada</TabsTrigger>}
          {podeAba.demandas && <TabsTrigger value="demandas">Tipos de demanda</TabsTrigger>}
          {podeAba.treinos && <TabsTrigger value="treinos">Tipos de treino</TabsTrigger>}
          {podeAba.papeis && <TabsTrigger value="papeis">Papéis</TabsTrigger>}
          {podeAba.retornos && <TabsTrigger value="retornos">Retorno ao vendedor</TabsTrigger>}
          {podeAba.contabilidade && <TabsTrigger value="contabilidade">Dados da contabilidade</TabsTrigger>}
          {podeAba.indicadores && <TabsTrigger value="indicadores">Indicadores</TabsTrigger>}
          {podeAba.resumo_venda && <TabsTrigger value="resumo_venda">Resumo da venda</TabsTrigger>}
        </TabsList>

        {podeAba.jornadas && (
          <TabsContent value="jornadas" className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
            <PhasesPanel />
          </TabsContent>
        )}
        {podeAba.pipelines && (
          <TabsContent value="pipelines" className="flex-1 min-h-0 p-4 pt-3">
            <PipelinesPanel phaseId={phaseId} />
          </TabsContent>
        )}
        {podeAba.distribuicao && (
          <TabsContent value="distribuicao" className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
            <DistribuicaoPanel />
          </TabsContent>
        )}
        {podeAba.motivos && (
          <TabsContent value="motivos" className="flex-1 min-h-0 p-4 pt-3">
            <PauseReasonsPanel />
          </TabsContent>
        )}
        {podeAba.demandas && (
          <TabsContent value="demandas" className="flex-1 min-h-0 p-4 pt-3">
            <DemandTypesPanel />
          </TabsContent>
        )}
        {podeAba.treinos && (
          <TabsContent value="treinos" className="flex-1 min-h-0 p-4 pt-3">
            <TrainingTypesPanel />
          </TabsContent>
        )}
        {podeAba.papeis && (
          <TabsContent value="papeis" className="flex-1 min-h-0 p-4 pt-3">
            <ParticipantRolesPanel />
          </TabsContent>
        )}
        {podeAba.retornos && (
          <TabsContent value="retornos" className="flex-1 min-h-0 p-4 pt-3">
            <VendorReturnReasonsPanel />
          </TabsContent>
        )}
        {podeAba.contabilidade && (
          <TabsContent value="contabilidade" className="flex-1 min-h-0 p-4 pt-3">
            <AccountingFieldsPanel />
          </TabsContent>
        )}
        {podeAba.indicadores && (
          <TabsContent value="indicadores" className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
            <IndicatorsPanel />
          </TabsContent>
        )}
        {podeAba.resumo_venda && (
          <TabsContent value="resumo_venda" className="flex-1 min-h-0 p-4 pt-3">
            <SaleSummaryTemplatesPanel />
          </TabsContent>
        )}



      </Tabs>

      <GenerateOperationAIDialog open={aiOpen} onOpenChange={setAiOpen} />
      <ApplyTemplateDialog open={tplOpen} onOpenChange={setTplOpen} />
    </div>
  );
}
