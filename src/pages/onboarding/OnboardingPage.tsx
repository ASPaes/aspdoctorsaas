import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Loader2, Plus, Pause, Clock, Calendar, Settings2, CheckCircle2, Ban, X, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { NewJourneyModal } from "./NewJourneyModal";
import JourneyDetailSheet from "./JourneyDetailSheet";

interface StageRow {
  id: string;
  pipeline_id: string;
  nome: string;
  slug: string | null;
  position: number;
  cor: string | null;
  is_initial: boolean | null;
  is_final: boolean | null;
}

interface PipelineRow {
  id: string;
  nome: string;
  fase: "onboarding" | "implantacao";
}

interface JourneyRow {
  journey_id: string;
  ticket_id: string | null;
  cliente_id: string | null;
  produto_id: string | null;
  fase_atual: string | null;
  situacao: string | null;
  current_stage_id: string | null;
  stage_nome: string | null;
  stage_fase: string | null;
  assunto: string | null;
  ticket_code: string | null;
  sla_corrido_min: number | null;
  sla_util_min: number | null;
  sla_pausado_min: number | null;
  etapa_atual_min: number | null;
  etapa_semaforo: "verde" | "amarelo" | "vermelho" | "sem_sla" | null;
  go_live_previsto: string | null;
  data_inicio_planejado: string | null;
  onboarding_concluido?: boolean | null;
  sla_onb_util_min?: number | null;
  sla_onb_corrido_min?: number | null;
  cliente_nome?: string | null;
  demand_type_id?: string | null;
  demand_type_nome?: string | null;
  demand_type_cor?: string | null;
  responsavel_user_id?: string | null;
  responsavel_nome?: string | null;
}


const SEMAFORO_COLOR: Record<string, string> = {
  verde: "#22C55E",
  amarelo: "#F59E0B",
  vermelho: "#EF4444",
  sem_sla: "#6B7280",
};

function formatMin(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function OnboardingPage() {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const [fase, setFase] = useState<"onboarding" | "implantacao">("onboarding");
  const [newOpen, setNewOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showConcluded, setShowConcluded] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState<string>("todos");
  const [filtroDemanda, setFiltroDemanda] = useState<string>("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState<string>("todos");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("todos");
  const [periodoEntrada, setPeriodoEntrada] = useState<{ from: Date; to: Date } | null>(null);

  const isSuperAdmin = profile?.is_super_admin === true;

  // Pipelines + stages
  const pipelinesQuery = useQuery({
    queryKey: ["onboarding-pipelines", effectiveTenantId, fase],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, fase")
        .eq("tenant_id", effectiveTenantId)
        .eq("fase", fase);
      if (error) throw error;
      return (data ?? []) as PipelineRow[];
    },
  });

  const pipelineIds = useMemo(() => (pipelinesQuery.data ?? []).map((p) => p.id), [pipelinesQuery.data]);

  const stagesQuery = useQuery({
    queryKey: ["onboarding-stages", effectiveTenantId, pipelineIds.join(",")],
    enabled: isSuperAdmin && !!effectiveTenantId && pipelineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, pipeline_id, nome, slug, position, cor, is_initial, is_final")
        .eq("tenant_id", effectiveTenantId)
        .in("pipeline_id", pipelineIds)
        .order("position");
      if (error) throw error;
      return (data ?? []) as StageRow[];
    },
  });

  // Journeys from view
  const journeysQuery = useQuery({
    queryKey: ["onboarding-journeys", effectiveTenantId, fase],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<JourneyRow>(() => {
        let q = (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("*")
          .eq("tenant_id", effectiveTenantId);
        if (fase === "onboarding") {
          // ativas no onboarding + jornadas cujo onboarding já foi concluído (visível como coluna final)
          q = q.or("stage_fase.eq.onboarding,onboarding_concluido.eq.true");
        } else {
          q = q.eq("stage_fase", fase);
        }
        return q;
      });
      // fetch cliente names
      const clienteIds = Array.from(new Set(rows.map((r) => r.cliente_id).filter(Boolean))) as string[];
      let clienteMap: Record<string, string> = {};
      if (clienteIds.length > 0) {
        const { data } = await supabase
          .from("clientes")
          .select("id, nome_fantasia, razao_social")
          .in("id", clienteIds);
        (data ?? []).forEach((c: any) => {
          clienteMap[c.id] = c.nome_fantasia || c.razao_social || "";
        });
      }
      return rows.map((r) => ({ ...r, cliente_nome: r.cliente_id ? clienteMap[r.cliente_id] ?? null : null }));
    },
  });

  const stages = stagesQuery.data ?? [];
  const journeys = journeysQuery.data ?? [];

  const ONB_DONE_COL_ID = "__onb_concluido__";

  const opcoesResponsavel = useMemo(() => {
    const seen = new Map<string, string>();
    journeys.forEach((j) => {
      if (j.responsavel_user_id && !seen.has(j.responsavel_user_id)) {
        seen.set(j.responsavel_user_id, j.responsavel_nome || "—");
      }
    });
    return Array.from(seen.entries()).map(([id, nome]) => ({ id, nome }));
  }, [journeys]);

  const opcoesDemanda = useMemo(() => {
    const seen = new Map<string, string>();
    journeys.forEach((j) => {
      if (j.demand_type_id && !seen.has(j.demand_type_id)) {
        seen.set(j.demand_type_id, j.demand_type_nome || "—");
      }
    });
    return Array.from(seen.entries()).map(([id, nome]) => ({ id, nome }));
  }, [journeys]);

  const journeysFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return journeys.filter((j) => {
      if (termo) {
        const hay = [j.cliente_nome, j.ticket_code, j.assunto]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(termo)) return false;
      }
      if (filtroResponsavel !== "todos" && j.responsavel_user_id !== filtroResponsavel) return false;
      if (filtroDemanda !== "todos" && j.demand_type_id !== filtroDemanda) return false;
      if (filtroSemaforo !== "todos" && (j.etapa_semaforo ?? "sem_sla") !== filtroSemaforo) return false;
      if (filtroSituacao !== "todos") {
        if (filtroSituacao === "em_andamento") {
          if (j.situacao && j.situacao !== "em_andamento" && j.situacao !== "aberto") return false;
        } else if (j.situacao !== filtroSituacao) return false;
      }
      if (periodoEntrada && j.data_inicio_planejado) {
        const d = new Date(j.data_inicio_planejado).getTime();
        if (d < periodoEntrada.from.getTime() || d > periodoEntrada.to.getTime()) return false;
      } else if (periodoEntrada && !j.data_inicio_planejado) {
        return false;
      }
      return true;
    });
  }, [journeys, busca, filtroResponsavel, filtroDemanda, filtroSemaforo, filtroSituacao, periodoEntrada]);

  function limparFiltros() {
    setBusca("");
    setFiltroResponsavel("todos");
    setFiltroDemanda("todos");
    setFiltroSemaforo("todos");
    setFiltroSituacao("todos");
    setPeriodoEntrada(null);
  }

  const hasFiltros =
    busca.trim() !== "" ||
    filtroResponsavel !== "todos" ||
    filtroDemanda !== "todos" ||
    filtroSemaforo !== "todos" ||
    filtroSituacao !== "todos" ||
    periodoEntrada !== null;

  const journeysByStage = useMemo(() => {
    const m: Record<string, JourneyRow[]> = {};
    stages.forEach((s) => (m[s.id] = []));
    m[ONB_DONE_COL_ID] = [];
    journeysFiltradas.forEach((j) => {
      if (!showConcluded && (j.situacao === "concluido" || j.situacao === "cancelado")) return;
      // Na aba Onboarding, se o onboarding já foi concluído, vai pra coluna final
      if (fase === "onboarding" && j.onboarding_concluido) {
        m[ONB_DONE_COL_ID].push(j);
        return;
      }
      if (j.current_stage_id && m[j.current_stage_id]) m[j.current_stage_id].push(j);
    });
    return m;
  }, [stages, journeysFiltradas, showConcluded, fase]);

  async function handleDrop(journeyId: string, targetStageId: string, fromStageId: string) {
    if (fromStageId === targetStageId) return;
    try {
      const { data, error } = await (supabase.rpc as any)("move_onboarding_stage", {
        p_journey_id: journeyId,
        p_target_stage_id: targetStageId,
        p_completed_checklist_ids: [],
        p_force: false,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        if (res.reason === "checklist_incompleto") {
          toast.error(`Faltam ${res.faltando ?? 0} itens obrigatórios do checklist`);
        } else {
          toast.error(res.message || "Não foi possível mover a jornada");
        }
        return;
      }
      toast.success("Etapa atualizada");
      queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao mover jornada");
    }
  }

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Acesso restrito a super administradores.
      </div>
    );
  }

  const loading = pipelinesQuery.isLoading || stagesQuery.isLoading || journeysQuery.isLoading;

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Onboarding & Implantação</h1>
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
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={showConcluded ? "default" : "outline"} onClick={() => setShowConcluded((v) => !v)}>
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {showConcluded ? "Ocultar concluídas/canceladas" : "Mostrar concluídas/canceladas"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/onboarding-implantacao/config">
              <Settings2 className="h-4 w-4 mr-1" />
              Configurar
            </Link>
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nova jornada
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente, ticket ou assunto..."
            className="h-8 text-xs pl-7"
          />
        </div>
        <Select value={filtroResponsavel} onValueChange={setFiltroResponsavel}>
          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos" className="text-xs">Todos os responsáveis</SelectItem>
            {opcoesResponsavel.map((r) => (
              <SelectItem key={r.id} value={r.id} className="text-xs">{r.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroDemanda} onValueChange={setFiltroDemanda}>
          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Demanda" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos" className="text-xs">Todas as demandas</SelectItem>
            {opcoesDemanda.map((d) => (
              <SelectItem key={d.id} value={d.id} className="text-xs">{d.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroSemaforo} onValueChange={setFiltroSemaforo}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Semáforo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos" className="text-xs">Todos os SLAs</SelectItem>
            <SelectItem value="verde" className="text-xs">🟢 Verde</SelectItem>
            <SelectItem value="amarelo" className="text-xs">🟡 Amarelo</SelectItem>
            <SelectItem value="vermelho" className="text-xs">🔴 Vermelho</SelectItem>
            <SelectItem value="sem_sla" className="text-xs">⚪ Sem SLA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
          <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos" className="text-xs">Todas as situações</SelectItem>
            <SelectItem value="em_andamento" className="text-xs">Em andamento</SelectItem>
            <SelectItem value="parado" className="text-xs">Parado / Pausado</SelectItem>
            <SelectItem value="concluido" className="text-xs">Concluída</SelectItem>
            <SelectItem value="cancelado" className="text-xs">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <DateRangePicker
            dateRange={periodoEntrada ?? { from: new Date(), to: new Date() }}
            onDateRangeChange={setPeriodoEntrada}
            align="start"
          />
          {periodoEntrada && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setPeriodoEntrada(null)} title="Limpar período">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {hasFiltros && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={limparFiltros}>
            <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
          </Button>
        )}
      </div>



      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : stages.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          Nenhum pipeline de {fase} configurado para este tenant.
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex flex-row gap-3 min-h-full pb-2">
            {stages.map((col) => {
              const items = journeysByStage[col.id] ?? [];
              const isOver = dragOverCol === col.id;
              const color = col.cor || "#6B7280";
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverCol(col.id);
                  }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const jid = e.dataTransfer.getData("journeyId");
                    const from = e.dataTransfer.getData("fromStageId");
                    if (jid) handleDrop(jid, col.id, from);
                    setDragOverCol(null);
                  }}
                  className={`flex flex-col min-w-[280px] w-[280px] bg-muted/30 border border-border rounded-lg transition-all ${isOver ? "ring-2" : ""}`}
                  style={isOver ? { boxShadow: `0 0 0 2px ${color}66` } : undefined}
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-xs font-medium truncate">{col.nome}</span>
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {items.length}
                    </Badge>
                  </div>
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
                    {items.length === 0 ? (
                      <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                        Nenhuma jornada
                      </div>
                    ) : (
                      items.map((j) => {
                        const parado = j.situacao === "parado" || j.situacao === "pausado";
                        const concluida = j.situacao === "concluido";
                        const cancelada = j.situacao === "cancelado";
                        const semaforo = (concluida || cancelada) ? "sem_sla" : (j.etapa_semaforo || "sem_sla");
                        return (
                          <div
                            key={j.journey_id}
                            draggable={!parado && !concluida && !cancelada}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("journeyId", j.journey_id);
                              e.dataTransfer.setData("fromStageId", j.current_stage_id ?? "");
                              setDraggingId(j.journey_id);
                            }}
                            onDragEnd={() => setDraggingId(null)}
                            onClick={() => setDetailId(j.journey_id)}
                            className={`bg-card border rounded-md p-2.5 hover:border-primary/40 transition-all cursor-pointer ${
                              draggingId === j.journey_id ? "opacity-40 scale-95" : ""
                            } ${parado ? "opacity-60" : ""} ${concluida ? "opacity-70" : ""} ${cancelada ? "opacity-50" : ""} ${(concluida || cancelada) ? "" : "active:cursor-grabbing"}`}
                            style={
                              concluida
                                ? { borderColor: "#22C55E" }
                                : cancelada
                                ? { borderColor: "hsl(var(--destructive))" }
                                : undefined
                            }
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              {concluida ? (
                                <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: "#22C55E" }} />
                              ) : cancelada ? (
                                <Ban className="h-3 w-3 shrink-0 text-destructive" />
                              ) : (
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ background: SEMAFORO_COLOR[semaforo] }}
                                  title={`SLA: ${semaforo}`}
                                />
                              )}
                              {j.ticket_code && (
                                <span className="font-mono text-[11px] text-primary font-semibold">
                                  {j.ticket_code}
                                </span>
                              )}
                              {cancelada ? (
                                <span className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border-0 text-white bg-destructive">
                                  <Ban className="h-2.5 w-2.5" /> Cancelada
                                </span>
                              ) : concluida ? (
                                <span className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border-0 text-white" style={{ background: "#22C55E" }}>
                                  concluída
                                </span>
                              ) : parado ? (
                                <span className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                  <Pause className="h-2.5 w-2.5" /> pausado
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-foreground line-clamp-2">
                              {j.assunto || "Sem assunto"}
                            </p>
                            {j.cliente_nome && (
                              <p className="text-[11px] text-muted-foreground truncate mt-1">
                                {j.cliente_nome}
                              </p>
                            )}
                            {j.responsavel_nome && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                Resp.: {j.responsavel_nome}
                              </p>
                            )}
                            {j.demand_type_nome && (
                              <span
                                className="inline-flex items-center mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-white"
                                style={{ background: j.demand_type_cor || "#6B7280" }}
                              >
                                {j.demand_type_nome}
                              </span>
                            )}

                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/90 mt-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                SLA {formatMin(j.sla_util_min)}
                              </span>
                              {j.go_live_previsto && (
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(j.go_live_previsto)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
            {fase === "onboarding" && (() => {
              const items = journeysByStage[ONB_DONE_COL_ID] ?? [];
              const doneColor = "#22C55E";
              return (
                <div
                  key={ONB_DONE_COL_ID}
                  className="flex flex-col min-w-[280px] w-[280px] rounded-lg border border-emerald-500/40 bg-emerald-500/5"
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/30 bg-emerald-500/10 rounded-t-lg">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: doneColor }} />
                    <span className="text-xs font-medium truncate text-emerald-700 dark:text-emerald-400">
                      Onboarding concluído
                    </span>
                    <Badge variant="outline" className="ml-auto text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                      {items.length}
                    </Badge>
                  </div>
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
                    {items.length === 0 ? (
                      <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                        Nenhuma jornada
                      </div>
                    ) : (
                      items.map((j) => {
                        const emImplantacao = j.fase_atual === "implantacao";
                        const jornadaConcluida = j.fase_atual === "concluido" || j.situacao === "concluido";
                        const slaOnb = j.sla_onb_util_min ?? j.sla_onb_corrido_min ?? null;
                        return (
                          <div
                            key={j.journey_id}
                            onClick={() => setDetailId(j.journey_id)}
                            className="bg-card border rounded-md p-2.5 cursor-pointer hover:border-emerald-500/60 transition-all"
                            style={{ borderColor: `${doneColor}55` }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: doneColor }} />
                              {j.ticket_code && (
                                <span className="font-mono text-[11px] text-primary font-semibold">
                                  {j.ticket_code}
                                </span>
                              )}
                              <span
                                className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border-0 text-white"
                                style={{ background: jornadaConcluida ? doneColor : "#3B82F6" }}
                              >
                                {jornadaConcluida ? "concluída" : emImplantacao ? "→ em Implantação" : (j.fase_atual ?? "—")}
                              </span>
                            </div>
                            <p className="text-xs text-foreground line-clamp-2">
                              {j.assunto || "Sem assunto"}
                            </p>
                            {j.cliente_nome && (
                              <p className="text-[11px] text-muted-foreground truncate mt-1">
                                {j.cliente_nome}
                              </p>
                            )}
                            {j.demand_type_nome && (
                              <span
                                className="inline-flex items-center mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-white"
                                style={{ background: j.demand_type_cor || "#6B7280" }}
                              >
                                {j.demand_type_nome}
                              </span>
                            )}
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/90 mt-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1" title="SLA do onboarding (congelado)">
                                <Clock className="h-3 w-3" />
                                SLA onb {formatMin(slaOnb)}
                              </span>
                              {j.go_live_previsto && (
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(j.go_live_previsto)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <NewJourneyModal
        open={newOpen}
        onOpenChange={setNewOpen}
        tenantId={effectiveTenantId}
        fase={fase}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
        }}
      />

      <JourneyDetailSheet
        open={!!detailId}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
        journeyId={detailId}
        tenantId={effectiveTenantId}
      />
    </div>
  );
}
