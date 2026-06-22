import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { TempoRealTab } from "@/components/atendimento/TempoRealTab";
import { VelocidadeTab } from "@/components/atendimento/VelocidadeTab";
import { AgentesTab } from "@/components/atendimento/AgentesTab";
import { SatisfacaoTab } from "@/components/atendimento/SatisfacaoTab";
import { VolumeTab } from "@/components/atendimento/VolumeTab";
import { UraTab } from "@/components/atendimento/UraTab";
import { TaxonomiaTab } from "@/components/atendimento/TaxonomiaTab";
import { BacklogTab } from "@/components/atendimento/BacklogTab";
import { CoberturaTab } from "@/components/atendimento/CoberturaTab";
import { ClientesTab } from "@/components/atendimento/ClientesTab";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { AtendimentoFilterProvider, useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { useAtendimentoRealtime } from "@/components/atendimento/useAtendimentoRealtime";
import { MultiSelectFilter } from "@/components/atendimento/MultiSelectFilter";

const ALL = "__all__";
type FiltroConfig = { date: boolean; setor: boolean; agente: boolean; cliente?: boolean };
const FILTROS_POR_ABA: Record<string, FiltroConfig> = {
  velocidade: { date: true, setor: true, agente: true },
  agentes:    { date: true, setor: true, agente: true },
  satisfacao: { date: true, setor: true, agente: true },
  volume:     { date: true, setor: true, agente: true },
  ura:        { date: true, setor: true, agente: false },
  taxonomia:  { date: true, setor: true, agente: true },
  backlog:    { date: true, setor: true, agente: true },
  clientes:   { date: true, setor: false, agente: false, cliente: true },
};

function formatSecondsAgo(seg: number): string {
  if (seg < 5) return "agora";
  if (seg < 60) return `há ${seg}s`;
  const m = Math.floor(seg / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  return `há ${h}h`;
}

function FiltrosGlobais({ cfg }: { cfg: FiltroConfig }) {
  const {
    dateRange,
    setDateRange,
    departmentId,
    setDepartmentId,
    agentId,
    setAgentId,
    setores,
    agentes,
  } = useAtendimentoFilter();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      {cfg.date && (
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
      )}
      {cfg.setor && (
        <Select
          value={departmentId ?? ALL}
          onValueChange={(v) => setDepartmentId(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Setor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os setores</SelectItem>
            {setores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {cfg.agente && (
        <Select
          value={agentId ?? ALL}
          onValueChange={(v) => setAgentId(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Agente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os agentes</SelectItem>
            {agentes.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function AtendimentoDashboardInner() {
  const { isSuperAdmin } = useTenantFilter();
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

      {FILTROS_POR_ABA[tab] && <FiltrosGlobais cfg={FILTROS_POR_ABA[tab]} />}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="tempo-real">Tempo Real</TabsTrigger>
          <TabsTrigger value="velocidade">Velocidade / SLA</TabsTrigger>
          <TabsTrigger value="agentes">Agentes</TabsTrigger>
          <TabsTrigger value="satisfacao">Satisfação</TabsTrigger>
          <TabsTrigger value="volume">Volume</TabsTrigger>
          <TabsTrigger value="ura">URA</TabsTrigger>
          <TabsTrigger value="taxonomia">Taxonomia</TabsTrigger>
          <TabsTrigger value="backlog">Backlog</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="cobertura">Cobertura</TabsTrigger>}
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
        <TabsContent value="ura" className="mt-4">
          <UraTab />
        </TabsContent>
        <TabsContent value="taxonomia" className="mt-4">
          <TaxonomiaTab />
        </TabsContent>
        <TabsContent value="backlog" className="mt-4">
          <BacklogTab />
        </TabsContent>
        <TabsContent value="clientes" className="mt-4">
          <ClientesTab />
        </TabsContent>
        {isSuperAdmin && (
          <TabsContent value="cobertura" className="mt-4">
            <CoberturaTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function AtendimentoDashboard() {
  return (
    <AtendimentoFilterProvider>
      <AtendimentoDashboardInner />
    </AtendimentoFilterProvider>
  );
}
