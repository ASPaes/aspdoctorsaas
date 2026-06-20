import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TempoRealTab } from "@/components/atendimento/TempoRealTab";
import { VelocidadeTab } from "@/components/atendimento/VelocidadeTab";
import { AgentesTab } from "@/components/atendimento/AgentesTab";
import { SatisfacaoTab } from "@/components/atendimento/SatisfacaoTab";
import { VolumeTab } from "@/components/atendimento/VolumeTab";
import { useAtendimentoRealtime } from "@/components/atendimento/useAtendimentoRealtime";

function formatSecondsAgo(seg: number): string {
  if (seg < 5) return "agora";
  if (seg < 60) return `há ${seg}s`;
  const m = Math.floor(seg / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  return `há ${h}h`;
}

export default function AtendimentoDashboard() {
  const { dataUpdatedAt } = useAtendimentoRealtime();
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState("tempo-real");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSec = dataUpdatedAt ? Math.max(0, Math.floor((now - dataUpdatedAt) / 1000)) : null;

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Indicadores de atendimento.</p>
        </div>
        {tab === "tempo-real" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span className="font-medium text-foreground">ao vivo</span>
            {ageSec !== null && <span>· atualizado {formatSecondsAgo(ageSec)}</span>}
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="tempo-real">Tempo Real</TabsTrigger>
          <TabsTrigger value="velocidade">Velocidade / SLA</TabsTrigger>
          <TabsTrigger value="agentes">Agentes</TabsTrigger>
          <TabsTrigger value="satisfacao">Satisfação</TabsTrigger>
          <TabsTrigger value="volume">Volume</TabsTrigger>
        </TabsList>
        <TabsContent value="tempo-real" className="mt-4">
          <TempoRealTab />
        </TabsContent>
        <TabsContent value="velocidade" className="mt-4">
          <VelocidadeTab />
        </TabsContent>
        <TabsContent value="agentes" className="mt-4">
          <AgentesTab />
        </TabsContent>
        <TabsContent value="satisfacao" className="mt-4">
          <SatisfacaoTab />
        </TabsContent>
        <TabsContent value="volume" className="mt-4">
          <VolumeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
