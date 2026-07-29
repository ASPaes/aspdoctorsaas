import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Sparkles } from "lucide-react";
import { PipelinesPanel } from "./config/PipelinesPanel";
import { PauseReasonsPanel } from "./config/PauseReasonsPanel";
import { DemandTypesPanel } from "./config/DemandTypesPanel";
import { TrainingTypesPanel } from "./config/TrainingTypesPanel";
import { VendorReturnReasonsPanel } from "./config/VendorReturnReasonsPanel";
import { AccountingFieldsPanel } from "./config/AccountingFieldsPanel";
import { ParticipantRolesPanel } from "./config/ParticipantRolesPanel";
import { DistribuicaoPanel } from "./config/DistribuicaoPanel";
import { PhasesPanel } from "./config/PhasesPanel";
import { GenerateOperationAIDialog } from "./config/GenerateOperationAIDialog";

export default function OnboardingConfigPage() {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const { canAccess, isLoading: accessLoading } = useOnboardingAccess();
  const phases = useOnboardingPhases(effectiveTenantId, { enabled: canAccess }).data ?? [];
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [tab, setTab] = useState<"jornadas" | "pipelines" | "distribuicao" | "motivos" | "demandas" | "treinos" | "retornos" | "contabilidade" | "papeis">("pipelines");

  useEffect(() => {
    if (phases.length === 0) { setPhaseId(null); return; }
    if (!phases.some((p) => p.id === phaseId)) setPhaseId(phases[0].id);
  }, [phases, phaseId]);
  const [aiOpen, setAiOpen] = useState(false);
  const canGenerateAI = profile?.role === "admin" || profile?.is_super_admin === true;






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
          <TabsTrigger value="jornadas">Jornadas</TabsTrigger>
          <TabsTrigger value="pipelines">Pipelines & Etapas</TabsTrigger>
          <TabsTrigger value="distribuicao">Distribuição</TabsTrigger>
          <TabsTrigger value="motivos">Motivos de Parada</TabsTrigger>
          <TabsTrigger value="demandas">Tipos de demanda</TabsTrigger>
          <TabsTrigger value="treinos">Tipos de treino</TabsTrigger>
          <TabsTrigger value="papeis">Papéis</TabsTrigger>
          <TabsTrigger value="retornos">Retorno ao vendedor</TabsTrigger>
          <TabsTrigger value="contabilidade">Dados da contabilidade</TabsTrigger>
        </TabsList>

        <TabsContent value="jornadas" className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
          <PhasesPanel />
        </TabsContent>
        <TabsContent value="pipelines" className="flex-1 min-h-0 p-4 pt-3">
          <PipelinesPanel phaseId={phaseId} />
        </TabsContent>
        <TabsContent value="distribuicao" className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
          <DistribuicaoPanel />
        </TabsContent>
        <TabsContent value="motivos" className="flex-1 min-h-0 p-4 pt-3">
          <PauseReasonsPanel />
        </TabsContent>
        <TabsContent value="demandas" className="flex-1 min-h-0 p-4 pt-3">
          <DemandTypesPanel />
        </TabsContent>
        <TabsContent value="treinos" className="flex-1 min-h-0 p-4 pt-3">
          <TrainingTypesPanel />
        </TabsContent>
        <TabsContent value="papeis" className="flex-1 min-h-0 p-4 pt-3">
          <ParticipantRolesPanel />
        </TabsContent>
        <TabsContent value="retornos" className="flex-1 min-h-0 p-4 pt-3">
          <VendorReturnReasonsPanel />
        </TabsContent>
        <TabsContent value="contabilidade" className="flex-1 min-h-0 p-4 pt-3">
          <AccountingFieldsPanel />
        </TabsContent>



      </Tabs>

      <GenerateOperationAIDialog open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  );
}
