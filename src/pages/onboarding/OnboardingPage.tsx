import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { useOnboardingBoardRealtime } from "./useOnboardingBoardRealtime";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Loader2, Plus, Pause, Clock, Calendar, Settings2, CheckCircle2, Ban, X, Search, GraduationCap, Tag, ChevronDown, LayoutList } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { NewJourneyModal } from "./NewJourneyModal";
import JourneyDetailSheet from "./JourneyDetailSheet";
import { SaidaSemTreinoDialog } from "./SaidaSemTreinoDialog";
import ImplantacaoBoard, { type TrainingCardRow, type JornadaSemTreino } from "./ImplantacaoBoard";
import AcompanhamentoBoard from "./AcompanhamentoBoard";
import { NewAcompanhamentoModal } from "@/components/tickets/NewAcompanhamentoModal";
import { SupportTicketDetailDialog } from "@/components/tickets/SupportTicketDetailDialog";
import {
  ONB_DONE_COL_ID,
  GOLIVE_JANELA_MS,
  goLiveEmFase,
  montarJornadasPorPipeline,
  somarColunas,
  contarTicketsImplantacao,
} from "./boardTotals";

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
  phase_id: string;
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
  /** Data de abertura da jornada (onboarding_journeys.created_at). Somente leitura. */
  aberta_em: string | null;
  data_inicio_planejado: string | null;
  onboarding_concluido?: boolean | null;
  cliente_nome?: string | null;
  demand_type_id?: string | null;
  demand_type_nome?: string | null;
  demand_type_cor?: string | null;
  responsavel_user_id?: string | null;
  responsavel_nome?: string | null;
  current_phase_id?: string | null;
  cliente_unidade_id?: number | null;
}


const SEMAFORO_COLOR: Record<string, string> = {
  verde: "#22C55E",
  amarelo: "#F59E0B",
  vermelho: "#EF4444",
  sem_sla: "#6B7280",
};

import { formatMinUtil } from "./slaFormat";

/** Duração de CALENDÁRIO (1 dia = 24h). Para minutos de expediente use formatMinUtil. */
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
export function readableOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

export function formatTrainingDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dia = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${dia} ${hora}`;
}

// treino hoje ou atrasado (America/Sao_Paulo, UTC-3 fixo) => sinaliza com pulse
export function isTrainingUrgent(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now() + 24 * 60 * 60 * 1000;
}

export default function OnboardingPage() {
  const { profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const { selectedUnidadeIds, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { canAccess, isLoading: accessLoading } = useOnboardingAccess();
  const queryClient = useQueryClient();
  // Quadro vivo: ação de qualquer usuário (mover etapa, criar jornada, trocar
  // responsável) reaparece aqui em ~1s, sem F5.
  useOnboardingBoardRealtime(effectiveTenantId);
  const phasesQuery = useOnboardingPhases(effectiveTenantId, { enabled: canAccess });
  const phases = phasesQuery.data ?? [];
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [acompTicketId, setAcompTicketId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * Deep-link `/onboarding-implantacao?journey=<id>` — destino do aviso "Nova
   * implantação sob sua responsabilidade". Consome o parâmetro depois de abrir,
   * senão fechar a gaveta e recarregar reabriria a mesma jornada.
   */
  useEffect(() => {
    const id = searchParams.get("journey");
    if (!id) return;
    setDetailId(id);
    const limpo = new URLSearchParams(searchParams);
    limpo.delete("journey");
    setSearchParams(limpo, { replace: true });
  }, [searchParams, setSearchParams]);
  const [newAcompOpen, setNewAcompOpen] = useState(false);
  /** Quando o detalhe é aberto pelo cartão de um treinamento, a tela continua sendo a do
   *  ticket pai, mas o que for feito ali é registrado como partindo deste sub-ticket. */
  const [detailSubTicket, setDetailSubTicket] = useState<{ id: string; code: string | null } | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState<string>("todos");
  const [filtroDemanda, setFiltroDemanda] = useState<string>("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState<string>("todos");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("todos");
  const [filtroTags, setFiltroTags] = useState<string[]>([]);
  const [filtroTipoTreino, setFiltroTipoTreino] = useState<string>("todos");
  const [periodoEntrada, setPeriodoEntrada] = useState<{ from: Date; to: Date } | null>(null);

  // A jornada selecionada e a próxima ativa depois dela (para a coluna de conclusão)
  const phaseAtual = useMemo(() => phases.find((p) => p.id === phaseId) ?? null, [phases, phaseId]);
  const proximaPhase = useMemo(() => {
    if (!phaseAtual) return null;
    const i = phases.findIndex((p) => p.id === phaseAtual.id);
    return i >= 0 && i < phases.length - 1 ? phases[i + 1] : null;
  }, [phases, phaseAtual]);

  // Primeira jornada ativa vira o padrão; com uma jornada só, nenhuma pill é renderizada.
  useEffect(() => {
    if (phases.length === 0) { setPhaseId(null); return; }
    if (!phases.some((p) => p.id === phaseId)) setPhaseId(phases[0].id);
  }, [phases, phaseId]);

  // Pipelines + stages
  const pipelinesQuery = useQuery({
    queryKey: ["onboarding-pipelines", effectiveTenantId, phaseId],
    enabled: canAccess && !!effectiveTenantId && !!phaseId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, phase_id, position")
        .eq("tenant_id", effectiveTenantId)
        .eq("phase_id", phaseId)
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
    const key = `onb-board-pipeline-${effectiveTenantId}-${phaseId}`;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    const valid = saved && list.some((p) => p.id === saved);
    setSelectedPipelineId(valid ? saved : list[0].id);
  }, [pipelinesQuery.data, effectiveTenantId, phaseId]);

  function selectPipeline(id: string) {
    setSelectedPipelineId(id);
    try { window.localStorage.setItem(`onb-board-pipeline-${effectiveTenantId}-${phaseId}`, id); } catch {}
  }

  const pipelines = pipelinesQuery.data ?? [];
  const pipelineIds = useMemo(() => pipelines.map((p) => p.id).sort().join(","), [pipelines]);

  /** Etapas de TODOS os pipelines da fase, não só do selecionado: é o que permite contar
   *  os tickets do pipeline fechado sem abri-lo. O quadro continua recebendo só as do
   *  pipeline atual (`stages`, logo abaixo). De quebra, trocar de pipeline deixou de
   *  refazer requisição — a chave da query não depende mais do selecionado. */
  const stagesQuery = useQuery({
    queryKey: ["onboarding-stages", effectiveTenantId, phaseId, pipelineIds],
    enabled: canAccess && !!effectiveTenantId && pipelines.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, pipeline_id, nome, slug, position, cor, is_initial, is_final")
        .eq("tenant_id", effectiveTenantId)
        .in("pipeline_id", pipelineIds.split(","))
        // Etapa arquivada sai do quadro. A RPC onboarding_stage_remove exige
        // esvaziar a etapa antes de arquivar, então nenhum cartão fica escondido.
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as StageRow[];
    },
  });

  // Journeys from view
  const journeysQuery = useQuery({
    queryKey: ["onboarding-journeys", effectiveTenantId, viewKey],
    enabled: canAccess && !!effectiveTenantId && unidadeFilterReady,
    queryFn: async () => {
      const rows = await fetchAllRows<JourneyRow>(() => {
        // Sem filtro de fase no servidor: a jornada a que cada linha pertence vem de
        // vw_onboarding_journey_phases (journeyPhasesQuery). Isso também derruba o
        // `.or(stage_fase...)` que anulava o índice.
        let q = (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("*")
          .eq("tenant_id", effectiveTenantId);
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

  const stagesDaFase = stagesQuery.data ?? [];
  /** Etapa → pipeline dono. É por aqui que um cartão é atribuído a um pipeline sem
   *  precisar carregar o quadro dele. */
  const pipelinePorEtapa = useMemo(() => {
    const m: Record<string, string> = {};
    stagesDaFase.forEach((s) => { m[s.id] = s.pipeline_id; });
    return m;
  }, [stagesDaFase]);
  const etapasPorPipeline = useMemo(() => {
    const m: Record<string, StageRow[]> = {};
    stagesDaFase.forEach((s) => { (m[s.pipeline_id] ||= []).push(s); });
    return m;
  }, [stagesDaFase]);
  const stages = useMemo(
    () => (selectedPipelineId ? etapasPorPipeline[selectedPipelineId] ?? [] : []),
    [etapasPorPipeline, selectedPipelineId],
  );
  const journeys = journeysQuery.data ?? [];

  // Treinos agendados por jornada — destaque no card da Implantação (data + especialista)
  const trainingsQuery = useQuery({
    queryKey: ["onboarding-board-trainings", effectiveTenantId, phaseAtual?.slug ?? null],
    enabled: canAccess && !!effectiveTenantId && phaseAtual?.slug === "implantacao",
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

  /** Na Implantação o cartão é o sub-ticket de treinamento, não a jornada: cada treino
   *  tem seu responsável e anda pelas etapas no seu ritmo. Um botão devolve a visão
   *  consolidada por ticket pai. */
  const isImplantacao = phaseAtual?.slug === "implantacao";
  // A aba de Acompanhamento tem cartão de TICKET, não de jornada — quadro próprio.
  const isAcompanhamento = phaseAtual?.slug === "acompanhamento";
  const [agrupadoPorTicket, setAgrupadoPorTicket] = useState(false);

  const trainingCardsQuery = useQuery({
    queryKey: ["onboarding-training-cards", effectiveTenantId, viewKey],
    enabled: canAccess && !!effectiveTenantId && isImplantacao && unidadeFilterReady,
    queryFn: async () => {
      const rows = await fetchAllRows<TrainingCardRow>(() => {
        let q = (supabase.from("vw_onboarding_training_cards" as any) as any)
          .select("*")
          .eq("tenant_id", effectiveTenantId);
        if (selectedUnidadeIds.length > 0) q = q.in("cliente_unidade_id", selectedUnidadeIds);
        return q;
      });
      return rows;
    },
  });

  const trainingCards = trainingCardsQuery.data ?? [];

  const opcoesTipoTreino = useMemo(() => {
    const seen = new Map<string, string>();
    trainingCards.forEach((t) => {
      if (t.training_type_id && !seen.has(t.training_type_id)) {
        seen.set(t.training_type_id, t.training_type_nome || "—");
      }
    });
    return Array.from(seen.entries()).map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [trainingCards]);

  // Tags de controle por jornada (exclusivas de onboarding/implantação).
  const journeyTagsQuery = useQuery({
    queryKey: ["onboarding-journeys-tags", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      return await fetchAllRows<{ journey_id: string; tag: { id: string; name: string; color: string } | null }>(
        () => (supabase.from("onboarding_journey_tags" as any) as any)
          .select("journey_id, tag:tag_id(id, name, color)")
          .eq("tenant_id", effectiveTenantId)
          .order("journey_id"),
      );
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

  /** Em que jornada(s) cada journey já esteve, com o pipeline percorrido e se ainda está aberta.
   *  Substitui os campos pipeline_onboarding_id / pipeline_implantacao_id, que só existiam
   *  para duas fases. */
  const journeyPhasesQuery = useQuery({
    queryKey: ["onboarding-journey-phases", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{
        journey_id: string; phase_id: string; pipeline_id: string | null; aberta: boolean;
        sla_util_min: number | null; concluida_em: string | null;
      }>(() =>
        (supabase.from("vw_onboarding_journey_phases" as any) as any)
          .select("journey_id, phase_id, pipeline_id, aberta, sla_util_min, concluida_em")
          .eq("tenant_id", effectiveTenantId),
      );
      const m: Record<string, Record<string, { pipeline_id: string | null; aberta: boolean; sla_util_min: number | null; concluida_em: string | null }>> = {};
      rows.forEach((r) => {
        (m[r.journey_id] ||= {})[r.phase_id] = {
          pipeline_id: r.pipeline_id, aberta: r.aberta, sla_util_min: r.sla_util_min,
          concluida_em: r.concluida_em,
        };
      });
      return m;
    },
  });
  const phasesByJourney = journeyPhasesQuery.data ?? {};

  /** A passagem desta jornada por ESTA fase — pipeline percorrido, se ainda está aberta e
   *  quando encerrou. É a fonte de tudo que é "por fase" na tela. */
  function passagemDaFase(journeyId: string) {
    return phaseId ? phasesByJourney[journeyId]?.[phaseId] : undefined;
  }

  function goLiveEm(journeyId: string, situacao: string | null): number | null {
    return goLiveEmFase(passagemDaFase(journeyId), situacao);
  }

  /** Em qual pipeline desta fase a jornada está. É a chave que separa "Implantação PDV"
   *  de "Implantação Gula" sem depender das etapas carregadas no quadro. */
  function pipelineDaJornada(journeyId: string): string | null {
    return passagemDaFase(journeyId)?.pipeline_id ?? null;
  }

  /** Treinos que estão no quadro da fase INTEIRA (todos os pipelines). O quadro consome
   *  o recorte do pipeline aberto (`trainingCardsFiltrados`); o total de cada pipeline
   *  sai daqui. Uma lista só, um filtro só — os dois números não têm como divergir. */
  const treinosNaFase = useMemo(() => {
    if (!isImplantacao) return [] as TrainingCardRow[];
    const termo = busca.trim().toLowerCase();
    const stageIds = new Set(stagesDaFase.map((s) => s.id));
    const agora = Date.now();
    return trainingCards.filter((t) => {
      // Cancelado ANTES de a jornada chegar na Implantação não existe aqui — nem no
      // quadro, nem no agrupado. Fica só no histórico da jornada.
      if (t.status === "cancelado" && !t.cancelado_na_implantacao) return false;
      // Cancelado dentro da Implantação não ocupa coluna, mas aparece riscado no
      // agrupado — é lá que o gestor enxerga o que foi descartado.
      if (t.status !== "cancelado" && (!t.current_stage_id || !stageIds.has(t.current_stage_id))) return false;

      const golive = goLiveEm(t.journey_id, t.journey_situacao);
      if (filtroSituacao !== "todos") {
        // Situação escolhida à mão continua mandando, inclusive fora da janela.
        if (filtroSituacao === "em_andamento") {
          if (t.journey_situacao && t.journey_situacao !== "em_andamento" && t.journey_situacao !== "aberto") return false;
        } else if (t.journey_situacao !== filtroSituacao) return false;
      } else if (golive !== null) {
        // Implantação encerrada: fica na etapa final por 30 dias. Buscar derruba a
        // janela — é assim que se audita um go-live de dois meses atrás.
        if (!termo && agora - golive > GOLIVE_JANELA_MS) return false;
      } else if (t.journey_situacao === "concluido" || t.journey_situacao === "cancelado") {
        return false;
      }

      if (filtroResponsavel !== "todos" && t.conduzido_por !== filtroResponsavel) return false;
      if (filtroTipoTreino !== "todos" && t.training_type_id !== filtroTipoTreino) return false;
      // A tag de controle mora na JORNADA e o cartão da Implantação é o treinamento.
      // Sem esta linha o filtro de tag só alcançava a jornada sem treino nenhum — o
      // quadro inteiro ignorava a tag marcada dentro do ticket.
      if (filtroTags.length > 0) {
        const tags = tagsByJourney[t.journey_id] ?? [];
        if (!tags.some((tag) => filtroTags.includes(tag.id))) return false;
      }
      if (termo) {
        const hay = [t.cliente_nome, t.ticket_code, t.parent_ticket_code, t.titulo, t.conduzido_por_nome]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(termo)) return false;
      }
      return true;
    });
  }, [isImplantacao, trainingCards, stagesDaFase, busca, filtroResponsavel, filtroSituacao, filtroTipoTreino, filtroTags, tagsByJourney, phasesByJourney, phaseId]);

  /** Recorte do pipeline aberto — é o que o quadro renderiza.
   *  O treino cancelado não tem etapa para consultar, então quem diz o pipeline dele é a
   *  jornada. Antes o cancelado escapava do recorte e um descarte do Gula aparecia na
   *  visão agrupada do PDV. */
  const trainingCardsFiltrados = useMemo(
    () => treinosNaFase.filter((t) => pipelineDaJornada(t.journey_id) === selectedPipelineId),
    [treinosNaFase, selectedPipelineId, phasesByJourney, phaseId],
  );

  /** Data do go-live por jornada — é o que manda o cartão para a coluna de conclusão.
   *  Sai de `journeys`, não dos cartões filtrados, porque uma jornada pode ter encerrado
   *  sem nenhum treinamento e mesmo assim precisa aparecer lá. É um superconjunto de
   *  propósito: só é consultado para linha que já passou pelo filtro. */
  const goLivePorJornada = useMemo(() => {
    const m: Record<string, string> = {};
    if (!isImplantacao) return m;
    journeys.forEach((j) => {
      const ts = goLiveEm(j.journey_id, j.situacao ?? null);
      if (ts !== null) m[j.journey_id] = new Date(ts).toISOString();
    });
    return m;
  }, [isImplantacao, journeys, phasesByJourney, phaseId]);

  /** Na Implantação quem importa é quem CONDUZ o treinamento, não o responsável da
   *  jornada — era exatamente esse o furo: um especialista com seis treinamentos
   *  marcados não se achava no filtro porque a jornada tinha outro dono. */
  const opcoesResponsavel = useMemo(() => {
    const seen = new Map<string, string>();
    if (isImplantacao) {
      trainingCards.forEach((t) => {
        if (t.conduzido_por && !seen.has(t.conduzido_por)) {
          seen.set(t.conduzido_por, t.conduzido_por_nome || "—");
        }
      });
    }
    journeys.forEach((j) => {
      if (j.responsavel_user_id && !seen.has(j.responsavel_user_id)) {
        seen.set(j.responsavel_user_id, j.responsavel_nome || "—");
      }
    });
    return Array.from(seen.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [journeys, trainingCards, isImplantacao]);

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

  /** Jornada que já entrou na Implantação e ainda não tem treinamento nenhum.
   *  Sem isto ela sumiria do quadro ao trocar cartão de jornada por cartão de treino. */
  const jornadasSemTreinoNaFase = useMemo<JornadaSemTreino[]>(() => {
    if (!isImplantacao) return [];
    const comTreino = new Set(trainingCards.map((t) => t.journey_id));
    const stageIds = new Set(stagesDaFase.map((s) => s.id));
    return journeysFiltradas
      .filter((j) => !comTreino.has(j.journey_id))
      .filter((j) => {
        const golive = goLiveEm(j.journey_id, j.situacao ?? null);
        // Encerrada a Implantação, a jornada vai para a coluna de conclusão — e aí a
        // etapa atual dela já pode ser de outro pipeline (Acompanhamento). Exigir que
        // a etapa esteja neste quadro sumiria justamente com quem deu go-live.
        if (golive !== null) {
          if (filtroSituacao !== "todos") return true;
          return !!busca.trim() || Date.now() - golive <= GOLIVE_JANELA_MS;
        }
        if (!j.current_stage_id || !stageIds.has(j.current_stage_id)) return false;
        if (filtroSituacao !== "todos") return true;
        return j.situacao !== "concluido" && j.situacao !== "cancelado";
      })
      .map((j) => ({
        journey_id: j.journey_id,
        ticket_code: j.ticket_code,
        cliente_nome: j.cliente_nome ?? null,
        current_stage_id: j.current_stage_id,
        responsavel_nome: j.responsavel_nome ?? null,
        demand_type_nome: j.demand_type_nome ?? null,
        demand_type_cor: j.demand_type_cor ?? null,
      }));
  }, [isImplantacao, trainingCards, journeysFiltradas, stagesDaFase, filtroSituacao, busca, phasesByJourney, phaseId]);

  const jornadasSemTreino = useMemo(
    () => jornadasSemTreinoNaFase.filter((j) => pipelineDaJornada(j.journey_id) === selectedPipelineId),
    [jornadasSemTreinoNaFase, selectedPipelineId, phasesByJourney, phaseId],
  );

  /** Implantação concluída que só está na tela porque há busca — fora da janela padrão. */
  const goLiveForaDaJanela = useMemo(() => {
    if (!isImplantacao || !busca.trim() || filtroSituacao !== "todos") return 0;
    const agora = Date.now();
    const ids = new Set<string>();
    const marcar = (journeyId: string) => {
      const ts = goLivePorJornada[journeyId];
      if (ts && agora - new Date(ts).getTime() > GOLIVE_JANELA_MS) ids.add(journeyId);
    };
    trainingCardsFiltrados.forEach((t) => marcar(t.journey_id));
    jornadasSemTreino.forEach((j) => marcar(j.journey_id));
    return ids.size;
  }, [isImplantacao, trainingCardsFiltrados, jornadasSemTreino, goLivePorJornada, busca, filtroSituacao]);

  function limparFiltros() {
    setBusca("");
    setFiltroResponsavel("todos");
    setFiltroDemanda("todos");
    setFiltroSemaforo("todos");
    setFiltroSituacao("todos");
    setFiltroTags([]);
    setFiltroTipoTreino("todos");
    setPeriodoEntrada(null);
  }

  const hasFiltros =
    busca.trim() !== "" ||
    filtroResponsavel !== "todos" ||
    filtroDemanda !== "todos" ||
    filtroSemaforo !== "todos" ||
    filtroSituacao !== "todos" ||
    filtroTags.length > 0 ||
    filtroTipoTreino !== "todos" ||
    periodoEntrada !== null;

  /** Um mapa etapa→cartões POR pipeline, montado numa passada só. O quadro usa o do
   *  pipeline aberto; o total de cada pipeline é a soma das colunas do seu mapa — mesma
   *  função, então o número do cabeçalho não tem como discordar dos badges das colunas. */
  const journeysByStagePorPipeline = useMemo(
    () =>
      montarJornadasPorPipeline<JourneyRow>({
        jornadas: journeysFiltradas,
        pipelineIds: pipelines.map((p) => p.id),
        etapasPorPipeline,
        passagemDaFase,
        seguiuAdiante: (id) => !!proximaPhase && !!phasesByJourney[id]?.[proximaPhase.id],
        filtroSituacao,
        temBusca: busca.trim() !== "",
        agora: Date.now(),
      }),
    [pipelines, etapasPorPipeline, journeysFiltradas, filtroSituacao, phaseId, phasesByJourney, proximaPhase, busca],
  );

  const journeysByStage = useMemo<Record<string, JourneyRow[]>>(
    () => (selectedPipelineId ? journeysByStagePorPipeline[selectedPipelineId] ?? {} : {}),
    [journeysByStagePorPipeline, selectedPipelineId],
  );

  /** Total de TICKETS EM ANDAMENTO de cada pipeline, com os filtros ativos.
   *  A coluna de conclusão fica DE FORA nas duas fases (decisão do owner, 25/08): ela
   *  guarda 30 dias de encerrados e sozinha respondia por 61 dos 86 do Onboarding PDV —
   *  o total não dizia mais nada sobre o que a equipe tem para tocar.
   *  No Onboarding o cartão É o ticket, então bate com a soma das colunas ABERTAS.
   *  Na Implantação o cartão é o treinamento: um ticket com 3 treinos ocupa 3 colunas, e
   *  somar cartão diria 73 onde existem 44 clientes. Por isso o ticket conta uma vez só —
   *  o número ao lado do pipeline é menor que a soma dos badges das colunas de propósito.
   *  O Acompanhamento tem quadro próprio e informa o dele por callback. */
  const totaisPorPipeline = useMemo<Record<string, number>>(() => {
    if (isAcompanhamento) return {};
    const pipelineIds = pipelines.map((p) => p.id);
    if (isImplantacao) {
      return contarTicketsImplantacao({
        treinos: treinosNaFase,
        jornadasSemTreino: jornadasSemTreinoNaFase,
        pipelineIds,
        pipelineDaJornada,
        // Mesma regra que manda o cartão para a coluna "Implantação concluída".
        concluida: (journeyId) => !!goLivePorJornada[journeyId],
      });
    }
    const out: Record<string, number> = {};
    pipelineIds.forEach(
      (pid) => (out[pid] = somarColunas(journeysByStagePorPipeline[pid], [ONB_DONE_COL_ID])),
    );
    return out;
  }, [isAcompanhamento, isImplantacao, pipelines, treinosNaFase, jornadasSemTreinoNaFase, goLivePorJornada, journeysByStagePorPipeline, phasesByJourney, phaseId]);

  /** O quadro de Acompanhamento busca os próprios tickets — o total dele só pode vir de lá. */
  const [totalAcompanhamento, setTotalAcompanhamento] = useState(0);

  /** `null` = número desconhecido, e aí nada é mostrado em vez de um chute. Acontece
   *  enquanto o quadro carrega (senão o badge pisca "0" e depois corrige) e no
   *  Acompanhamento, cujo quadro só sabe informar o total do pipeline aberto. */
  function totalDoPipeline(pipelineId: string, carregando: boolean): number | null {
    if (carregando) return null;
    if (isAcompanhamento) return pipelineId === selectedPipelineId ? totalAcompanhamento : null;
    return totaisPorPipeline[pipelineId] ?? 0;
  }

  /** DEM-0269: soltar na coluna de conclusão é a MESMA saída do botão Go-live e passa
   *  pela mesma regra. Sem treino, a RPC recusa e a resposta abre o diálogo das duas
   *  saídas — antes esse arrasto mandava direto para a Implantação, apesar de a coluna
   *  se chamar "Onboarding concluído". */
  const [saidaSemTreino, setSaidaSemTreino] = useState<string | null>(null);

  function invalidarQuadro() {
    queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-journey-phases"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-stage-history"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
  }

  async function avancarJornada(journeyId: string, semTreinoOk: boolean) {
    try {
      const { data, error } = await (supabase.rpc as any)("advance_onboarding_to_implantacao", {
        p_journey_id: journeyId,
        p_force: false,
        p_sem_treino_ok: semTreinoOk,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        if (res.reason === "sem_treino") {
          setSaidaSemTreino(journeyId);
          return;
        }
        toast.error(
          res.reason === "nao_etapa_final" ? "Conclua as etapas do onboarding antes de avançar." :
          res.reason === "nao_em_onboarding" ? "A jornada não está mais em Onboarding." :
          "Não foi possível concluir o onboarding."
        );
        return;
      }
      setSaidaSemTreino(null);
      toast.success(
        res?.novo_responsavel_nome
          ? `Onboarding concluído — implantação com ${res.novo_responsavel_nome}.`
          : "Onboarding concluído — jornada em Implantação."
      );
      invalidarQuadro();
    } catch (e: any) {
      toast.error(e.message || "Erro ao concluir onboarding");
    }
  }

  async function encerrarNoOnboarding(journeyId: string, motivo: string, goLiveReal: string) {
    try {
      const { data, error } = await (supabase.rpc as any)("journey_go_live", {
        p_journey_id: journeyId,
        p_go_live_real: goLiveReal || null,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(
          res.reason === "treinos_em_aberto"
            ? `Go-live bloqueado: ${res.qtd} treinamento${res.qtd > 1 ? "s" : ""} em aberto (${res.codigos}).`
            : "Não foi possível registrar o go-live.",
          { duration: 8000 },
        );
        return;
      }
      setSaidaSemTreino(null);
      toast.success("Onboarding concluído — jornada encerrada sem treinamento.");
      invalidarQuadro();
    } catch (e: any) {
      toast.error(e.message || "Erro ao encerrar onboarding");
    }
  }

  async function handleDrop(journeyId: string, targetStageId: string, fromStageId: string) {
    if (fromStageId === targetStageId) return;
    // Soltar na coluna de conclusão → encerra esta fase e entra na próxima ativa.
    if (targetStageId === ONB_DONE_COL_ID) {
      // A RPC de avanço genérica (advance_onboarding_phase) chega na Entrega C. Enquanto
      // isso, só o par onboarding → implantação tem RPC própria; qualquer outro par
      // recusa com mensagem clara em vez de mover a jornada para o lugar errado.
      if (phaseAtual?.slug !== "onboarding" || proximaPhase?.slug !== "implantacao") {
        toast.error(
          proximaPhase
            ? `Avançar de ${phaseAtual?.nome ?? "esta jornada"} para ${proximaPhase.nome} ainda não está liberado.`
            : "Esta é a última jornada configurada — não há para onde avançar.",
        );
        return;
      }
      await avancarJornada(journeyId, false);
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
  const totalFaseAtual = selectedPipelineId ? totalDoPipeline(selectedPipelineId, loading) : null;

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Implantação</h1>
          {phases.length > 1 && (
            <div className="inline-flex rounded-md border border-border p-0.5">
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
          {/* Com dois pipelines o total mora no badge de cada um. Com um só a barra de
              pipelines nem é renderizada, e sem isto a fase ficaria sem total nenhum. */}
          {pipelines.length <= 1 && totalFaseAtual !== null && (
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              <span className="text-muted-foreground/40 mr-2">·</span>
              {totalFaseAtual} {totalFaseAtual === 1 ? "ticket" : "tickets"} em andamento
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/onboarding-implantacao/config">
              <Settings2 className="h-4 w-4 mr-1" />
              Configurar
            </Link>
          </Button>
          {isAcompanhamento ? (
            <Button size="sm" onClick={() => setNewAcompOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Novo acompanhamento
            </Button>
          ) : (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Nova jornada
            </Button>
          )}
        </div>
      </div>

      {pipelines.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b border-border bg-background">
          <div className="inline-flex rounded-md border border-border p-0.5 flex-wrap">
            {pipelines.map((p) => {
              const ativo = p.id === selectedPipelineId;
              const total = totalDoPipeline(p.id, loading);
              return (
                <button
                  key={p.id}
                  onClick={() => selectPipeline(p.id)}
                  title={total === null ? undefined : `${total} ${total === 1 ? "ticket" : "tickets"} em andamento com os filtros atuais (concluídos não entram)`}
                  className={`inline-flex items-center px-3 py-1 text-xs rounded ${ativo ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {p.nome}
                  {total !== null && (
                    <span
                      className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded text-[10px] font-medium tabular-nums ${
                        // Sólido no ativo: o /20 sobre o verde do primary deixava o número
                        // quase invisível — o usuário reportou "camuflado no verde".
                        ativo ? "bg-primary-foreground text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {total}
                    </span>
                  )}
                </button>
              );
            })}
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
        {isImplantacao && opcoesTipoTreino.length > 0 && (
          <Select value={filtroTipoTreino} onValueChange={setFiltroTipoTreino}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Tipo de treino" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos" className="text-xs">Todos os tipos</SelectItem>
              {opcoesTipoTreino.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
        {isImplantacao && (
          <Button
            size="sm"
            variant="outline"
            className={`h-8 text-xs gap-1.5 ml-auto ${agrupadoPorTicket ? "border-primary/50 text-primary" : ""}`}
            onClick={() => setAgrupadoPorTicket((v) => !v)}
            title="Um cartão por ticket pai, com o andamento dos treinamentos"
          >
            <LayoutList className="h-3.5 w-3.5" />
            {agrupadoPorTicket ? "Ver por etapa" : "Agrupar por ticket"}
          </Button>
        )}
      </div>



      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : stages.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          Nenhum pipeline de {phaseAtual?.nome ?? "jornada"} configurado para este tenant.
        </div>
      ) : isAcompanhamento ? (
        <AcompanhamentoBoard
          stages={stages}
          tenantId={effectiveTenantId}
          busca={busca}
          onOpenTicket={setAcompTicketId}
          onTotalChange={setTotalAcompanhamento}
        />
      ) : isImplantacao ? (
        <ImplantacaoBoard
          stages={stages}
          rows={trainingCardsFiltrados}
          jornadasSemTreino={jornadasSemTreino}
          goLivePorJornada={goLivePorJornada}
          goLiveForaDaJanela={goLiveForaDaJanela}
          proximaFaseNome={proximaPhase?.nome ?? null}
          agrupado={agrupadoPorTicket}
          onOpenJourney={(id, sub) => {
            setDetailSubTicket(sub ?? null);
            setDetailId(id);
          }}
        />
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
                            onClick={() => { setDetailSubTicket(null); setDetailId(j.journey_id); }}
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
                                SLA {formatMinUtil(j.sla_util_min)}
                              </span>
                              {j.aberta_em && (
                                <span className="inline-flex items-center gap-1" title="Data de abertura da jornada">
                                  <Calendar className="h-3 w-3" />
                                  Aberta {formatDate(j.aberta_em)}
                                </span>
                              )}
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
            {!!proximaPhase && (() => {
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
                      {phaseAtual?.nome ?? "Jornada"} concluído
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
                        const seguiuAdiante = !!proximaPhase && phasesByJourney[j.journey_id]?.[proximaPhase.id];
                        const jornadaConcluida = j.fase_atual === "concluido" || j.situacao === "concluido";
                        const slaFase = phaseId ? phasesByJourney[j.journey_id]?.[phaseId]?.sla_util_min ?? null : null;
                        return (
                          <div
                            key={j.journey_id}
                            onClick={() => { setDetailSubTicket(null); setDetailId(j.journey_id); }}
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
                                {jornadaConcluida ? "concluída" : seguiuAdiante ? `→ em ${proximaPhase!.nome}` : (j.fase_atual ?? "—")}
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
                              <span className="inline-flex items-center gap-1" title="SLA desta jornada (congelado no encerramento da fase)">
                                <Clock className="h-3 w-3" />
                                SLA {phaseAtual?.nome ?? "da jornada"} {formatMinUtil(slaFase)}
                              </span>
                              {j.aberta_em && (
                                <span className="inline-flex items-center gap-1" title="Data de abertura da jornada">
                                  <Calendar className="h-3 w-3" />
                                  Aberta {formatDate(j.aberta_em)}
                                </span>
                              )}
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
        /* O quadro aberto é o padrão do "Abrir em" — com "Implantação Gula" na tela, a
           jornada nasce ali, não no Onboarding. */
        defaultPipelineId={selectedPipelineId}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
          queryClient.invalidateQueries({ queryKey: ["onboarding-journey-phases"] });
        }}
      />

      <NewAcompanhamentoModal
        open={newAcompOpen}
        onOpenChange={setNewAcompOpen}
        tenantId={effectiveTenantId}
        onCreated={(id) => {
          queryClient.invalidateQueries({ queryKey: ["onb-acompanhamento-board"] });
          setAcompTicketId(id);
        }}
      />

      <SupportTicketDetailDialog
        ticketId={acompTicketId}
        open={!!acompTicketId}
        onOpenChange={(o) => { if (!o) setAcompTicketId(null); }}
      />

      <JourneyDetailSheet
        open={!!detailId}
        onOpenChange={(o) => { if (!o) { setDetailId(null); setDetailSubTicket(null); } }}
        journeyId={detailId}
        subTicketId={detailSubTicket?.id ?? null}
        subTicketCode={detailSubTicket?.code ?? null}
        tenantId={effectiveTenantId}
      />

      <SaidaSemTreinoDialog
        open={!!saidaSemTreino}
        onOpenChange={(o) => { if (!o) setSaidaSemTreino(null); }}
        onTransferir={() => saidaSemTreino && avancarJornada(saidaSemTreino, true)}
        onEncerrar={({ motivo, goLiveReal }) =>
          saidaSemTreino && encerrarNoOnboarding(saidaSemTreino, motivo, goLiveReal)
        }
      />
    </div>
  );
}
