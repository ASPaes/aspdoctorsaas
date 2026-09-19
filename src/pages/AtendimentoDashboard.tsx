import { usePermissions } from "@/hooks/usePermissions";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { TempoRealTab } from "@/components/atendimento/TempoRealTab";
import { VelocidadeTab } from "@/components/atendimento/VelocidadeTab";
import { AgentesTab } from "@/components/atendimento/AgentesTab";
import { JornadaTab } from "@/components/atendimento/JornadaTab";
import { SatisfacaoTab } from "@/components/atendimento/SatisfacaoTab";
import { VolumeTab } from "@/components/atendimento/VolumeTab";
import { UraTab } from "@/components/atendimento/UraTab";
import { TaxonomiaTab } from "@/components/atendimento/TaxonomiaTab";
import { ChatsTab } from "@/components/atendimento/ChatsTab";
import { BacklogTab } from "@/components/atendimento/BacklogTab";
import { CoberturaTab } from "@/components/atendimento/CoberturaTab";
import { ClientesTab } from "@/components/atendimento/ClientesTab";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { AtendimentoFilterProvider, useAtendimentoFilter, SEM_CATEGORIA_ID } from "@/contexts/AtendimentoFilterContext";
import { useAtendimentoRealtime } from "@/components/atendimento/useAtendimentoRealtime";
import { MultiSelectFilter } from "@/components/atendimento/MultiSelectFilter";

const ALL = "__all__";
// `plantao` só entra na aba cuja RPC já aceita p_plantao.
//
// Ficam de fora, e não por esquecimento:
//   tempo-real — mostra a fila ABERTA agora, e a classificação de plantão só é
//                gravada no fechamento. Tudo apareceria como comercial.
//   clientes   — o score de risco soma chats + tickets. Os tickets vêm de
//                support_tickets, com mecanismo de horário próprio; filtrar só
//                a metade de chats deixaria "interações" misturando uma parte
//                filtrada com outra inteira e o risco sairia errado.
//   backlog    — não lê support_attendances.
//
// taxonomia (aba Tickets) entra, mas lendo support_tickets.tipo_horario, que é
// o turno gravado no próprio ticket, e não o plantão do atendimento (DEM-0315).
// `categoria`: categoria/subcategoria do ticket (DEM-0315). Só nas abas cujas
// RPCs aceitam p_category_ids: Tickets, Agentes e Chats. Na Chats, a série de
// 12 meses (get_atendimento_chats_timeline) segue sem filtro, como já era com
// data, agente e plantão.
type FiltroConfig = { date: boolean; setor: boolean; agente: boolean; cliente?: boolean; tipo?: boolean; plantao?: boolean; categoria?: boolean };
const FILTROS_POR_ABA: Record<string, FiltroConfig> = {
  "tempo-real": { date: false, setor: false, agente: false, tipo: true },
  velocidade: { date: true, setor: true, agente: true, tipo: true, plantao: true },
  agentes:    { date: true, setor: true, agente: true, tipo: true, plantao: true, categoria: true },
  satisfacao: { date: true, setor: true, agente: true, tipo: true, plantao: true },
  volume:     { date: true, setor: true, agente: true, tipo: true, plantao: true },
  ura:        { date: true, setor: true, agente: false, plantao: true },
  chats:      { date: true, setor: true, agente: true, cliente: true, tipo: true, plantao: true, categoria: true },
  taxonomia:  { date: true, setor: true, agente: true, cliente: true, plantao: true, categoria: true },
  backlog:    { date: true, setor: true, agente: true, cliente: true },
  clientes:   { date: true, setor: false, agente: false, cliente: true },
  // Última aba, depois de Cobertura. Jornada lê support_agent_presence_events,
  // que não sabe de conversa: não há is_group nem classificação de plantão para
  // filtrar. Setor vem da lotação atual do agente (support_department_members),
  // não do atendimento.
  jornada:    { date: true, setor: true, agente: true },
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
    tipoAtendimento,
    setTipoAtendimento,
    plantao,
    setPlantao,
    temHorarioConfigurado,
    setores,
    agentes,
    opcoes,
    segmentoIds, setSegmentoIds,
    areaIds, setAreaIds,
    estadoIds, setEstadoIds,
    cidadeIds, setCidadeIds,
    fornecedorIds, setFornecedorIds,
    produtoIds, setProdutoIds,
    categoryIds, setCategoryIds,
    subcategoryIds, setSubcategoryIds,
    categorias, subcategorias,
  } = useAtendimentoFilter();

  // Com categoria escolhida, só as subcategorias dela; sem, todas agrupadas.
  // "Sem categoria" sozinha não tem subcategoria para escolher.
  const soSemCategoria = categoryIds.length > 0 && categoryIds.every((id) => id === SEM_CATEGORIA_ID);
  const subcategoriasVisiveis = categoryIds.length
    ? subcategorias.filter((s) => categoryIds.includes(s.category_id))
    : subcategorias;

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
      {cfg.tipo && (
        <Select
          value={tipoAtendimento}
          onValueChange={(v) => setTipoAtendimento(v as any)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="group">Grupos</SelectItem>
          </SelectContent>
        </Select>
      )}
      {cfg.plantao && temHorarioConfigurado && (
        <Select value={plantao} onValueChange={(v) => setPlantao(v as any)}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Horário" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os horários</SelectItem>
            <SelectItem value="plantao">Só plantão</SelectItem>
            <SelectItem value="comercial">Só horário padrão</SelectItem>
          </SelectContent>
        </Select>
      )}
      {cfg.categoria && (
        <>
          <MultiSelectFilter
            label="Categoria"
            options={[{ id: SEM_CATEGORIA_ID, nome: "Sem categoria" }, ...categorias]}
            selected={categoryIds}
            onChange={setCategoryIds}
          />
          <MultiSelectFilter
            label="Subcategoria"
            options={subcategoriasVisiveis}
            selected={subcategoryIds}
            onChange={setSubcategoryIds}
            disabled={soSemCategoria}
            title={soSemCategoria ? "Sem categoria não tem subcategoria" : undefined}
          />
        </>
      )}
      {cfg.cliente && (
        <>
          <MultiSelectFilter label="Segmento" options={opcoes.segmentos} selected={segmentoIds} onChange={setSegmentoIds} />
          <MultiSelectFilter label="Área" options={opcoes.areas} selected={areaIds} onChange={setAreaIds} />
          <MultiSelectFilter label="Estado" options={opcoes.estados} selected={estadoIds} onChange={setEstadoIds} />
          <MultiSelectFilter label="Cidade" options={opcoes.cidades} selected={cidadeIds} onChange={setCidadeIds} />
          <MultiSelectFilter label="Fornecedor" options={opcoes.fornecedores} selected={fornecedorIds} onChange={setFornecedorIds} />
          <MultiSelectFilter label="Produto" options={opcoes.produtos} selected={produtoIds} onChange={setProdutoIds} />
        </>
      )}
    </div>
  );
}

function AtendimentoDashboardInner() {
  const { isSuperAdmin } = useTenantFilter();
  const { dataUpdatedAt } = useAtendimentoRealtime();
  const [now, setNow] = useState(() => Date.now());
  const { can } = usePermissions();
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
        {/* Com 12 abas a régua passa de 1073px e cortava a última em notebook
            de 1366 e 1280, sem scrollbar nenhuma: a aba ficava inalcançável.
            Quebrar em duas linhas mantém toda aba visível sem barra de rolagem;
            em tela larga continua em uma linha só. */}
        <TabsList className="h-auto flex-wrap justify-start">
          {can("atd.tempo_real", "view") && (<TabsTrigger value="tempo-real">Tempo Real</TabsTrigger>)}
          {can("atd.velocidade", "view") && (<TabsTrigger value="velocidade">Velocidade / SLA</TabsTrigger>)}
          {can("atd.agentes", "view") && (<TabsTrigger value="agentes">Agentes</TabsTrigger>)}
          {can("atd.satisfacao", "view") && (<TabsTrigger value="satisfacao">Satisfação</TabsTrigger>)}
          {can("atd.volume", "view") && (<TabsTrigger value="volume">Volume</TabsTrigger>)}
          {can("atd.ura", "view") && (<TabsTrigger value="ura">URA</TabsTrigger>)}
          {can("atd.chats", "view") && (<TabsTrigger value="chats">Chats</TabsTrigger>)}
          {can("atd.tickets", "view") && (<TabsTrigger value="taxonomia">Tickets</TabsTrigger>)}
          {can("atd.backlog", "view") && (<TabsTrigger value="backlog">Backlog</TabsTrigger>)}
          {can("atd.clientes", "view") && (<TabsTrigger value="clientes">Clientes</TabsTrigger>)}
          {isSuperAdmin && can("atd.cobertura", "view") && (<TabsTrigger value="cobertura">Cobertura</TabsTrigger>)}
          {can("atd.jornada", "view") && (<TabsTrigger value="jornada">Jornada / Pausas</TabsTrigger>)}
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
        <TabsContent value="chats" className="mt-4">
          <ChatsTab />
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
        <TabsContent value="jornada" className="mt-4">
          <JornadaTab />
        </TabsContent>
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
