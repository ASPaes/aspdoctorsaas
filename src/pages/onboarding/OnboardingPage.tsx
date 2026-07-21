import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Loader2, Plus, Pause, Clock, Calendar, Settings2, CheckCircle2, Ban, X, Search, GraduationCap, Tag, ChevronDown } from "lucide-react";
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
  position?: number;
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
  pipeline_onboarding_id?: string | null;
  pipeline_implantacao_id?: string | null;
  cliente_unidade_id?: number | null;
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

// cor de texto legível sobre a cor da tag
function readableOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

function formatTrainingDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dia = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${dia} ${hora}`;
}

// treino hoje ou atrasado (America/Sao_Paulo, UTC-3 fixo) => sinaliza com pulse
function isTrainingUrgent(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now() + 24 * 60 * 60 * 1000;
}

export default function OnboardingPage() {
  const { profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const { selectedUnidadeIds, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { canAccess, isLoading: accessLoading } = useOnboardingAccess();
  const queryClient = useQueryClient();
  const [fase, setFase] = useState<"onboarding" | "implantacao">("onboarding");
  const [newOpen, setNewOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState<string>("todos");
  const [filtroDemanda, setFiltroDemanda] = useState<string>("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState<string>("todos");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("todos");
  const [filtroTags, setFiltroTags] = useState<string[]>([]);
  const [periodoEntrada, setPeriodoEntrada] = useState<{ from: Date; to: Date } | null>(null);

  // Pipelines + stages
  const pipelinesQuery = useQuery({
    queryKey: ["onboarding-pipelines", effectiveTenantId, fase],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, fase, position")
        .eq("tenant_id", effectiveTenantId)
        .eq("fase", fase)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as PipelineRow[];
    },
  });

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  useEffect(() => {
    const list = pipelinesQuery.data ?? [];
    if (list.length === 0) { setSelectedPipelineId(null); return; }
    const key = `onb-board-pipeline-${effectiveTenantId}-${fase}`;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    const valid = saved && list.some((p) => p.id === saved);
    setSelectedPipelineId(valid ? saved : list[0].id);
  }, [pipelinesQuery.data, effectiveTenantId, fase]);

  function selectPipeline(id: string) {
    setSelectedPipelineId(id);
    try { window.localStorage.setItem(`onb-board-pipeline-${effectiveTenantId}-${fase}`, id); } catch {}
  }

  const stagesQuery = useQuery({
    queryKey: ["onboarding-stages", effectiveTenantId, selectedPipelineId],
    enabled: canAccess && !!effectiveTenantId && !!selectedPipelineId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, pipeline_id, nome, slug, position, cor, is_initial, is_final")
        .eq("tenant_id", effectiveTenantId)
        .eq("pipeline_id", selectedPipelineId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as StageRow[];
    },
  });

  // Journeys from view
  const journeysQuery = useQuery({
    queryKey: ["onboarding-journeys", effectiveTenantId, fase, viewKey],
    enabled: canAccess && !!effectiveTenantId && unidadeFilterReady,
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
        if (selectedUnidadeIds.length > 0) q = q.in("cliente_unidade_id", selectedUnidadeIds);
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

  // Treinos agendados por jornada — destaque no card da Implantação (data + especialista)
  const trainingsQuery = useQuery({
    queryKey: ["onboarding-board-trainings", effectiveTenantId, fase],
    enabled: canAccess && !!effectiveTenantId && fase === "implantacao",
    queryFn: async () => {
      const rows = await fetchAllRows<any>(() =>
        (supabase.from("onboarding_training_sessions" as any) as any)
          .select("journey_id, agendado_para, conduzido_por")
          .eq("tenant_id", effectiveTenantId)
          .eq("status", "agendado")
          .not("agendado_para", "is", null)
          .order("agendado_para", { ascending: true })
      );
      // treino mais próximo por jornada (rows já vêm em ordem asc)
      const perJourney = new Map<string, { agendado_para: string; conduzido_por: string | null }>();
      for (const r of rows) {
        if (r.journey_id && !perJourney.has(r.journey_id)) {
          perJourney.set(r.journey_id, { agendado_para: r.agendado_para, conduzido_por: r.conduzido_por ?? null });
        }
      }
      // nome do especialista: user_id -> profiles.funcionario_id -> funcionarios.nome
      const userIds = Array.from(new Set(rows.map((r: any) => r.conduzido_por).filter(Boolean))) as string[];
      const nameMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, funcionario_id")
          .in("user_id", userIds);
        const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean) as number[];
        const { data: funcs } = funcIds.length
          ? await supabase.from("funcionarios").select("id, nome").in("id", funcIds)
          : { data: [] as any[] };
        const funcMap = new Map((funcs ?? []).map((f: any) => [f.id, f.nome]));
        (profs ?? []).forEach((p: any) => {
          nameMap.set(p.user_id, (p.funcionario_id ? funcMap.get(p.funcionario_id) : null) || "");
        });
      }
      const result: Record<string, { agendado_para: string; especialista: string | null }> = {};
      perJourney.forEach((v, jid) => {
        result[jid] = {
          agendado_para: v.agendado_para,
          especialista: v.conduzido_por ? (nameMap.get(v.conduzido_por) || null) : null,
        };
      });
      return result;
    },
  });

  const trainingByJourney = trainingsQuery.data ?? {};

  // Tags de controle por jornada (exclusivas de onboarding/implantação).
  const journeyTagsQuery = useQuery({
    queryKey: ["onboarding-journeys-tags", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journey_tags" as any) as any)
        .select("journey_id, tag:tag_id(id, name, color)")
        .eq("tenant_id", effectiveTenantId);
      if (error) throw error;
      return (data ?? []) as Array<{ journey_id: string; tag: { id: string; name: string; color: string } | null }>;
    },
  });

  const availableTagsQuery = useQuery({
    queryKey: ["onboarding-tags-available", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_tags" as any) as any)
        .select("id, name, color")
        .eq("tenant_id", effectiveTenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string }>;
    },
  });

  const tagsByJourney = useMemo(() => {
    const m: Record<string, Array<{ id: string; name: string; color: string }>> = {};
    (journeyTagsQuery.data ?? []).forEach((r) => {
      if (!r.tag) return;
      (m[r.journey_id] ||= []).push(r.tag);
    });
    return m;
  }, [journeyTagsQuery.data]);

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
      if (filtroTags.length > 0) {
        const jt = (tagsByJourney[j.journey_id] ?? []).map((t) => t.id);
        if (!filtroTags.some((id) => jt.includes(id))) return false;
      }
      return true;
    });
  }, [journeys, busca, filtroResponsavel, filtroDemanda, filtroSemaforo, filtroSituacao, periodoEntrada, filtroTags, tagsByJourney]);

  function limparFiltros() {
    setBusca("");
    setFiltroResponsavel("todos");
    setFiltroDemanda("todos");
    setFiltroSemaforo("todos");
    setFiltroSituacao("todos");
    setFiltroTags([]);
    setPeriodoEntrada(null);
  }

  const hasFiltros =
    busca.trim() !== "" ||
    filtroResponsavel !== "todos" ||
    filtroDemanda !== "todos" ||
    filtroSemaforo !== "todos" ||
    filtroSituacao !== "todos" ||
    filtroTags.length > 0 ||
    periodoEntrada !== null;

  const journeysByStage = useMemo(() => {
    const m: Record<string, JourneyRow[]> = {};
    stages.forEach((s) => (m[s.id] = []));
    m[ONB_DONE_COL_ID] = [];
    journeysFiltradas.forEach((j) => {
      if (filtroSituacao === "todos" && (j.situacao === "concluido" || j.situacao === "cancelado")) return;
      const jPipe = fase === "onboarding" ? j.pipeline_onboarding_id : j.pipeline_implantacao_id;
      if (selectedPipelineId && jPipe !== selectedPipelineId) return;
      // Na aba Onboarding, se o onboarding já foi concluído, vai pra coluna final
      if (fase === "onboarding" && j.onboarding_concluido) {
        m[ONB_DONE_COL_ID].push(j);
        return;
      }
      if (j.current_stage_id && m[j.current_stage_id]) m[j.current_stage_id].push(j);
    });
    return m;
  }, [stages, journeysFiltradas, filtroSituacao, fase, selectedPipelineId]);

  async function handleDrop(journeyId: string, targetStageId: string, fromStageId: string) {
    if (fromStageId === targetStageId) return;
    // Soltar na coluna "Onboarding concluído" → conclui o onboarding e vai p/ implantação
    if (targetStageId === ONB_DONE_COL_ID) {
      try {
        const { data, error } = await (supabase.rpc as any)("advance_onboarding_to_implantacao", {
          p_journey_id: journeyId,
          p_force: false,
        });
        if (error) throw error;
        const res = data as any;
        if (res && res.ok === false) {
          toast.error(
            res.reason === "nao_etapa_final" ? "Conclua as etapas do onboarding antes de avançar." :
            res.reason === "nao_em_onboarding" ? "A jornada não está mais em Onboarding." :
            "Não foi possível concluir o onboarding."
          );
          return;
        }
        toast.success("Onboarding concluído — jornada em Implantação.");
        queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
        queryClient.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
        queryClient.invalidateQueries({ queryKey: ["onboarding-stage-history"] });
      } catch (e: any) {
        toast.error(e.message || "Erro ao concluir onboarding");
      }
      return;
    }
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
      queryClient.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-journey-checklist"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-stage-history"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao mover jornada");
    }
  }

  if (profileLoading || accessLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Acesso não liberado a este módulo.
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

      {(pipelinesQuery.data ?? []).length > 1 && (
        <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b border-border bg-background">
          <div className="inline-flex rounded-md border border-border p-0.5 flex-wrap">
            {(pipelinesQuery.data ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => selectPipeline(p.id)}
                className={`px-3 py-1 text-xs rounded ${p.id === selectedPipelineId ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {p.nome}
              </button>
            ))}
          </div>
        </div>
      )}


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
            <SelectItem value="todos" className="text-xs">Ativas (padrão)</SelectItem>
            <SelectItem value="em_andamento" className="text-xs">Em andamento</SelectItem>
            <SelectItem value="parado" className="text-xs">Parado / Pausado</SelectItem>
            <SelectItem value="concluido" className="text-xs">Concluída</SelectItem>
            <SelectItem value="cancelado" className="text-xs">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={`h-8 text-xs gap-1 ${filtroTags.length > 0 ? "border-primary/50 text-primary" : ""}`}>
              <Tag className="h-3.5 w-3.5" />
              {filtroTags.length > 0 ? `${filtroTags.length} tag${filtroTags.length > 1 ? "s" : ""}` : "Tags"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            {(availableTagsQuery.data ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2 py-1.5 text-center">Nenhuma tag criada. Marque em uma jornada.</p>
            ) : (
              <div className="space-y-0.5 max-h-60 overflow-y-auto">
                {(availableTagsQuery.data ?? []).map((t) => {
                  const checked = filtroTags.includes(t.id);
                  return (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => setFiltroTags((prev) => (v ? [...prev, t.id] : prev.filter((x) => x !== t.id)))}
                      />
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                      <span className="text-xs truncate flex-1">{t.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {filtroTags.length > 0 && (
              <>
                <div className="border-t border-border my-1.5" />
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => setFiltroTags([])}>
                  Limpar tags
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>
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
                        const treino = trainingByJourney[j.journey_id];
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
                            {treino && !concluida && !cancelada && (
                              <div
                                className="flex items-center gap-1.5 -mx-2.5 -mt-2.5 mb-2 px-2.5 py-1.5 rounded-t-md text-[10px] font-medium text-white"
                                style={{ background: "linear-gradient(90deg, #0EA5E9, #0284C7)" }}
                                title={`Treino agendado${treino.especialista ? ` · ${treino.especialista}` : ""}`}
                              >
                                <GraduationCap className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  Treino {formatTrainingDateTime(treino.agendado_para)}
                                  {treino.especialista ? ` · ${treino.especialista}` : ""}
                                </span>
                                {isTrainingUrgent(treino.agendado_para) && (
                                  <span className="relative flex h-2 w-2 ml-auto shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                                  </span>
                                )}
                              </div>
                            )}
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

                            {(tagsByJourney[j.journey_id] ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {(tagsByJourney[j.journey_id] ?? []).map((t) => (
                                  <span
                                    key={t.id}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                                    style={{ background: t.color, color: readableOn(t.color) }}
                                  >
                                    {t.name}
                                  </span>
                                ))}
                              </div>
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
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverCol(ONB_DONE_COL_ID);
                  }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const jid = e.dataTransfer.getData("journeyId");
                    const from = e.dataTransfer.getData("fromStageId");
                    if (jid) handleDrop(jid, ONB_DONE_COL_ID, from);
                    setDragOverCol(null);
                  }}
                  className={`flex flex-col min-w-[280px] w-[280px] rounded-lg border border-emerald-500/40 bg-emerald-500/5 transition-all ${dragOverCol === ONB_DONE_COL_ID ? "ring-2 ring-emerald-500/60" : ""}`}
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
                            {(tagsByJourney[j.journey_id] ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {(tagsByJourney[j.journey_id] ?? []).map((t) => (
                                  <span
                                    key={t.id}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                                    style={{ background: t.color, color: readableOn(t.color) }}
                                  >
                                    {t.name}
                                  </span>
                                ))}
                              </div>
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
