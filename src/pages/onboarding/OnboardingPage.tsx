import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pause, Clock, Calendar, Settings2 } from "lucide-react";
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
  cliente_nome?: string | null;
  demand_type_id?: string | null;
  demand_type_nome?: string | null;
  demand_type_cor?: string | null;
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
      const rows = await fetchAllRows<JourneyRow>(() =>
        (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("*")
          .eq("tenant_id", effectiveTenantId)
          .eq("stage_fase", fase)
      );
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

  const journeysByStage = useMemo(() => {
    const m: Record<string, JourneyRow[]> = {};
    stages.forEach((s) => (m[s.id] = []));
    journeys.forEach((j) => {
      if (!showConcluded && j.situacao === "concluido") return;
      if (j.current_stage_id && m[j.current_stage_id]) m[j.current_stage_id].push(j);
    });
    return m;
  }, [stages, journeys, showConcluded]);

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
                        const semaforo = j.etapa_semaforo || "sem_sla";
                        return (
                          <div
                            key={j.journey_id}
                            draggable={!parado}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("journeyId", j.journey_id);
                              e.dataTransfer.setData("fromStageId", j.current_stage_id ?? "");
                              setDraggingId(j.journey_id);
                            }}
                            onDragEnd={() => setDraggingId(null)}
                            onClick={() => setDetailId(j.journey_id)}
                            className={`bg-card border border-border rounded-md p-2.5 hover:border-primary/40 transition-all cursor-pointer ${
                              draggingId === j.journey_id ? "opacity-40 scale-95" : ""
                            } ${parado ? "opacity-60" : "active:cursor-grabbing"}`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: SEMAFORO_COLOR[semaforo] }}
                                title={`SLA: ${semaforo}`}
                              />
                              {j.ticket_code && (
                                <span className="font-mono text-[11px] text-primary font-semibold">
                                  {j.ticket_code}
                                </span>
                              )}
                              {parado && (
                                <span className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                  <Pause className="h-2.5 w-2.5" /> pausado
                                </span>
                              )}
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
