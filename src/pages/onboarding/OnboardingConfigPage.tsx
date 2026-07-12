import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft } from "lucide-react";
import { PipelinesPanel } from "./config/PipelinesPanel";
import { PauseReasonsPanel } from "./config/PauseReasonsPanel";
import { DemandTypesPanel } from "./config/DemandTypesPanel";
import { TrainingTypesPanel } from "./config/TrainingTypesPanel";
import { VendorReturnReasonsPanel } from "./config/VendorReturnReasonsPanel";

type Fase = "onboarding" | "implantacao";

export default function OnboardingConfigPage() {
  const { profile, profileLoading } = useAuth();
  const [fase, setFase] = useState<Fase>("onboarding");
  const [tab, setTab] = useState<"pipelines" | "motivos" | "demandas" | "treinos" | "retornos">("pipelines");






  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile?.is_super_admin) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a super administradores.</div>;
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/onboarding-implantacao"><ArrowLeft className="h-4 w-4 mr-1" />Kanban</Link>
          </Button>
          <h1 className="text-lg font-semibold">Configuração · Onboarding & Implantação</h1>
        </div>
        {tab === "pipelines" && (
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button
              onClick={() => setFase("onboarding")}
              className={`px-3 py-1 text-xs rounded ${fase === "onboarding" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Onboarding
            </button>
            <button
              onClick={() => setFase("implantacao")}
              className={`px-3 py-1 text-xs rounded ${fase === "implantacao" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Implantação
            </button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="pipelines">Pipelines & Etapas</TabsTrigger>
          <TabsTrigger value="motivos">Motivos de Parada</TabsTrigger>
          <TabsTrigger value="demandas">Tipos de demanda</TabsTrigger>
          <TabsTrigger value="treinos">Tipos de treino</TabsTrigger>
          <TabsTrigger value="retornos">Retorno ao vendedor</TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines" className="flex-1 min-h-0 p-4 pt-3">
          <PipelinesPanel fase={fase} />
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
        <TabsContent value="retornos" className="flex-1 min-h-0 p-4 pt-3">
          <VendorReturnReasonsPanel />
        </TabsContent>



      </Tabs>
    </div>
  );
}
