import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { StartConversationFromTicketDialog } from "@/components/tickets/StartConversationFromTicketDialog";
import { TicketAttachments } from "@/components/tickets/TicketAttachments";
import {
  Loader2, Clock, Pause, Play, ChevronRight, Calendar, CheckCircle2,
  Circle, AlertCircle, MessageSquare, GraduationCap, User, ArrowRight,
  UserPlus, Star, X, Users, Package, Plus, Trash2, Download, RotateCcw, AlertTriangle, Ban, Building2,
  ExternalLink, Link2,
  Sparkles, Rocket, StickyNote, Undo2, XCircle, Tag,
  Check, ChevronDown,
} from "lucide-react";
import { useOnboardingParticipantRoles } from "@/hooks/useOnboardingParticipantRoles";
import { TransferResponsavelDialog } from "./TransferResponsavelDialog";
import { ResponsavelHistorico } from "./ResponsavelHistorico";


interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  journeyId: string | null;
  tenantId: string | null;
}

interface Journey {
  journey_id: string;
  ticket_id: string | null;
  cliente_id: string | null;
  assunto: string | null;
  ticket_code: string | null;
  fase_atual: string | null;
  situacao: string | null;
  current_stage_id: string | null;
  stage_nome: string | null;
  sla_corrido_min: number | null;
  sla_util_min: number | null;
  sla_pausado_min: number | null;
  etapa_atual_min: number | null;
  etapa_semaforo: string | null;
  go_live_previsto: string | null;
  /** Data de abertura da jornada (onboarding_journeys.created_at). Somente leitura. */
  aberta_em: string | null;
  sla_total_util_min: number | null;
  data_inicio_planejado: string | null;
  pipeline_id?: string | null;
  demand_type_id?: string | null;
  demand_type_nome?: string | null;
  demand_type_cor?: string | null;
  concluido_em?: string | null;
  go_live_real?: string | null;
  onboarding_concluido?: boolean | null;
  onboarding_concluido_em?: string | null;
  implantacao_iniciada_em?: string | null;
  sla_onb_corrido_min?: number | null;
  sla_onb_util_min?: number | null;
  sla_onb_pausado_min?: number | null;
  sla_imp_corrido_min?: number | null;
  sla_imp_util_min?: number | null;
  sla_imp_pausado_min?: number | null;
  sla_total_corrido_min?: number | null;
  sla_total_pausado_min?: number | null;
  cliente_unidade_id?: number | null;
  cliente_unidade_nome?: string | null;
  responsavel_user_id?: string | null;
  responsavel_nome?: string | null;
}


const SEMAFORO_COLOR: Record<string, string> = {
  verde: "hsl(142 71% 45%)",
  amarelo: "hsl(38 92% 50%)",
  vermelho: "hsl(0 84% 60%)",
  sem_sla: "hsl(215 16% 47%)",
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EVENT_LABELS: Record<string, string> = {
  criado: "Ticket criado",
  status_alterado: "Status alterado",
  atribuido: "Atribuído",
  reatribuido: "Reatribuído",
  comentario: "Comentário",
  nota_agente: "Nota do agente",
  etapa_alterada: "Etapa alterada",
  pausado: "Onboarding pausado",
  retomado: "Onboarding retomado",
  concluido: "Etapa concluída",
  onboarding_participante: "Participante alterado",
};

// Timeline: rótulo, ícone e cor por tipo de evento. Fonte real: support_ticket_events.event_type
// (todos os tipos de onboarding são prefixados com "onboarding_"; EVENT_LABELS acima é legado do suporte).
type TLTone = "emerald" | "sky" | "violet" | "amber" | "red" | "slate";
const TL_TONES: Record<TLTone, string> = {
  emerald: "text-emerald-500 bg-emerald-500/10",
  sky: "text-sky-500 bg-sky-500/10",
  violet: "text-violet-500 bg-violet-500/10",
  amber: "text-amber-500 bg-amber-500/10",
  red: "text-red-500 bg-red-500/10",
  slate: "text-slate-400 bg-slate-400/10",
};
const TL_META: Record<string, { label: string; Icon: any; tone: TLTone }> = {
  onboarding_criado: { label: "Jornada criada", Icon: Sparkles, tone: "emerald" },
  onboarding_mudou_etapa: { label: "Mudança de etapa", Icon: ArrowRight, tone: "sky" },
  onboarding_fase_implantacao: { label: "Implantação iniciada", Icon: Rocket, tone: "violet" },
  onboarding_treino_criado: { label: "Treinamento agendado", Icon: GraduationCap, tone: "violet" },
  onboarding_participante: { label: "Participante alterado", Icon: UserPlus, tone: "sky" },
  onboarding_pausado: { label: "Onboarding pausado", Icon: Pause, tone: "amber" },
  onboarding_retomado: { label: "Onboarding retomado", Icon: Play, tone: "emerald" },
  onboarding_retorno_vendedor: { label: "Retorno ao vendedor", Icon: Undo2, tone: "amber" },
  onboarding_retorno_vendedor_resolvido: { label: "Retorno resolvido", Icon: CheckCircle2, tone: "emerald" },
  onboarding_cancelado: { label: "Jornada cancelada", Icon: XCircle, tone: "red" },
  onboarding_concluido: { label: "Jornada concluída", Icon: CheckCircle2, tone: "emerald" },
  onboarding_fase_revertida: { label: "Fase revertida", Icon: RotateCcw, tone: "amber" },
  nota_agente: { label: "Nota do agente", Icon: StickyNote, tone: "slate" },
  comment: { label: "Comentário", Icon: MessageSquare, tone: "slate" },
};
const tlMeta = (t: string) => TL_META[t] ?? { label: EVENT_LABELS[t] ?? t, Icon: Circle, tone: "slate" as TLTone };

// Coluna esquerda da timeline = o que alguém digitou. Todo o resto é movimentação/log.
const TL_NOTE_TYPES = new Set(["nota_agente"]);

// old_value/new_value às vezes vêm como UUID cru — não serve para exibir.
const TL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tlCleanValue = (v: any) => (v && !TL_UUID_RE.test(String(v).trim()) ? String(v) : null);

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Item da timeline — compartilhado pelas colunas de Notas e de Movimentação.
function TimelineEventItem({ ev, author }: { ev: any; author: string }) {
  const meta = tlMeta(ev.event_type);
  const Icon = meta.Icon;
  const oldV = tlCleanValue(ev.old_value);
  const newV = tlCleanValue(ev.new_value);
  const hasChips = ev.event_type === "onboarding_mudou_etapa" && !!oldV && !!newV;
  // Na mudança de etapa o content repete "Etapa: X → Y" — escondemos p/ não duplicar os chips.
  const showContent = ev.content && !hasChips;
  return (
    <div className="relative flex items-start gap-3">
      <div className={`relative z-10 h-6 w-6 rounded-full flex items-center justify-center ring-4 ring-background shrink-0 ${TL_TONES[meta.tone]}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {/* Quem fez vem primeiro; o que ocorreu logo depois. */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-xs font-semibold">{author}</span>
          <span className="text-[11px] text-muted-foreground">· {meta.label}</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto pl-2">{formatTime(ev.created_at)}</span>
        </div>
        {hasChips && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{oldV}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium">{newV}</span>
          </div>
        )}
        {showContent && (
          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{ev.content}</p>
        )}
      </div>
    </div>
  );
}

// Lista agrupada por dia com a linha conectora — usada nas duas colunas.
function TimelineDayGroups({
  groups,
  authorOf,
}: {
  groups: Array<{ key: string; label: string; items: any[] }>;
  authorOf: (ev: any) => string;
}) {
  return (
    <div className="space-y-5">
      {groups.map((day) => (
        <div key={day.key}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{day.label}</span>
            <div className="h-px bg-border flex-1" />
            <span className="text-[10px] text-muted-foreground">
              {day.items.length} {day.items.length === 1 ? "evento" : "eventos"}
            </span>
          </div>
          <div className="relative">
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />
            <div className="space-y-3">
              {day.items.map((ev: any) => (
                <TimelineEventItem key={ev.id} ev={ev} author={authorOf(ev)} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Agrupa eventos JÁ ordenados desc por dia, preservando a ordem de entrada.
function groupEventsByDay(list: any[]): Array<{ key: string; label: string; items: any[] }> {
  const groups: Array<{ key: string; label: string; items: any[] }> = [];
  let last: { key: string; label: string; items: any[] } | null = null;
  for (const ev of list) {
    const d = new Date(ev.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!last || last.key !== key) {
      last = { key, label: formatDayLabel(ev.created_at), items: [] };
      groups.push(last);
    }
    last.items.push(ev);
  }
  return groups;
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, today)) return "Hoje";
  if (same(d, yest)) return "Ontem";
  return formatDate(iso);
}

// Paleta de cores das tags de controle + cor de texto legível sobre a cor da tag.
const TAG_PALETTE = ["#ef4444", "#f59e0b", "#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#64748b"];
function readableOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

interface JourneyChecklistRow {
  id: string;
  stage_id: string | null;
  grupo_nome: string | null;
  grupo_pos: number;
  texto: string;
  is_required: boolean;
  position: number;
  origem: string;
  source_item_id: string | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
}

export default function JourneyDetailSheet({ open, onOpenChange, journeyId, tenantId }: Props) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [pauseReasonId, setPauseReasonId] = useState<string>("");
  const [pauseText, setPauseText] = useState("");
  const [pausePopoverOpen, setPausePopoverOpen] = useState(false);
  const [startConvOpen, setStartConvOpen] = useState(false);
  const [nextStageId, setNextStageId] = useState<string>("");
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [goLiveReal, setGoLiveReal] = useState<string>("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [newParticipantUserId, setNewParticipantUserId] = useState<string>("");
  const [newParticipantRoleId, setNewParticipantRoleId] = useState<string>("");

  // Trainings
  const [addTrainingOpen, setAddTrainingOpen] = useState(false);
  const [addTrainingOpenTop, setAddTrainingOpenTop] = useState(false);
  const [newTrainingTitle, setNewTrainingTitle] = useState("");
  const [newTrainingDate, setNewTrainingDate] = useState("");
  const [newTrainingConductor, setNewTrainingConductor] = useState<string>("");
  const [newTrainingRetreat, setNewTrainingRetreat] = useState(false);
  const [newTrainingTypeId, setNewTrainingTypeId] = useState<string>("");
  const [newTrainingLink, setNewTrainingLink] = useState("");

  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [linkEditId, setLinkEditId] = useState<string | null>(null);
  const [linkEditValue, setLinkEditValue] = useState("");

  // Modules
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleProdutoModuloId, setNewModuleProdutoModuloId] = useState<string>("");

  // Vendor return
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnVendorId, setReturnVendorId] = useState<string>("");
  const [returnReasonId, setReturnReasonId] = useState<string>("");
  const [returnText, setReturnText] = useState("");
  const [returnPauseSla, setReturnPauseSla] = useState(true);

  const [activeTab, setActiveTab] = useState<"atividade" | "timeline" | "geral">("atividade");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [quickTagName, setQuickTagName] = useState("");
  const [quickTagColor, setQuickTagColor] = useState("#0ea5e9");
  const [creatingTag, setCreatingTag] = useState(false);
  const [secOpen, setSecOpen] = useState<Record<string, boolean>>({ treinos: true, modulos: true, anexos: true, atendimentos: true });
  const toggleSec = (k: string) => setSecOpen((s) => ({ ...s, [k]: !s[k] }));
  // Colapso por grupo do checklist da etapa (default: aberto).
  const [checklistCollapsed, setChecklistCollapsed] = useState<Record<string, boolean>>({});
  const toggleChecklistGroup = (k: string) => setChecklistCollapsed((s) => ({ ...s, [k]: !s[k] }));
  const [novoManual, setNovoManual] = useState("");
  const [novoManualReq, setNovoManualReq] = useState(false);
  // Filtros da aba Timeline — estado local, não persistem entre aberturas.
  const [tlOnlyMine, setTlOnlyMine] = useState(false);
  const [tlTypes, setTlTypes] = useState<string[]>([]); // vazio = todos os tipos
  const [tlTypesOpen, setTlTypesOpen] = useState(false);


  useEffect(() => {
    if (!open) {
      setNote("");
      setPauseReasonId("");
      setPauseText("");
      setNextStageId("");
      setAddParticipantOpen(false);
      setNewParticipantUserId("");
      setNewParticipantRoleId("");
      setAddTrainingOpen(false);
      setNewTrainingTitle("");
      setNewTrainingDate("");
      setNewTrainingConductor("");
      setNewTrainingRetreat(false);
      setNewTrainingTypeId("");
      setNewTrainingLink("");

      setRescheduleId(null);
      setRescheduleDate("");
      setLinkEditId(null);
      setLinkEditValue("");
      setTlOnlyMine(false);
      setTlTypes([]);
      setTlTypesOpen(false);
    }
  }, [open, journeyId]);


  const journeyQ = useQuery({
    queryKey: ["onboarding-journey-detail", journeyId, tenantId],
    enabled: open && !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("vw_onboarding_journeys" as any) as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .maybeSingle();
      if (error) throw error;
      return data as Journey | null;
    },
  });

  const journey = journeyQ.data;

  const clienteQ = useQuery({
    queryKey: ["onboarding-journey-cliente", journey?.cliente_id],
    enabled: !!journey?.cliente_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("clientes")
        .select("id, nome_fantasia, razao_social")
        .eq("id", journey!.cliente_id!)
        .maybeSingle();
      return data as any;
    },
  });

  const journeyRowQ = useQuery({
    queryKey: ["onboarding-journey-row", journeyId],
    enabled: !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase.from("onboarding_journeys" as any) as any)
        .select("id, fase_atual, pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id, produto_id")
        .eq("id", journeyId)
        .maybeSingle();
      return data as any;
    },
  });

  const journeyRow = journeyRowQ.data;
  const pipelineId = journeyRow?.fase_atual === "implantacao"
    ? journeyRow?.pipeline_implantacao_id
    : journeyRow?.pipeline_onboarding_id;

  const stagesQ = useQuery({
    queryKey: ["onboarding-detail-stages", pipelineId],
    enabled: !!pipelineId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, nome, position, cor, is_final, visible_sections")
        .eq("tenant_id", tenantId)
        .eq("pipeline_id", pipelineId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; position: number; cor: string | null; is_final: boolean | null; visible_sections: string[] | null }>;
    },
  });

  const historyQ = useQuery({
    queryKey: ["onboarding-stage-history", journeyId],
    enabled: !!journeyId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stage_history" as any) as any)
        .select("id, stage_id, entrou_em, saiu_em, duracao_minutos, duracao_util_minutos")
        .eq("journey_id", journeyId)
        .order("entrou_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; stage_id: string; entrou_em: string; saiu_em: string | null; duracao_minutos: number | null; duracao_util_minutos: number | null }>;
    },
  });

  // Checklist da etapa ATUAL — materializado (snapshot) e persistido por jornada.
  const journeyChecklistQ = useQuery({
    queryKey: ["onboarding-journey-checklist", journeyId, journey?.current_stage_id],
    enabled: !!journeyId && !!journey?.current_stage_id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("sync_journey_stage_checklist", {
        p_journey_id: journeyId,
        p_stage_id: journey!.current_stage_id,
      });
      if (error) throw error;
      return (data ?? []) as JourneyChecklistRow[];
    },
  });

  // Todos os checklists da jornada (histórico p/ Visão geral).
  const journeyChecklistAllQ = useQuery({
    queryKey: ["onboarding-journey-checklist-all", journeyId],
    enabled: !!journeyId && activeTab === "geral",
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journey_checklist" as any) as any)
        .select("id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, done, done_at, done_by")
        .eq("journey_id", journeyId)
        .order("grupo_pos").order("position");
      if (error) throw error;
      return (data ?? []) as JourneyChecklistRow[];
    },
  });

  const pausesByReasonQ = useQuery({
    queryKey: ["onboarding-pauses-by-reason", journeyId, tenantId],
    enabled: !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("vw_onboarding_pauses_by_reason" as any) as any)
        .select("motivo_nome, minutos, em_andamento, iniciada_em")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId);
      if (error) throw error;
      return (data ?? []) as Array<{ motivo_nome: string | null; minutos: number | null; em_andamento: boolean; iniciada_em: string }>;
    },
  });


  const eventsQ = useQuery({
    queryKey: ["onboarding-ticket-events", journey?.ticket_id],
    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_ticket_events" as any) as any)
        .select("id, user_id, event_type, content, old_value, new_value, created_at")
        .eq("ticket_id", journey!.ticket_id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });

  // Tags de controle da jornada (exclusivas de onboarding/implantação).
  const journeyTagsQ = useQuery({
    queryKey: ["onboarding-journey-tags", journeyId],
    enabled: !!journeyId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journey_tags" as any) as any)
        .select("id, tag:tag_id(id, name, color)")
        .eq("journey_id", journeyId);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((a) => a.tag).map((a) => ({
        assignmentId: a.id as string,
        id: a.tag.id as string,
        name: a.tag.name as string,
        color: a.tag.color as string,
      }));
    },
  });

  const availableTagsQ = useQuery({
    queryKey: ["onboarding-tags-available", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_tags" as any) as any)
        .select("id, name, color")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string }>;
    },
  });

  const eventUserIds = useMemo(() => {
    const ids = new Set<string>();
    (eventsQ.data ?? []).forEach((e: any) => { if (e.user_id) ids.add(e.user_id); });
    return Array.from(ids);
  }, [eventsQ.data]);

  const eventUsersQ = useQuery({
    queryKey: ["onboarding-event-users", tenantId, eventUserIds.sort().join(",")],
    enabled: !!tenantId && eventUserIds.length > 0,
    queryFn: async () => {
      // Sem filtro de tenant: o super admin simulando outro tenant tem profile no tenant dele,
      // e com o filtro o próprio nome dele nunca resolvia (caía em "Usuário"). O RLS de profiles
      // continua sendo quem limita o que cada um enxerga.
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .in("user_id", eventUserIds);
      const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
      let funcMap: Record<number, string> = {};
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase
          .from("funcionarios")
          .select("id, nome")
          .in("id", funcIds);
        (funcs ?? []).forEach((f: any) => { funcMap[f.id] = f.nome; });
      }
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        if (p.funcionario_id && funcMap[p.funcionario_id]) map[p.user_id] = funcMap[p.funcionario_id];
      });
      return map;
    },
  });

  const trainingQ = useQuery({
    queryKey: ["onboarding-training", journeyId],
    enabled: !!journeyId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_training_sessions" as any) as any)
        .select("id, titulo, status, agendado_para, realizado_em, tentativas, no_show, proprietario_presente, is_retreinamento, conduzido_por, ticket_id, link_agendamento")
        .eq("journey_id", journeyId)
        .order("agendado_para", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });

  const modulesQ = useQuery({
    queryKey: ["onboarding-journey-modules", journeyId, tenantId],
    enabled: !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journey_modules" as any) as any)
        .select("id, nome, produto_modulo_id, origem, created_at")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; produto_modulo_id: string | null; origem: string; created_at: string }>;
    },
  });

  const produtoModulosQ = useQuery({
    queryKey: ["onboarding-produto-modulos", journeyRow?.produto_id, tenantId],
    enabled: !!journeyRow?.produto_id && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produto_modulos" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId)
        .eq("produto_id", journeyRow!.produto_id)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const clienteProdutoModulosQ = useQuery({
    queryKey: ["onboarding-cliente-produto-modulos", journey?.cliente_id, tenantId],
    enabled: !!journey?.cliente_id && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produto_modulos" as any) as any)
        .select("id, modulo_id, produto_modulos!inner(id, nome), cliente_produtos!inner(cliente_id)")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .eq("cliente_produtos.cliente_id", journey!.cliente_id!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; modulo_id: string; produto_modulos: { id: string; nome: string } }>;
    },
  });

  const accountingFieldsQ = useQuery({
    queryKey: ["onboarding-accounting-fields", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_accounting_fields" as any) as any)
        .select("id, nome, tipo, opcoes, position")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; tipo: "text" | "number" | "date" | "option" | "boolean"; opcoes: string[] | null; position: number }>;
    },
  });

  const accountingValuesQ = useQuery({
    queryKey: ["onboarding-accounting-values", journeyId, tenantId],
    enabled: !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journey_accounting" as any) as any)
        .select("id, field_id, valor, coletado")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; field_id: string; valor: string | null; coletado: boolean }>;
    },
  });


  const attendancesQ = useQuery({
    queryKey: ["onboarding-attendances", journey?.ticket_id],

    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("id, attendance_code, status, opened_at, closed_at, participant_label, wait_seconds, handle_seconds, first_response_time_seconds, first_response_business_seconds")
        .eq("ticket_id", journey!.ticket_id!)
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });

  const pauseReasonsQ = useQuery({
    queryKey: ["onboarding-pause-reasons", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pause_reasons" as any) as any)
        .select("id, nome, ativo")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  // Papeis vem do cadastro por tenant (onboarding_participant_roles), nao mais do enum.
  const rolesQ = useOnboardingParticipantRoles(tenantId, { enabled: open });
  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
  const rolesAtivos = useMemo(() => roles.filter((r) => r.ativo), [roles]);
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  useEffect(() => {
    if (!newParticipantRoleId && rolesAtivos.length) {
      setNewParticipantRoleId(rolesAtivos.find((r) => r.slug === "especialista")?.id ?? rolesAtivos[0].id);
    }
  }, [rolesAtivos, newParticipantRoleId]);

  const participantsQ = useQuery({
    queryKey: ["onboarding-participants", journey?.ticket_id],
    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_participants" as any) as any)
        .select("id, user_id, role_id, created_at")
        .eq("ticket_id", journey!.ticket_id!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; user_id: string; role_id: string; created_at: string }>;
    },
  });

  const trainingTypesQ = useQuery({
    queryKey: ["onb-training-types-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_training_types" as any) as any)
        .select("id, nome, conta_como_pdv")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; conta_como_pdv: boolean }>;
    },
  });


  const vendorReturnReasonsQ = useQuery({
    queryKey: ["onb-vendor-return-reasons-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
        .select("id, nome, atribuivel_vendedor")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; atribuivel_vendedor: boolean }>;
    },
  });

  const vendorReturnsQ = useQuery({
    queryKey: ["onboarding-vendor-returns", journeyId, tenantId],
    enabled: !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("vw_onboarding_vendor_returns" as any) as any)
        .select("vendedor_user_id, motivo_nome, atribuivel_vendedor, retornado_em, resolvido_em, em_aberto, minutos")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .order("retornado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        vendedor_user_id: string; motivo_nome: string | null; atribuivel_vendedor: boolean;
        retornado_em: string; resolvido_em: string | null; em_aberto: boolean; minutos: number | null;
      }>;
    },
  });



  const tenantMembersQ = useQuery({
    queryKey: ["onboarding-tenant-members", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", tenantId as string)
        .eq("status", "ativo");
      if (error) throw error;
      const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean) as number[];
      const { data: funcs } = funcIds.length
        ? await supabase.from("funcionarios").select("id, nome").in("id", funcIds)
        : { data: [] as any[] };
      const funcMap = new Map((funcs ?? []).map((f: any) => [f.id, f.nome]));
      return (profs ?? []).map((p: any) => ({
        user_id: p.user_id as string,
        nome: (p.funcionario_id ? funcMap.get(p.funcionario_id) : null) || "Sem vínculo",
      })).sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });

  const memberNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (tenantMembersQ.data ?? []).forEach((u) => m.set(u.user_id, u.nome));
    return m;
  }, [tenantMembersQ.data]);

  const stages = stagesQ.data ?? [];
  const history = historyQ.data ?? [];
  const checklist = journeyChecklistQ.data ?? [];
  const events = eventsQ.data ?? [];
  const trainings = trainingQ.data ?? [];
  const attendances = attendancesQ.data ?? [];

  // Timeline (aba dedicada): "Somente as minhas" atinge as duas colunas; o filtro de
  // tipos só tem efeito na de movimentação, já que a de notas é de um tipo só.
  const tlBase = useMemo(
    () => (tlOnlyMine && user?.id ? events.filter((e: any) => e.user_id === user.id) : events),
    [events, tlOnlyMine, user?.id]
  );
  const tlNotes = useMemo(() => tlBase.filter((e: any) => TL_NOTE_TYPES.has(e.event_type)), [tlBase]);
  const tlLogsAll = useMemo(() => tlBase.filter((e: any) => !TL_NOTE_TYPES.has(e.event_type)), [tlBase]);
  // Opções do filtro: só os tipos presentes NESTA jornada, com contagem.
  const tlTypeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    tlLogsAll.forEach((e: any) => counts.set(e.event_type, (counts.get(e.event_type) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([type, n]) => ({ type, n, label: tlMeta(type).label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [tlLogsAll]);
  const tlLogs = useMemo(
    () => (tlTypes.length === 0 ? tlLogsAll : tlLogsAll.filter((e: any) => tlTypes.includes(e.event_type))),
    [tlLogsAll, tlTypes]
  );
  const tlNotesByDay = useMemo(() => groupEventsByDay(tlNotes), [tlNotes]);
  const tlLogsByDay = useMemo(() => groupEventsByDay(tlLogs), [tlLogs]);
  const tlFiltersActive = tlOnlyMine || tlTypes.length > 0;
  const tlAuthorOf = (ev: any) =>
    !ev.user_id ? "Sistema" : (eventUsersQ.data?.[ev.user_id] ?? "Usuário");

  const historyByStage = useMemo(() => {
    const m: Record<string, { entrou_em: string; saiu_em: string | null; duracao_minutos: number | null; duracao_util_minutos: number | null }> = {};
    history.forEach((h) => {
      if (!m[h.stage_id] || new Date(h.entrou_em) > new Date(m[h.stage_id].entrou_em)) {
        m[h.stage_id] = h;
      }
    });
    return m;
  }, [history]);

  const currentStageIndex = useMemo(
    () => stages.findIndex((s) => s.id === journey?.current_stage_id),
    [stages, journey?.current_stage_id]
  );

  // Checklist agrupado (modelo Trello): agrupa as linhas da jornada por nome do grupo
  // (snapshot em grupo_nome/grupo_pos). Itens já vêm ordenados por grupo_pos, position.
  const checklistSections = useMemo(() => {
    const map = new Map<string, { key: string; nome: string; pos: number; items: JourneyChecklistRow[] }>();
    for (const c of checklist) {
      const nome = c.grupo_nome ?? "Checklist";
      if (!map.has(nome)) map.set(nome, { key: nome, nome, pos: c.grupo_pos ?? 0, items: [] });
      map.get(nome)!.items.push(c);
    }
    return Array.from(map.values()).sort((a, b) => a.pos - b.pos || a.nome.localeCompare(b.nome));
  }, [checklist]);

  async function toggleChecklistItem(item: JourneyChecklistRow, done: boolean) {
    qc.setQueryData(
      ["onboarding-journey-checklist", journeyId, journey?.current_stage_id],
      (old: JourneyChecklistRow[] | undefined) =>
        (old ?? []).map((r) => (r.id === item.id ? { ...r, done } : r)),
    );
    const { error } = await (supabase.rpc as any)("set_journey_checklist_done", {
      p_item_id: item.id,
      p_done: done,
    });
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist", journeyId, journey?.current_stage_id] });
    }
  }

  async function addManualChecklistItem() {
    const texto = novoManual.trim();
    if (!texto || !journeyId || !journey?.current_stage_id) return;
    const maxPos = checklist.filter((c) => c.origem === "manual").reduce((m, c) => Math.max(m, c.position ?? 0), 0);
    const { error } = await (supabase.from("onboarding_journey_checklist" as any) as any).insert({
      tenant_id: tenantId,
      journey_id: journeyId,
      stage_id: journey.current_stage_id,
      grupo_nome: "Personalizado",
      grupo_pos: 9999,
      texto,
      is_required: novoManualReq,
      position: maxPos + 1,
      origem: "manual",
    });
    if (error) { toast.error(error.message); return; }
    setNovoManual("");
    setNovoManualReq(false);
    qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist", journeyId, journey.current_stage_id] });
    qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist-all", journeyId] });
  }

  async function deleteManualChecklistItem(id: string) {
    const { error } = await (supabase.from("onboarding_journey_checklist" as any) as any)
      .delete().eq("id", id).eq("origem", "manual");
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist", journeyId, journey?.current_stage_id] });
    qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist-all", journeyId] });
  }

  // Histórico de checklists por etapa (Visão geral): agrupa todas as linhas da
  // jornada por etapa (na ordem do pipeline) e, dentro dela, por grupo.
  const checklistHistory = useMemo(() => {
    const rows = journeyChecklistAllQ.data ?? [];
    const stageOrder = new Map(stages.map((s, i) => [s.id, i]));
    const byStage = new Map<string, JourneyChecklistRow[]>();
    for (const r of rows) {
      const k = r.stage_id ?? "__none__";
      if (!byStage.has(k)) byStage.set(k, []);
      byStage.get(k)!.push(r);
    }
    return Array.from(byStage.entries())
      .map(([stageId, items]) => {
        const gm = new Map<string, { nome: string; pos: number; items: JourneyChecklistRow[] }>();
        for (const it of items) {
          const gn = it.grupo_nome ?? "Checklist";
          if (!gm.has(gn)) gm.set(gn, { nome: gn, pos: it.grupo_pos ?? 0, items: [] });
          gm.get(gn)!.items.push(it);
        }
        return {
          stageId,
          nome: stages.find((s) => s.id === stageId)?.nome ?? "Etapa",
          order: stageOrder.get(stageId) ?? 999,
          groups: Array.from(gm.values()).sort((a, b) => a.pos - b.pos),
          total: items.length,
          done: items.filter((i) => i.done).length,
        };
      })
      .sort((a, b) => a.order - b.order);
  }, [journeyChecklistAllQ.data, stages]);

  const canScheduleTraining = useMemo(() => {
    if (!journey) return false;
    if (journey.situacao === "concluido") return false;
    if (journey.fase_atual === "implantacao") return true;
    if (journey.fase_atual === "onboarding") {
      const cur = stages.find((s) => s.id === journey.current_stage_id);
      return cur?.is_final === true;
    }
    return false;
  }, [journey, stages]);

  const pausesByReason = useMemo(() => {
    const rows = pausesByReasonQ.data ?? [];
    const agg = new Map<string, { minutos: number; em_andamento: boolean; count: number }>();
    rows.forEach((r) => {
      const name = r.motivo_nome || "Sem motivo";
      const cur = agg.get(name) || { minutos: 0, em_andamento: false, count: 0 };
      cur.minutos += r.minutos ?? 0;
      cur.em_andamento = cur.em_andamento || r.em_andamento;
      cur.count += 1;
      agg.set(name, cur);
    });
    return Array.from(agg.entries())
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.minutos - a.minutos);
  }, [pausesByReasonQ.data]);

  // Acumulado em MINUTOS DE EXPEDIENTE — mesma base de etapa_atual_min e do SLA da etapa.
  // duracao_util_minutos é o campo certo; duracao_minutos (calendário) só entra como
  // último recurso em histórico anterior ao backfill.
  const accumulatedByStage = useMemo(() => {
    const m: Record<string, number> = {};
    let acc = 0;
    stages.forEach((s, idx) => {
      const isCurrent = s.id === journey?.current_stage_id;
      const h = historyByStage[s.id];
      if (isCurrent) {
        acc += journey?.etapa_atual_min ?? 0;
      } else if (currentStageIndex >= 0 && idx < currentStageIndex) {
        acc += h?.duracao_util_minutos ?? h?.duracao_minutos ?? 0;
      }
      m[s.id] = acc;
    });
    return m;
  }, [stages, historyByStage, currentStageIndex, journey?.current_stage_id, journey?.etapa_atual_min]);


  const cliente = clienteQ.data;
  const clienteNome = cliente?.nome_fantasia || cliente?.razao_social || "—";
  const isPaused = journey?.situacao === "pausado" || journey?.situacao === "parado";
  const isConcluded = journey?.situacao === "concluido";
  const isCancelled = journey?.situacao === "cancelado";
  const isTerminal = isConcluded || isCancelled;
  const isAdmin = profile?.is_super_admin === true || profile?.role === "admin";
  const etapaFinal = stages.find((s) => s.id === journey?.current_stage_id)?.is_final === true;
  const canGoLive = (journey?.fase_atual === "implantacao" && etapaFinal) || isAdmin;

  // Ao agendar na fase de onboarding, o usuário escolhe concluir (→ implantação) ou manter.
  const isOnbPhase = journey?.fase_atual === "onboarding";
  const scheduleAlert = isOnbPhase ? (
    <Alert className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 [&>svg]:text-sky-500 py-2 text-xs">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="text-xs">
        Escolha ao agendar: concluir o Onboarding e iniciar a Implantação agora, ou apenas agendar mantendo em Onboarding.
      </AlertDescription>
    </Alert>
  ) : null;
  const scheduleButtons = isOnbPhase ? (
    <div className="space-y-2 pt-1">
      <Button size="sm" className="w-full text-white border-0" style={{ background: "#22C55E" }} onClick={() => handleCreateTraining(true)}>
        Concluir onboarding e iniciar Implantação
      </Button>
      <Button size="sm" variant="outline" className="w-full" onClick={() => handleCreateTraining(false)}>
        Só agendar, manter em Onboarding
      </Button>
    </div>
  ) : (
    <Button size="sm" className="w-full" onClick={() => handleCreateTraining(false)}>Agendar</Button>
  );

  const currentStageSections = useMemo(() => {
    const cur = stages.find((s) => s.id === journey?.current_stage_id);
    return cur?.visible_sections ?? null;
  }, [stages, journey]);
  const secVisible = (key: string) =>
    !currentStageSections || currentStageSections.length === 0 || currentStageSections.includes(key);


  async function handleAdvance() {
    if (!journey) return;
    const targetId = nextStageId || (currentStageIndex >= 0 && currentStageIndex < stages.length - 1 ? stages[currentStageIndex + 1].id : null);
    if (!targetId) {
      toast.error("Selecione a próxima etapa");
      return;
    }
    const checkedIds = checklist.filter((c) => c.done && c.source_item_id).map((c) => c.source_item_id);
    try {
      const { data, error } = await (supabase.rpc as any)("move_onboarding_stage", {
        p_journey_id: journey.journey_id,
        p_target_stage_id: targetId,
        p_completed_checklist_ids: checkedIds,
        p_force: false,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        if (res.reason === "checklist_incompleto") {
          toast.error(`Faltam ${res.faltando ?? 0} itens obrigatórios do checklist`);
        } else {
          toast.error(res.message || "Não foi possível avançar");
        }
        return;
      }
      toast.success("Etapa avançada");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-stage-history"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-checklist-all"] });
      setNextStageId("");
    } catch (e: any) {
      toast.error(e.message || "Erro ao avançar");
    }
  }

  async function handlePause() {
    if (!journey) return;
    if (!pauseReasonId) {
      toast.error("Selecione um motivo");
      return;
    }
    try {
      const { error } = await (supabase.rpc as any)("pause_onboarding", {
        p_journey_id: journey.journey_id,
        p_reason_id: pauseReasonId,
        p_motivo_texto: pauseText || null,
      });
      if (error) throw error;
      toast.success("Onboarding pausado");
      setPausePopoverOpen(false);
      setPauseReasonId("");
      setPauseText("");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao pausar");
    }
  }

  async function handleResume() {
    if (!journey) return;
    try {
      const { error } = await (supabase.rpc as any)("resume_onboarding", { p_journey_id: journey.journey_id });
      if (error) throw error;
      toast.success("Onboarding retomado");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao retomar");
    }
  }

  async function handleConclude() {
    if (!journey) return;
    try {
      const { error } = await (supabase.rpc as any)("conclude_onboarding_journey", {
        p_journey_id: journey.journey_id,
        p_go_live_real: goLiveReal || null,
      });
      if (error) throw error;
      toast.success("Jornada concluída");
      setConcludeOpen(false);
      setGoLiveReal("");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao concluir");
    }
  }

  async function handleReopen() {
    if (!journey) return;
    try {
      const { error } = await (supabase.rpc as any)("reopen_onboarding_journey", { p_journey_id: journey.journey_id });
      if (error) throw error;
      toast.success("Jornada reaberta");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao reabrir");
    }
  }

  async function handleCancel() {
    if (!journey) return;
    if (!cancelMotivo.trim()) {
      toast.error("Informe o motivo do cancelamento.");
      return;
    }
    try {
      const { data, error } = await (supabase.rpc as any)("cancel_onboarding_journey", {
        p_journey_id: journey.journey_id,
        p_motivo: cancelMotivo.trim(),
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(res.reason === "ja_terminal" ? "Jornada já finalizada" : "Não foi possível cancelar");
        return;
      }
      toast.success("Jornada cancelada");
      setCancelOpen(false);
      setCancelMotivo("");
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao cancelar");
    }
  }

  async function handleAddNote() {
    if (!journey?.ticket_id || !note.trim() || !user?.id) return;
    try {
      const { error } = await (supabase.from("support_ticket_events" as any) as any).insert({
        tenant_id: tenantId,
        ticket_id: journey.ticket_id,
        user_id: user.id,
        event_type: "nota_agente",
        content: note.trim(),
      });
      if (error) throw error;
      setNote("");
      toast.success("Nota adicionada");
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar nota");
    }
  }

  async function handleAddTag(tagId: string) {
    if (!journeyId || !tenantId) return;
    try {
      const { error } = await (supabase.from("onboarding_journey_tags" as any) as any)
        .insert({ tenant_id: tenantId, journey_id: journeyId, tag_id: tagId });
      if (error) throw error;
      journeyTagsQ.refetch();
      qc.invalidateQueries({ queryKey: ["onboarding-journeys-tags"] });
      setTagPopoverOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar tag");
    }
  }

  async function handleRemoveTag(assignmentId: string) {
    try {
      const { error } = await (supabase.from("onboarding_journey_tags" as any) as any)
        .delete().eq("id", assignmentId);
      if (error) throw error;
      journeyTagsQ.refetch();
      qc.invalidateQueries({ queryKey: ["onboarding-journeys-tags"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover tag");
    }
  }

  async function handleCreateAndAddTag() {
    const name = quickTagName.trim();
    if (!name || !tenantId || !journeyId) return;
    setCreatingTag(true);
    try {
      let tagId: string | null = null;
      const { data: newTag, error: insertError } = await (supabase.from("onboarding_tags" as any) as any)
        .insert({ tenant_id: tenantId, name, color: quickTagColor, is_active: true })
        .select("id").single();
      if (insertError) {
        // nome duplicado → reaproveita a tag existente do tenant
        const { data: existing } = await (supabase.from("onboarding_tags" as any) as any)
          .select("id").eq("tenant_id", tenantId).eq("is_active", true).ilike("name", name).maybeSingle();
        if (!existing?.id) throw insertError;
        tagId = existing.id;
      } else {
        tagId = newTag?.id ?? null;
      }
      if (tagId) await handleAddTag(tagId);
      setQuickTagName("");
      setQuickTagColor("#0ea5e9");
      qc.invalidateQueries({ queryKey: ["onboarding-tags-available"] });
    } catch (e: any) {
      toast.error("Erro: " + (e.message ?? ""));
    } finally {
      setCreatingTag(false);
    }
  }

  async function handleAddParticipant() {
    if (!journey?.ticket_id || !tenantId || !newParticipantUserId || !newParticipantRoleId) {
      toast.error("Selecione o usuário e o papel");
      return;
    }
    const papelNome = roleMap.get(newParticipantRoleId)?.nome ?? "participante";
    try {
      const { error } = await (supabase.from("onboarding_participants" as any) as any).insert({
        tenant_id: tenantId,
        ticket_id: journey.ticket_id,
        user_id: newParticipantUserId,
        role_id: newParticipantRoleId,
      });
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("Participante já adicionado nesse papel");
        } else {
          throw error;
        }
        return;
      }
      const nome = memberNameMap.get(newParticipantUserId) || "usuário";
      if (user?.id) {
        await (supabase.from("support_ticket_events" as any) as any).insert({
          tenant_id: tenantId,
          ticket_id: journey.ticket_id,
          user_id: user.id,
          event_type: "onboarding_participante",
          content: `Adicionado: ${nome} (${papelNome})`,
        });
      }
      toast.success("Participante adicionado");
      setAddParticipantOpen(false);
      setNewParticipantUserId("");
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar participante");
    }
  }

  // Quem pode trocar o papel de um participante: o responsavel pela jornada,
  // admin/head, ou super admin. A regra tambem e aplicada dentro da RPC — isso
  // aqui e so para nao mostrar um controle que vai falhar.
  const podeEditarPapel =
    profile?.is_super_admin === true ||
    profile?.role === "admin" ||
    profile?.role === "head" ||
    (!!user?.id && user.id === journey?.responsavel_user_id);

  async function handleChangeParticipantRole(participantId: string, roleId: string) {
    try {
      const { data, error } = await (supabase.rpc as any)("set_onboarding_participant_role", {
        p_participant_id: participantId,
        p_role_id: roleId,
      });
      if (error) throw error;
      if (!(data as any)?.inalterado) {
        toast.success(`Papel alterado para ${(data as any)?.papel_nome ?? "novo papel"}`);
      }
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar o papel");
    }
  }

  async function handleRemoveParticipant(id: string, userId: string, papelNome: string) {
    if (!journey?.ticket_id) return;
    try {
      const { error } = await (supabase.from("onboarding_participants" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      const nome = memberNameMap.get(userId) || "usuário";
      if (user?.id) {
        await (supabase.from("support_ticket_events" as any) as any).insert({
          tenant_id: tenantId,
          ticket_id: journey.ticket_id,
          user_id: user.id,
          event_type: "onboarding_participante",
          content: `Removido: ${nome} (${papelNome})`,
        });
      }
      toast.success("Participante removido");
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover participante");
    }
  }

  async function handleCreateTraining(concluir: boolean) {
    if (!journeyId || !newTrainingTitle.trim()) {
      toast.error("Informe o título do treino");
      return;
    }
    const movesToImplantation = journey?.fase_atual === "onboarding" && concluir;
    try {
      const { error } = await (supabase.rpc as any)("create_onboarding_training", {
        p_journey_id: journeyId,
        p_titulo: newTrainingTitle.trim(),
        p_agendado_para: newTrainingDate ? new Date(newTrainingDate).toISOString() : null,
        p_conduzido_por: newTrainingConductor || null,
        p_is_retreinamento: newTrainingRetreat,
        p_training_type_id: newTrainingTypeId || null,
        p_link: newTrainingLink.trim() || null,
        p_concluir_onboarding: concluir,
      });
      if (error) throw error;
      toast.success(
        movesToImplantation
          ? "Treino agendado — onboarding concluído, jornada em Implantação."
          : "Treino agendado"
      );
      setAddTrainingOpen(false);
      setAddTrainingOpenTop(false);
      setNewTrainingTitle("");
      setNewTrainingDate("");
      setNewTrainingConductor("");
      setNewTrainingRetreat(false);
      setNewTrainingTypeId("");
      setNewTrainingLink("");
      qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-board-trainings"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-row", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-detail-stages"] });
      qc.invalidateQueries({ queryKey: ["onboarding-stage-history", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-stage-checklist"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar treino");
    }
  }

  async function handleConcludeOnboarding() {
    if (!journey) return;
    try {
      const { data, error } = await (supabase.rpc as any)("advance_onboarding_to_implantacao", {
        p_journey_id: journey.journey_id,
        p_force: false,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        const msg =
          res.reason === "nao_etapa_final" ? "Conclua as etapas do onboarding antes de avançar." :
          res.reason === "nao_em_onboarding" ? "A jornada não está mais em Onboarding." :
          "Não foi possível concluir o onboarding.";
        toast.error(msg);
        return;
      }
      toast.success(
        res?.novo_responsavel_nome
          ? `Onboarding concluído — implantação com ${res.novo_responsavel_nome}.`
          : "Onboarding concluído — jornada em Implantação."
      );
      qc.invalidateQueries({ queryKey: ["onboarding-responsavel-history"] });
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-row", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-detail-stages"] });
      qc.invalidateQueries({ queryKey: ["onboarding-stage-history", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao concluir onboarding");
    }
  }

  async function updateTraining(id: string, patch: Record<string, any>) {
    if (!tenantId) return;
    const { error } = await (supabase.from("onboarding_training_sessions" as any) as any)
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
    qc.invalidateQueries({ queryKey: ["onboarding-board-trainings"] });
  }

  async function handleSaveLink(id: string) {
    try {
      await updateTraining(id, { link_agendamento: linkEditValue.trim() || null });
      setLinkEditId(null);
      setLinkEditValue("");
      toast.success("Link salvo");
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar link");
    }
  }

  async function handleMarkRealized(id: string) {
    try {
      await updateTraining(id, { status: "realizado", realizado_em: new Date().toISOString() });
      toast.success("Treino marcado como realizado");
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }

  async function handleMarkNoShow(id: string, currentAttempts: number) {
    try {
      await updateTraining(id, { status: "no_show", no_show: true, tentativas: (currentAttempts || 0) + 1 });
      toast.success("Marcado como no-show");
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }

  async function handleReschedule(id: string, currentAttempts: number) {
    if (!rescheduleDate) { toast.error("Escolha a nova data"); return; }
    try {
      await updateTraining(id, {
        status: "agendado",
        agendado_para: new Date(rescheduleDate).toISOString(),
        tentativas: (currentAttempts || 0) + 1,
      });
      toast.success("Treino remarcado");
      setRescheduleId(null);
      setRescheduleDate("");
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }

  async function handleTogglePresente(id: string, current: boolean) {
    try {
      await updateTraining(id, { proprietario_presente: !current });
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }

  async function handleCancelTraining(id: string) {
    try {
      await updateTraining(id, { status: "cancelado" });
      toast.success("Treino cancelado");
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }

  async function handleAddModuleManual() {
    if (!tenantId || !journeyId) return;
    const nome = newModuleName.trim();
    if (!nome) { toast.error("Informe o nome do módulo"); return; }
    try {
      const { error } = await (supabase.from("onboarding_journey_modules" as any) as any)
        .insert({ tenant_id: tenantId, journey_id: journeyId, nome, origem: "manual" });
      if (error) throw error;
      toast.success("Módulo adicionado");
      setNewModuleName("");
      setAddModuleOpen(false);
      qc.invalidateQueries({ queryKey: ["onboarding-journey-modules", journeyId, tenantId] });
    } catch (e: any) { toast.error(e.message || "Erro ao adicionar módulo"); }
  }

  async function handleAddModuleFromProduto() {
    if (!tenantId || !journeyId || !newModuleProdutoModuloId) return;
    const pm = (produtoModulosQ.data ?? []).find((m) => m.id === newModuleProdutoModuloId);
    if (!pm) return;
    try {
      const { error } = await (supabase.from("onboarding_journey_modules" as any) as any)
        .insert({ tenant_id: tenantId, journey_id: journeyId, nome: pm.nome, produto_modulo_id: pm.id, origem: "produto" });
      if (error) throw error;
      toast.success("Módulo adicionado");
      setNewModuleProdutoModuloId("");
      setAddModuleOpen(false);
      qc.invalidateQueries({ queryKey: ["onboarding-journey-modules", journeyId, tenantId] });
    } catch (e: any) { toast.error(e.message || "Erro ao adicionar módulo"); }
  }

  async function handleImportFromCliente() {
    if (!tenantId || !journeyId) return;
    const items = clienteProdutoModulosQ.data ?? [];
    if (items.length === 0) { toast.error("Cliente não possui módulos cadastrados"); return; }
    const existing = new Set((modulesQ.data ?? []).map((m) => m.produto_modulo_id).filter(Boolean));
    const rows = items
      .filter((it) => !existing.has(it.modulo_id))
      .map((it) => ({
        tenant_id: tenantId,
        journey_id: journeyId,
        nome: it.produto_modulos.nome,
        produto_modulo_id: it.modulo_id,
        origem: "cliente",
      }));
    if (rows.length === 0) { toast.info("Todos os módulos do cliente já estão importados"); return; }
    try {
      const { error } = await (supabase.from("onboarding_journey_modules" as any) as any).insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} módulo(s) importado(s)`);
      qc.invalidateQueries({ queryKey: ["onboarding-journey-modules", journeyId, tenantId] });
    } catch (e: any) { toast.error(e.message || "Erro ao importar módulos"); }
  }

  async function handleDeleteModule(id: string) {
    if (!tenantId) return;
    try {
      const { error } = await (supabase.from("onboarding_journey_modules" as any) as any)
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["onboarding-journey-modules", journeyId, tenantId] });
    } catch (e: any) { toast.error(e.message || "Erro ao remover módulo"); }
  }

  const openVendorReturn = (vendorReturnsQ.data ?? []).find((r) => r.em_aberto);

  async function handleReturnToVendor() {
    if (!journey) return;
    if (!returnVendorId) { toast.error("Selecione o vendedor"); return; }
    if (!returnReasonId) { toast.error("Selecione o motivo"); return; }
    try {
      const { error } = await (supabase.rpc as any)("return_to_vendor", {
        p_journey_id: journey.journey_id,
        p_vendedor_user_id: returnVendorId,
        p_reason_id: returnReasonId,
        p_motivo_texto: returnText || null,
        p_pausar_sla: returnPauseSla,
      });
      if (error) throw error;
      toast.success("Retornado ao vendedor");
      setReturnOpen(false);
      setReturnVendorId(""); setReturnReasonId(""); setReturnText(""); setReturnPauseSla(true);
      qc.invalidateQueries({ queryKey: ["onboarding-vendor-returns"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao retornar");
    }
  }

  async function handleResolveVendorReturn() {
    if (!journey) return;
    try {
      const { error } = await (supabase.rpc as any)("resolve_vendor_return", { p_journey_id: journey.journey_id });
      if (error) throw error;
      toast.success("Retorno resolvido");
      qc.invalidateQueries({ queryKey: ["onboarding-vendor-returns"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao resolver retorno");
    }
  }


  const loading = journeyQ.isLoading || !journey;
  const slaColor = SEMAFORO_COLOR[journey?.etapa_semaforo || "sem_sla"];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
              <div className="flex flex-col gap-3">
                <div className="min-w-0 pr-10">
                  <div className="flex items-center gap-2 flex-wrap">
                    {journey.ticket_code && (
                      <span className="font-mono text-xs text-primary font-semibold">{journey.ticket_code}</span>
                    )}
                    {journey.cliente_unidade_nome && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border"
                        style={{ background: "rgba(139,92,246,.15)", borderColor: "rgba(139,92,246,.45)", color: "#c9b8fb" }}
                      >
                        <Building2 className="h-3 w-3" />
                        {journey.cliente_unidade_nome}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] capitalize">{journey.fase_atual || "—"}</Badge>
                    <Badge className="text-[10px] capitalize" style={{ background: slaColor, color: "white" }}>
                      {journey.stage_nome || "sem etapa"}
                    </Badge>
                    {journey.demand_type_nome && (
                      <Badge
                        className="text-[10px] border-0 text-white"
                        style={{ background: journey.demand_type_cor || "#6B7280" }}
                      >
                        {journey.demand_type_nome}
                      </Badge>
                    )}

                    {isPaused && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Pause className="h-3 w-3" /> pausado
                      </Badge>
                    )}
                    {isConcluded && (
                      <Badge className="text-[10px] gap-1 border-0 text-white" style={{ background: "#22C55E" }}>
                        <CheckCircle2 className="h-3 w-3" /> Concluída
                      </Badge>
                    )}
                    {isCancelled && (
                      <Badge className="text-[10px] gap-1 border-0 text-white" style={{ background: "hsl(var(--destructive))" }}>
                        <Ban className="h-3 w-3" /> Cancelada
                      </Badge>
                    )}
                    {openVendorReturn && (
                      <Badge className="text-[10px] gap-1 border-0 text-white" style={{ background: "hsl(38 92% 50%)" }}>
                        <AlertTriangle className="h-3 w-3" /> Aguardando vendedor
                      </Badge>
                    )}

                  </div>
                  <DialogTitle className="text-base mt-1 truncate">{clienteNome}</DialogTitle>
                  {journey.assunto && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{journey.assunto}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {journey.ticket_id && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setStartConvOpen(true)}>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" /> Conversa
                    </Button>
                  )}
                  {canScheduleTraining && (
                    <Popover open={addTrainingOpenTop} onOpenChange={setAddTrainingOpenTop}>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-8 text-xs">
                          <GraduationCap className="h-3.5 w-3.5 mr-1" /> Agendar treino
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 space-y-3" align="end">
                        {scheduleAlert}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">Título *</label>
                          <Input
                            value={newTrainingTitle}
                            onChange={(e) => setNewTrainingTitle(e.target.value)}
                            placeholder="Ex: Treinamento PDV"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">Data/hora</label>
                          <Input
                            type="datetime-local"
                            value={newTrainingDate}
                            onChange={(e) => setNewTrainingDate(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">Conduzido por</label>
                          <Select value={newTrainingConductor} onValueChange={setNewTrainingConductor}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar usuário" /></SelectTrigger>
                            <SelectContent>
                              {(tenantMembersQ.data ?? []).map((m) => (
                                <SelectItem key={m.user_id} value={m.user_id} className="text-xs">{m.nome}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">Tipo de treino</label>
                          <Select value={newTrainingTypeId} onValueChange={setNewTrainingTypeId}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar tipo" /></SelectTrigger>
                            <SelectContent>
                              {(trainingTypesQ.data ?? []).map((tt) => (
                                <SelectItem key={tt.id} value={tt.id} className="text-xs">
                                  {tt.nome}{tt.conta_como_pdv ? " · PDV" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">Link do agendamento</label>
                          <Input
                            type="url"
                            value={newTrainingLink}
                            onChange={(e) => setNewTrainingLink(e.target.value)}
                            placeholder="https://meet.google.com/..."
                            className="h-8 text-xs"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={newTrainingRetreat}
                            onCheckedChange={(v) => setNewTrainingRetreat(!!v)}
                          />
                          É retreinamento?
                        </label>
                        {scheduleButtons}
                      </PopoverContent>
                    </Popover>
                  )}
                  {isOnbPhase && etapaFinal && !isTerminal && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleConcludeOnboarding}>
                      <Rocket className="h-3.5 w-3.5 mr-1" /> Concluir onboarding → Implantação
                    </Button>
                  )}
                  {!isConcluded && (
                    openVendorReturn ? (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleResolveVendorReturn}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resolver retorno
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setReturnOpen(true)}>
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Retornar ao vendedor
                      </Button>
                    )
                  )}

                  {isTerminal ? (
                    <>
                      <span className="text-[11px] text-muted-foreground">
                        {isCancelled ? "Cancelada" : "Concluída"} em {formatDate(journey.concluido_em ?? null)}
                      </span>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleReopen}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Reabrir
                      </Button>
                    </>
                  ) : isPaused ? (
                    <>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleResume}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Retomar
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelOpen(true)}>
                        <Ban className="h-3.5 w-3.5 mr-1" /> Cancelar jornada
                      </Button>
                      {canGoLive && (
                        <Button size="sm" className="h-8 text-xs text-white border-0" style={{ background: "#22C55E" }} onClick={() => setConcludeOpen(true)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Go-live
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Popover open={pausePopoverOpen} onOpenChange={setPausePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 text-xs">
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 space-y-3" align="end">
                          <div>
                            <label className="text-xs font-medium">Motivo</label>
                            <Select value={pauseReasonId} onValueChange={setPauseReasonId}>
                              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                              <SelectContent>
                                {(pauseReasonsQ.data ?? []).map((r) => (
                                  <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs font-medium">Justificativa (opcional)</label>
                            <Textarea value={pauseText} onChange={(e) => setPauseText(e.target.value)} rows={3} className="mt-1" />
                          </div>
                          <Button size="sm" className="w-full" onClick={handlePause}>Confirmar pausa</Button>
                        </PopoverContent>
                      </Popover>
                      <Button size="sm" variant="outline" className="h-8 text-xs border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelOpen(true)}>
                        <Ban className="h-3.5 w-3.5 mr-1" /> Cancelar jornada
                      </Button>
                      {canGoLive && (
                        <Button size="sm" className="h-8 text-xs text-white border-0" style={{ background: "#22C55E" }} onClick={() => setConcludeOpen(true)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Go-live
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-[9px] uppercase text-muted-foreground">Aberta em</span>
                  <span className="text-[11px] font-mono font-semibold">{formatDate(journey.aberta_em)}</span>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-[9px] uppercase text-muted-foreground">Onb</span>
                  <span className="text-[11px] font-mono font-semibold">{formatMinUtil(journey.sla_onb_util_min)}</span>
                  <span className="text-[10px] text-muted-foreground">· pausa {formatMinUtil(journey.sla_onb_pausado_min)}</span>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-[9px] uppercase text-muted-foreground">Impl</span>
                  <span className="text-[11px] font-mono font-semibold">
                    {journey.implantacao_iniciada_em ? formatMinUtil(journey.sla_imp_util_min) : "—"}
                  </span>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-[9px] uppercase text-muted-foreground">Total</span>
                  <span className="text-[11px] font-mono font-semibold">{formatMin(journey.sla_total_corrido_min)}</span>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-[9px] uppercase text-muted-foreground">Go-live</span>
                  <span className="text-[11px] font-mono font-semibold">{formatDate(journey.go_live_previsto)}</span>
                </div>
              </div>
            </DialogHeader>

            {/* Trilho da jornada */}
            <div className="px-6 py-3 border-b border-border bg-muted/10 shrink-0">
              {(() => {
                const fase = journey.fase_atual;
                const situ = journey.situacao;
                const isConcl = situ === "concluido";
                const isCanc = situ === "cancelado";
                const s1: string = fase === "onboarding" ? "cur" : "done";
                const s2 = (isConcl || isCanc) ? "done" : (fase === "implantacao" ? "cur" : "todo");
                const s3 = isConcl ? "done" : (isCanc ? "canc" : "todo");
                const line1 = s1 === "done";
                const line2 = isConcl ? "full" : (fase === "implantacao" ? "half" : "none");
                const nodeCls = (s: string) =>
                  s === "done" ? "bg-[#22C55E] text-[#052012]"
                  : s === "cur" ? "bg-[#0EA5E9] text-[#04202e] ring-4 ring-[#0EA5E9]/20"
                  : s === "canc" ? "bg-destructive text-white"
                  : "bg-muted text-muted-foreground";
                const Node = ({ s, n }: { s: string; n: string }) => (
                  <div className={`h-6 w-6 rounded-full grid place-items-center text-[11px] font-mono font-semibold shrink-0 ${nodeCls(s)}`}>
                    {s === "done" ? "✓" : s === "canc" ? <Ban className="h-3 w-3" /> : n}
                  </div>
                );
                const Line = ({ mode }: { mode: string }) => (
                  <div className="flex-1 h-0.5 mx-3 rounded bg-muted relative overflow-hidden">
                    {mode === "full" && <span className="absolute inset-0" style={{ background: "linear-gradient(90deg,#22C55E,#0EA5E9)" }} />}
                    {mode === "half" && <span className="absolute inset-y-0 left-0 w-1/2 bg-[#0EA5E9]" />}
                  </div>
                );
                return (
                  <div className="flex items-center">
                    <div className="flex items-center gap-2.5">
                      <Node s={s1} n="1" />
                      <div>
                        <div className={`text-xs font-medium ${s1==="todo"?"text-muted-foreground":""}`}>Onboarding</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{formatMinUtil(journey.sla_onb_util_min)}</div>
                      </div>
                    </div>
                    <Line mode={line1 ? "full" : "none"} />
                    <div className="flex items-center gap-2.5">
                      <Node s={s2} n="2" />
                      <div>
                        <div className={`text-xs font-medium ${s2==="todo"?"text-muted-foreground":""}`}>
                          Implantação{s2==="cur" && journey.stage_nome ? ` · ${journey.stage_nome}` : ""}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {s2==="cur" ? `${formatMinUtil(journey.etapa_atual_min)} nesta etapa` : s2==="done" ? formatMinUtil(journey.sla_imp_util_min) : "não iniciada"}
                        </div>
                      </div>
                    </div>
                    <Line mode={line2} />
                    <div className="flex items-center gap-2.5">
                      <Node s={s3} n="3" />
                      <div>
                        <div className={`text-xs font-medium ${s3==="todo"?"text-muted-foreground":""}`}>Go-live</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {s3==="done" ? formatDate(journey.go_live_real || journey.go_live_previsto) : s3==="canc" ? "cancelada" : formatDate(journey.go_live_previsto)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 pt-4">
                <div className="inline-flex bg-muted/40 border border-border rounded-lg p-0.5">
                  <button onClick={() => setActiveTab("atividade")}
                    className={`px-4 py-1.5 text-xs rounded-md transition-colors ${activeTab==="atividade" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Atividade</button>
                  <button onClick={() => setActiveTab("timeline")}
                    className={`px-4 py-1.5 text-xs rounded-md transition-colors ${activeTab==="timeline" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Timeline</button>
                  <button onClick={() => setActiveTab("geral")}
                    className={`px-4 py-1.5 text-xs rounded-md transition-colors ${activeTab==="geral" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Visão geral</button>
                </div>
              </div>

              {activeTab === "atividade" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-5">
                  {/* LEFT */}
                  <div className="space-y-5">
                    {/* Checklist */}
                  {secVisible("checklist") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border">
                        <h3 className="text-sm font-semibold">Checklist da etapa</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{journey.stage_nome}</p>
                      </div>
                      <div className="p-3 space-y-2">
                        {checklist.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">Sem itens de checklist para esta etapa.</p>
                        ) : (
                          <div className="space-y-3">
                            {checklistSections.map((sec) => {
                              const collapsed = checklistCollapsed[sec.key];
                              const doneCount = sec.items.filter((i) => i.done).length;
                              return (
                              <div key={sec.key} className="space-y-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleChecklistGroup(sec.key)}
                                  className="w-full flex items-center gap-1.5 text-left"
                                >
                                  <ChevronRight className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`} />
                                  <span className="text-[11px] font-semibold text-foreground/80">{sec.nome}</span>
                                  <span className={`text-[10px] font-normal ${doneCount === sec.items.length ? "text-primary" : "text-muted-foreground"}`}>
                                    {doneCount}/{sec.items.length}
                                  </span>
                                </button>
                                {!collapsed && sec.items.map((c) => (
                                  <div key={c.id} className="group/ci flex items-start gap-2 pl-1">
                                    <Checkbox
                                      id={`ci-${c.id}`}
                                      checked={c.done}
                                      onCheckedChange={(v) => toggleChecklistItem(c, !!v)}
                                      className="mt-0.5"
                                    />
                                    <label htmlFor={`ci-${c.id}`} className={`flex-1 text-xs cursor-pointer ${c.done ? "line-through text-muted-foreground" : ""}`}>
                                      {c.texto}
                                      {c.is_required && (
                                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-destructive font-medium uppercase">
                                          <AlertCircle className="h-2.5 w-2.5" />obrigatório
                                        </span>
                                      )}
                                    </label>
                                    {c.origem === "manual" && (
                                      <button
                                        onClick={() => deleteManualChecklistItem(c.id)}
                                        className="opacity-0 group-hover/ci:opacity-100 text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                                        title="Remover item personalizado"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              );
                            })}
                          </div>
                        )}
                        {/* Adicionar item personalizado (independe da etapa) */}
                        {!isConcluded && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <Input
                              value={novoManual}
                              onChange={(e) => setNovoManual(e.target.value)}
                              placeholder="+ item personalizado"
                              className="h-8 text-xs"
                              onKeyDown={(e) => { if (e.key === "Enter") addManualChecklistItem(); }}
                            />
                            <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 cursor-pointer" title="Obrigatório trava o avanço">
                              <Checkbox checked={novoManualReq} onCheckedChange={(v) => setNovoManualReq(!!v)} className="scale-90" />
                              obrig.
                            </label>
                            <Button size="icon" variant="secondary" className="h-8 w-8 shrink-0" onClick={addManualChecklistItem} disabled={!novoManual.trim()}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        <Separator className="my-2" />
                        <div className="flex items-center gap-2">
                          <Select value={nextStageId} onValueChange={setNextStageId}>
                            <SelectTrigger className="flex-1 h-8 text-xs">
                              <SelectValue placeholder="Próxima etapa (padrão: seguinte)" />
                            </SelectTrigger>
                            <SelectContent>
                              {stages
                                .filter((s) => s.id !== journey.current_stage_id)
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" onClick={handleAdvance} disabled={isPaused || isConcluded}>
                            Avançar <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                        {isPaused && !isConcluded && (
                          <p className="text-[10px] text-muted-foreground">Retome o onboarding para avançar de etapa.</p>
                        )}
                        {isConcluded && (
                          <p className="text-[10px] text-muted-foreground">Jornada concluída — reabra para movimentar etapas.</p>
                        )}
                      </div>
                    </section>
                  )}

                    {/* Treinos */}
                  {secVisible("treinos") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between">
                        <button type="button" onClick={() => toggleSec("treinos")} className="flex items-center gap-2 flex-1 text-left">
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${secOpen.treinos ? "rotate-90" : ""}`} />
                          <h3 className="text-sm font-semibold flex items-center gap-2">
                            <GraduationCap className="h-4 w-4" /> Sub-tickets de treino
                          </h3>
                        </button>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{trainings.length}</Badge>
                          {canScheduleTraining && (
                            <Popover open={addTrainingOpen} onOpenChange={setAddTrainingOpen}>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                                  <UserPlus className="h-3 w-3" /> Agendar treino
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96 space-y-3" align="end">
                                {scheduleAlert}
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium">Título *</label>
                                  <Input
                                    value={newTrainingTitle}
                                    onChange={(e) => setNewTrainingTitle(e.target.value)}
                                    placeholder="Ex: Treinamento PDV"
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium">Data/hora</label>
                                  <Input
                                    type="datetime-local"
                                    value={newTrainingDate}
                                    onChange={(e) => setNewTrainingDate(e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium">Conduzido por</label>
                                  <Select value={newTrainingConductor} onValueChange={setNewTrainingConductor}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar usuário" /></SelectTrigger>
                                    <SelectContent>
                                      {(tenantMembersQ.data ?? []).map((m) => (
                                        <SelectItem key={m.user_id} value={m.user_id} className="text-xs">{m.nome}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium">Tipo de treino</label>
                                  <Select value={newTrainingTypeId} onValueChange={setNewTrainingTypeId}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar tipo" /></SelectTrigger>
                                    <SelectContent>
                                      {(trainingTypesQ.data ?? []).map((tt) => (
                                        <SelectItem key={tt.id} value={tt.id} className="text-xs">
                                          {tt.nome}{tt.conta_como_pdv ? " · PDV" : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] font-medium">Link do agendamento</label>
                                  <Input
                                    type="url"
                                    value={newTrainingLink}
                                    onChange={(e) => setNewTrainingLink(e.target.value)}
                                    placeholder="https://meet.google.com/..."
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={newTrainingRetreat}
                                    onCheckedChange={(v) => setNewTrainingRetreat(!!v)}
                                  />
                                  É retreinamento?
                                </label>
                                {scheduleButtons}
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      </div>
                      {secOpen.treinos && (
                        <div className="p-3 space-y-2">
                          {trainings.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">
                              {canScheduleTraining
                                ? "Nenhum treino cadastrado."
                                : "Disponível a partir da última etapa do onboarding."}
                            </p>
                          ) : (
                            trainings.map((t) => {
                              const statusColors: Record<string, string> = {
                                previsto: "hsl(215 16% 47%)",
                                agendado: "hsl(199 89% 48%)",
                                realizado: "hsl(142 71% 45%)",
                                no_show: "hsl(0 84% 60%)",
                                cancelado: "hsl(215 25% 27%)",
                              };
                              const conductorName = t.conduzido_por ? memberNameMap.get(t.conduzido_por) : null;
                              const isDone = t.status === "realizado";
                              const isCancelled = t.status === "cancelado";
                              return (
                                <div key={t.id} className="rounded-md border border-border p-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium truncate">{t.titulo}</span>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] capitalize border-0 text-white"
                                      style={{ backgroundColor: statusColors[t.status] || statusColors.previsto }}
                                    >
                                      {t.status.replace("_", "-")}
                                    </Badge>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                    {t.agendado_para && <span>Agendado: {formatDateTime(t.agendado_para)}</span>}
                                    {t.realizado_em && <span>Realizado: {formatDateTime(t.realizado_em)}</span>}
                                    {conductorName && <span>Por: {conductorName}</span>}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    {(t.tentativas ?? 0) > 0 && (
                                      <Badge variant="outline" className="text-[9px]">tentativas: {t.tentativas}</Badge>
                                    )}
                                    {t.no_show && <Badge variant="destructive" className="text-[9px]">no-show</Badge>}
                                    {t.is_retreinamento && (
                                      <Badge variant="outline" className="text-[9px] border-[hsl(262_83%_58%)] text-[hsl(262_83%_58%)]">
                                        retreinamento
                                      </Badge>
                                    )}
                                    {t.proprietario_presente && (
                                      <Badge variant="outline" className="text-[9px] border-[hsl(142_71%_45%)] text-[hsl(142_71%_45%)]">
                                        proprietário presente
                                      </Badge>
                                    )}
                                  </div>
                                  {t.link_agendamento && (
                                    <a
                                      href={t.link_agendamento}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-[hsl(199_89%_48%)] hover:underline max-w-full"
                                      title={t.link_agendamento}
                                    >
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                      <span className="truncate">Link do agendamento</span>
                                    </a>
                                  )}
                                  {!isCancelled && (
                                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                                      {!isDone && (
                                        <>
                                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                            onClick={() => handleMarkRealized(t.id)}>
                                            <CheckCircle2 className="h-3 w-3 mr-1" /> Realizado
                                          </Button>
                                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                            onClick={() => handleMarkNoShow(t.id, t.tentativas ?? 0)}>
                                            No-show
                                          </Button>
                                        </>
                                      )}
                                      <Popover
                                        open={rescheduleId === t.id}
                                        onOpenChange={(o) => {
                                          setRescheduleId(o ? t.id : null);
                                          if (!o) setRescheduleDate("");
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                                            <Calendar className="h-3 w-3 mr-1" /> Remarcar
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72 space-y-2" align="start">
                                          <label className="text-[11px] font-medium">Nova data/hora</label>
                                          <Input
                                            type="datetime-local"
                                            value={rescheduleDate}
                                            onChange={(e) => setRescheduleDate(e.target.value)}
                                            className="h-8 text-xs"
                                          />
                                          <Button size="sm" className="w-full h-7 text-xs"
                                            onClick={() => handleReschedule(t.id, t.tentativas ?? 0)}>
                                            Confirmar
                                          </Button>
                                        </PopoverContent>
                                      </Popover>
                                      <Popover
                                        open={linkEditId === t.id}
                                        onOpenChange={(o) => {
                                          setLinkEditId(o ? t.id : null);
                                          setLinkEditValue(o ? (t.link_agendamento ?? "") : "");
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                                            <Link2 className="h-3 w-3 mr-1" /> {t.link_agendamento ? "Editar link" : "Adicionar link"}
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72 space-y-2" align="start">
                                          <label className="text-[11px] font-medium">Link do agendamento</label>
                                          <Input
                                            type="url"
                                            value={linkEditValue}
                                            onChange={(e) => setLinkEditValue(e.target.value)}
                                            placeholder="https://meet.google.com/..."
                                            className="h-8 text-xs"
                                          />
                                          <Button size="sm" className="w-full h-7 text-xs"
                                            onClick={() => handleSaveLink(t.id)}>
                                            Salvar
                                          </Button>
                                        </PopoverContent>
                                      </Popover>
                                      {isDone && (
                                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                          onClick={() => handleTogglePresente(t.id, !!t.proprietario_presente)}>
                                          {t.proprietario_presente ? "Marcar ausente" : "Proprietário presente"}
                                        </Button>
                                      )}
                                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground"
                                        onClick={() => handleCancelTraining(t.id)}>
                                        Cancelar
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </section>
                  )}

                    {/* Contabilidade */}
                  {secVisible("contabilidade") && (
                    <AccountingCard
                      fields={accountingFieldsQ.data ?? []}
                      values={accountingValuesQ.data ?? []}
                      loading={accountingFieldsQ.isLoading}
                      onSave={async (fieldId, valor, coletado) => {
                        if (!tenantId || !journeyId) return;
                        const { error } = await (supabase.from("onboarding_journey_accounting" as any) as any)
                          .upsert(
                            { tenant_id: tenantId, journey_id: journeyId, field_id: fieldId, valor, coletado },
                            { onConflict: "journey_id,field_id" }
                          );
                        if (error) { toast.error(error.message); return; }
                        qc.invalidateQueries({ queryKey: ["onboarding-accounting-values", journeyId, tenantId] });
                      }}
                    />
                  )}

                </div>

                {/* RIGHT */}
                <div className="space-y-5">
                    {/* Tags de controle */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Tag className="h-4 w-4" /> Tags de controle
                      </h3>
                      <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 text-xs">
                            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="end">
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {(() => {
                              const assignedIds = new Set((journeyTagsQ.data ?? []).map((a) => a.id));
                              const disponiveis = (availableTagsQ.data ?? []).filter((t) => !assignedIds.has(t.id));
                              if (disponiveis.length === 0) {
                                return <p className="text-[11px] text-muted-foreground px-2 py-1.5 text-center">Nenhuma tag disponível.</p>;
                              }
                              return disponiveis.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => handleAddTag(t.id)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                                >
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                                  <span className="text-xs truncate">{t.name}</span>
                                </button>
                              ));
                            })()}
                          </div>
                          <Separator className="my-2" />
                          <div className="space-y-1.5">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">Criar nova</p>
                            <div className="flex items-center gap-1 px-1">
                              {TAG_PALETTE.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setQuickTagColor(c)}
                                  className={`h-5 w-5 rounded-full transition-transform ${quickTagColor === c ? "ring-2 ring-foreground/50 scale-110" : ""}`}
                                  style={{ background: c }}
                                  title={c}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={quickTagName}
                                onChange={(e) => setQuickTagName(e.target.value)}
                                placeholder="Ex: Pendente faturamento"
                                className="h-8 text-xs"
                                onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndAddTag(); }}
                              />
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8 shrink-0"
                                onClick={handleCreateAndAddTag}
                                disabled={!quickTagName.trim() || creatingTag}
                              >
                                {creatingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="p-3">
                      {(journeyTagsQ.data ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1 text-center">
                          Nenhuma tag. Use “Adicionar” para sinalizar controle (ex: pendente faturamento).
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(journeyTagsQ.data ?? []).map((t) => (
                            <span
                              key={t.assignmentId}
                              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium"
                              style={{ background: t.color, color: readableOn(t.color) }}
                            >
                              {t.name}
                              <button
                                onClick={() => handleRemoveTag(t.assignmentId)}
                                className="opacity-70 hover:opacity-100"
                                title="Remover tag"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                    {/* Participantes */}
                  {secVisible("participantes") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Users className="h-4 w-4" /> Responsável & participantes
                        </h3>
                        <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setTransferOpen(true)}
                        >
                          <ArrowRight className="h-3.5 w-3.5 mr-1" /> Transferir
                        </Button>
                        <Popover open={addParticipantOpen} onOpenChange={setAddParticipantOpen}>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 text-xs">
                              <UserPlus className="h-3.5 w-3.5 mr-1" /> Adicionar
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 space-y-3" align="end">
                            <div>
                              <label className="text-xs font-medium">Usuário</label>
                              <Select value={newParticipantUserId} onValueChange={setNewParticipantUserId}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {(tenantMembersQ.data ?? []).map((u) => (
                                    <SelectItem key={u.user_id} value={u.user_id}>{u.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="text-xs font-medium">Papel</label>
                              <Select value={newParticipantRoleId} onValueChange={setNewParticipantRoleId}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {rolesAtivos.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button size="sm" className="w-full" onClick={handleAddParticipant}>Adicionar</Button>
                          </PopoverContent>
                        </Popover>
                        </div>
                      </div>
                      <div className="p-3 space-y-2">
                        {!journey?.responsavel_user_id && (
                          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
                            <span className="text-xs text-muted-foreground">Sem responsável definido.</span>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTransferOpen(true)}>
                              Definir responsável
                            </Button>
                          </div>
                        )}
                        {(participantsQ.data ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">Nenhum participante cadastrado.</p>
                        ) : (
                          roles.map((role) => {
                            const rows = (participantsQ.data ?? []).filter((p) => p.role_id === role.id);
                            if (!rows.length) return null;
                            return (
                              <div key={role.id} className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[10px] uppercase tracking-wide font-semibold"
                                    style={{ color: role.cor }}
                                  >
                                    {role.nome}
                                  </span>
                                  {!role.ativo && (
                                    <span className="text-[9px] text-muted-foreground">(papel inativo)</span>
                                  )}
                                </div>
                                {rows.map((p) => {
                                  // O responsavel e marcado onde ele estiver: a responsabilidade
                                  // nao depende mais do papel.
                                  const isResp = p.user_id === journey?.responsavel_user_id;
                                  return (
                                  <div
                                    key={p.id}
                                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                                    style={
                                      isResp
                                        ? { borderColor: role.cor, background: `${role.cor}14` }
                                        : undefined
                                    }
                                  >
                                    {isResp ? (
                                      <Star className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} fill={role.cor} />
                                    ) : (
                                      <User className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} />
                                    )}
                                    <span className="text-xs flex-1 truncate">
                                      {memberNameMap.get(p.user_id) || "—"}
                                    </span>
                                    {isResp && (
                                      <Badge
                                        className="text-[9px] border-0 text-white"
                                        style={{ background: role.cor }}
                                      >
                                        Responsável
                                      </Badge>
                                    )}
                                    {podeEditarPapel ? (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button
                                            type="button"
                                            title="Alterar papel"
                                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-opacity hover:opacity-70"
                                            style={{ borderColor: role.cor, color: role.cor }}
                                          >
                                            {role.nome}
                                            <ChevronDown className="h-2.5 w-2.5" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-48 p-1" align="end">
                                          {rolesAtivos.map((r) => (
                                            <button
                                              key={r.id}
                                              type="button"
                                              onClick={() => handleChangeParticipantRole(p.id, r.id)}
                                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
                                            >
                                              <span
                                                className="h-2 w-2 shrink-0 rounded-full"
                                                style={{ background: r.cor }}
                                              />
                                              <span className="flex-1 truncate">{r.nome}</span>
                                              {r.id === role.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                                            </button>
                                          ))}
                                        </PopoverContent>
                                      </Popover>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px]"
                                        style={{ borderColor: role.cor, color: role.cor }}
                                      >
                                        {role.nome}
                                      </Badge>
                                    )}
                                    {isResp ? (
                                      // Remover o responsavel deixaria a jornada com um
                                      // responsavel que nao aparece na lista. Transfira antes.
                                      <span className="w-6 shrink-0" />
                                    ) : (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 shrink-0"
                                        onClick={() => handleRemoveParticipant(p.id, p.user_id, role.nome)}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            );
                          })
                        )}
                        {journeyId && (
                          <ResponsavelHistorico
                            journeyId={journeyId}
                            tenantId={tenantId}
                            nomePorUserId={memberNameMap}
                          />
                        )}
                      </div>
                    </section>
                  )}

                    {/* Modulos */}
                  {secVisible("modulos") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                        <button type="button" onClick={() => toggleSec("modulos")} className="flex items-center gap-2 flex-1 text-left">
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${secOpen.modulos ? "rotate-90" : ""}`} />
                          <h3 className="text-sm font-semibold flex items-center gap-2">
                            <Package className="h-4 w-4" /> Módulos da jornada
                          </h3>
                        </button>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{(modulesQ.data ?? []).length}</Badge>
                          {(clienteProdutoModulosQ.data ?? []).length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={handleImportFromCliente}
                            >
                              <Download className="h-3 w-3" /> Importar do cliente
                            </Button>
                          )}
                          <Popover open={addModuleOpen} onOpenChange={setAddModuleOpen}>
                            <PopoverTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                                <Plus className="h-3 w-3" /> Adicionar módulo
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 space-y-3" align="end">
                              <div className="space-y-1">
                                <label className="text-[11px] font-medium">Nome do módulo</label>
                                <div className="flex gap-1.5">
                                  <Input
                                    value={newModuleName}
                                    onChange={(e) => setNewModuleName(e.target.value)}
                                    placeholder="Ex: PDV, Financeiro"
                                    className="h-8 text-xs"
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddModuleManual(); } }}
                                  />
                                  <Button size="sm" className="h-8 px-3" onClick={handleAddModuleManual}>Add</Button>
                                </div>
                              </div>
                              {(produtoModulosQ.data ?? []).length > 0 && (
                                <>
                                  <Separator />
                                  <div className="space-y-1">
                                    <label className="text-[11px] font-medium">Ou escolher do produto</label>
                                    <div className="flex gap-1.5">
                                      <Select value={newModuleProdutoModuloId} onValueChange={setNewModuleProdutoModuloId}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar módulo" /></SelectTrigger>
                                        <SelectContent>
                                          {(produtoModulosQ.data ?? []).map((m) => (
                                            <SelectItem key={m.id} value={m.id} className="text-xs">{m.nome}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Button size="sm" className="h-8 px-3" onClick={handleAddModuleFromProduto} disabled={!newModuleProdutoModuloId}>Add</Button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                      {secOpen.modulos && (
                        <div className="p-3 space-y-1.5">
                          {(modulesQ.data ?? []).length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">Nenhum módulo cadastrado.</p>
                          ) : (
                            (modulesQ.data ?? []).map((m) => {
                              const origemColor: Record<string, string> = {
                                manual: "hsl(215 16% 47%)",
                                produto: "hsl(199 89% 48%)",
                                cliente: "hsl(262 83% 58%)",
                              };
                              return (
                                <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-medium truncate">{m.nome}</span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] capitalize border-0 text-white shrink-0"
                                      style={{ backgroundColor: origemColor[m.origem] || origemColor.manual }}
                                    >
                                      {m.origem}
                                    </Badge>
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                    onClick={() => handleDeleteModule(m.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </section>
                  )}

                    {/* Anexos */}
                  {secVisible("anexos") && journey?.ticket_id && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between">
                        <button type="button" onClick={() => toggleSec("anexos")} className="flex items-center gap-2 flex-1 text-left">
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${secOpen.anexos ? "rotate-90" : ""}`} />
                          <h3 className="text-sm font-semibold">Anexos</h3>
                        </button>
                      </div>
                      {secOpen.anexos && (
                        <div className="p-3">
                          <TicketAttachments
                            ticketId={journey.ticket_id}
                            tenantId={tenantId!}
                          />
                        </div>
                      )}
                    </section>
                  )}

                    {/* Atendimentos */}
                  {secVisible("atendimentos") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between">
                        <button type="button" onClick={() => toggleSec("atendimentos")} className="flex items-center gap-2 flex-1 text-left">
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${secOpen.atendimentos ? "rotate-90" : ""}`} />
                          <h3 className="text-sm font-semibold flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" /> Atendimentos vinculados
                          </h3>
                        </button>
                        <Badge variant="outline" className="text-[10px]">{attendances.length}</Badge>
                      </div>
                      {secOpen.atendimentos && (
                        <div className="p-3 space-y-2">
                          {attendances.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">Nenhum atendimento vinculado.</p>
                          ) : (
                            <>
                              {(() => {
                                const avg = (key: string) => {
                                  const vals = attendances
                                    .map((a: any) => a[key])
                                    .filter((v: any) => typeof v === "number" && !isNaN(v));
                                  if (vals.length === 0) return null;
                                  return vals.reduce((s: number, v: number) => s + v, 0) / vals.length / 60;
                                };
                                const espera = avg("wait_seconds");
                                const resposta = avg("first_response_time_seconds");
                                const atendimento = avg("handle_seconds");
                                return (
                                  <div className="grid grid-cols-3 gap-2 mb-1">
                                    <div className="rounded-md border border-border p-2">
                                      <div className="text-[10px] text-muted-foreground">T. médio de espera</div>
                                      <div className="text-sm font-semibold">{formatMin(espera)}</div>
                                    </div>
                                    <div className="rounded-md border border-border p-2">
                                      <div className="text-[10px] text-muted-foreground">T. médio de resposta</div>
                                      <div className="text-sm font-semibold">{formatMin(resposta)}</div>
                                    </div>
                                    <div className="rounded-md border border-border p-2">
                                      <div className="text-[10px] text-muted-foreground">T. médio de atendimento</div>
                                      <div className="text-sm font-semibold">{formatMin(atendimento)}</div>
                                    </div>
                                  </div>
                                );
                              })()}
                              <div className="space-y-1.5">
                                {attendances.map((a) => (
                                  <div key={a.id} className="rounded-md border border-border p-2 flex items-center gap-2">
                                    <span className="font-mono text-[11px] text-primary">{a.attendance_code}</span>
                                    <span className="text-[11px] text-muted-foreground truncate flex-1">
                                      {a.participant_label || "—"}
                                    </span>
                                    <Badge variant="outline" className="text-[9px] capitalize">{a.status}</Badge>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  )}

                </div>
              </div>
              )}

              {activeTab === "timeline" && (
                <div className="p-5">
                  <div className="space-y-4">
                    {/* Resumo — sempre sobre o total; é metadado da jornada, não muda com filtro */}
                    {events.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-border p-2.5">
                          <div className="text-[10px] text-muted-foreground">Eventos</div>
                          <div className="text-lg font-semibold tabular-nums leading-tight">{events.length}</div>
                        </div>
                        <div className="rounded-lg border border-border p-2.5">
                          <div className="text-[10px] text-muted-foreground">Início da jornada</div>
                          <div className="text-xs font-semibold mt-1">{formatDate(events[events.length - 1].created_at)}</div>
                        </div>
                        <div className="rounded-lg border border-border p-2.5">
                          <div className="text-[10px] text-muted-foreground">Última atividade</div>
                          <div className="text-xs font-semibold mt-1">{formatDateTime(events[0].created_at)}</div>
                        </div>
                      </div>
                    )}

                    {/* Filtros da timeline */}
                    {events.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setTlOnlyMine((v) => !v)}
                          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] transition-colors ${
                            tlOnlyMine
                              ? "border-primary/40 bg-primary/10 text-primary font-medium"
                              : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {tlOnlyMine ? <Check className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          Somente as minhas
                        </button>

                        <Popover open={tlTypesOpen} onOpenChange={setTlTypesOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] transition-colors ${
                                tlTypes.length > 0
                                  ? "border-primary/40 bg-primary/10 text-primary font-medium"
                                  : "border-border text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              Tipos{tlTypes.length > 0 ? ` (${tlTypes.length})` : ""}
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64 p-2">
                            <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-border">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Tipos de movimentação</span>
                              {tlTypes.length > 0 && (
                                <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setTlTypes([])}>
                                  limpar
                                </button>
                              )}
                            </div>
                            {tlTypeOptions.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground px-1 py-2">Nada para filtrar nesta jornada.</p>
                            ) : (
                              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                                {tlTypeOptions.map((o) => {
                                  const checked = tlTypes.includes(o.type);
                                  return (
                                    <label key={o.type} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted cursor-pointer">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={() =>
                                          setTlTypes((prev) => (checked ? prev.filter((t) => t !== o.type) : [...prev, o.type]))
                                        }
                                      />
                                      <span className="text-[11px] flex-1 truncate">{o.label}</span>
                                      <span className="text-[10px] text-muted-foreground tabular-nums">{o.n}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>

                        {tlFiltersActive && (
                          <button
                            type="button"
                            onClick={() => { setTlOnlyMine(false); setTlTypes([]); }}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" /> Limpar filtros
                          </button>
                        )}
                      </div>
                    )}

                    {/* Notas (esquerda) x movimentação/log (direita) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                      <section className="rounded-lg border border-border">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                          <div className="flex items-center gap-2">
                            <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide">Notas</h3>
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{tlNotes.length}</span>
                        </div>
                        <div className="p-3 space-y-4">
                          {!isConcluded && (
                            <div>
                              <Textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Adicionar nota do agente à timeline..."
                                rows={2}
                                className="text-xs"
                              />
                              <div className="flex justify-end mt-2">
                                <Button size="sm" onClick={handleAddNote} disabled={!note.trim()}>
                                  <StickyNote className="h-3.5 w-3.5 mr-1.5" /> Adicionar nota
                                </Button>
                              </div>
                            </div>
                          )}
                          {tlNotes.length === 0 ? (
                            <div className="py-8 text-center">
                              <StickyNote className="h-7 w-7 mx-auto text-muted-foreground/30" />
                              <p className="text-xs text-muted-foreground mt-2">
                                {tlOnlyMine ? "Nenhuma nota sua nesta jornada." : "Nenhuma nota registrada ainda."}
                              </p>
                            </div>
                          ) : (
                            <TimelineDayGroups groups={tlNotesByDay} authorOf={tlAuthorOf} />
                          )}
                        </div>
                      </section>

                      <section className="rounded-lg border border-border">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide">Movimentação</h3>
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{tlLogs.length}</span>
                        </div>
                        <div className="p-3">
                          {tlLogs.length === 0 ? (
                            <div className="py-8 text-center">
                              <Clock className="h-7 w-7 mx-auto text-muted-foreground/30" />
                              <p className="text-xs text-muted-foreground mt-2">
                                {tlFiltersActive ? "Nenhuma movimentação com os filtros atuais." : "Sem movimentações registradas."}
                              </p>
                            </div>
                          ) : (
                            <TimelineDayGroups groups={tlLogsByDay} authorOf={tlAuthorOf} />
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "geral" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-5">
                  {/* LEFT */}
                  <div className="space-y-5">
                    {/* Timeline */}
                  {secVisible("timeline") && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border">
                        <h3 className="text-sm font-semibold">Linha do tempo das etapas</h3>
                      </div>
                      <div className="p-3 space-y-2">
                        {stages.map((s, idx) => {
                          const h = historyByStage[s.id];
                          const isCurrent = s.id === journey.current_stage_id;
                          const isPast = currentStageIndex >= 0 && idx < currentStageIndex;
                          const dot = s.cor || "hsl(var(--muted-foreground))";
                          return (
                            <div
                              key={s.id}
                              className={`flex items-start gap-3 rounded-md p-2 ${
                                isCurrent ? "bg-primary/5 border border-primary/30" : ""
                              } ${!isCurrent && !isPast ? "opacity-50" : ""}`}
                            >
                              <div className="mt-0.5">
                                {isPast ? (
                                  <CheckCircle2 className="h-4 w-4 text-primary" />
                                ) : isCurrent ? (
                                  <div className="h-4 w-4 rounded-full ring-2 ring-primary/40" style={{ background: dot }} />
                                ) : (
                                  <Circle className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium truncate">{s.nome}</span>
                                  {h?.duracao_minutos != null && !isCurrent && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">{formatMinUtil(h.duracao_util_minutos ?? h.duracao_minutos)}</span>
                                  )}
                                  {isCurrent && journey.etapa_atual_min != null && (
                                    <span className="text-[10px] font-medium shrink-0" style={{ color: slaColor }}>
                                      {formatMinUtil(journey.etapa_atual_min)}
                                    </span>
                                  )}
                                </div>
                                {h?.entrou_em && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Entrou {formatDateTime(h.entrou_em)}
                                    {h.saiu_em && ` • saiu ${formatDateTime(h.saiu_em)}`}
                                  </p>
                                )}
                                {(isCurrent || isPast) && accumulatedByStage[s.id] > 0 && (
                                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                                    Acumulado até aqui: <span className="font-medium text-foreground/80">{formatMinUtil(accumulatedByStage[s.id])}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                    {/* Histórico de checklists por etapa */}
                  {secVisible("checklist") && (journeyChecklistAllQ.data?.length ?? 0) > 0 && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border">
                        <h3 className="text-sm font-semibold">Checklists por etapa</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Histórico do que foi realizado na jornada</p>
                      </div>
                      <div className="p-3 space-y-3">
                        {checklistHistory.map((st) => (
                          <div key={st.stageId} className="rounded-md border border-border/60">
                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/60 bg-muted/30">
                              <span className="text-xs font-medium truncate">{st.nome}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{st.done}/{st.total}</span>
                            </div>
                            <div className="p-2 space-y-2">
                              {st.groups.map((g) => (
                                <div key={g.nome} className="space-y-1">
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{g.nome}</p>
                                  {g.items.map((it) => (
                                    <div key={it.id} className="flex items-start gap-2">
                                      {it.done ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                                      ) : (
                                        <Circle className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <span className={`text-xs ${it.done ? "text-foreground" : "text-muted-foreground"}`}>{it.texto}</span>
                                        {it.done && it.done_at && (
                                          <span className="text-[10px] text-muted-foreground ml-1.5">{formatDateTime(it.done_at)}</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                    {/* Pausas */}
                  {secVisible("pausas") && pausesByReason.length > 0 && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Pause className="h-4 w-4" /> Tempo parado por motivo
                        </h3>
                        <Badge variant="outline" className="text-[10px]">{pausesByReason.length}</Badge>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {pausesByReason.map((p) => (
                          <div key={p.nome} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-medium truncate">{p.nome}</span>
                              {p.em_andamento && (
                                <Badge className="text-[9px] border-0 text-white shrink-0" style={{ backgroundColor: "hsl(38 92% 50%)" }}>
                                  em andamento
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground shrink-0">· {p.count}x</span>
                            </div>
                            <span className="text-xs font-medium tabular-nums">{formatMin(p.minutos)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  </div>
                  {/* RIGHT */}
                  <div className="space-y-5">
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold">SLA por fase</h3></div>
                      <div className="p-3 grid grid-cols-3 gap-3">
                        <div className="rounded-md border border-border bg-card p-2.5">
                          <div className="text-[11px] font-medium mb-1">Onboarding</div>
                          <div className="text-sm font-semibold">{formatMinUtil(journey.sla_onb_util_min)}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">pausado {formatMinUtil(journey.sla_onb_pausado_min)}</div>
                        </div>
                        <div className="rounded-md border border-border bg-card p-2.5">
                          <div className="text-[11px] font-medium mb-1">Implantação</div>
                          <div className="text-sm font-semibold">{journey.implantacao_iniciada_em ? formatMinUtil(journey.sla_imp_util_min) : "—"}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{journey.implantacao_iniciada_em ? `pausado ${formatMinUtil(journey.sla_imp_pausado_min)}` : "não iniciada"}</div>
                        </div>
                        <div className="rounded-md border border-border bg-card p-2.5">
                          <div className="text-[11px] font-medium mb-1">Total</div>
                          <div className="text-sm font-semibold">{formatMin(journey.sla_total_corrido_min)}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">efetivo {formatMinUtil(journey.sla_total_util_min)}</div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    {journey && journey.ticket_id && (
      <StartConversationFromTicketDialog
        open={startConvOpen}
        onOpenChange={setStartConvOpen}
        ticketId={journey.ticket_id}
        ticketCode={journey.ticket_code ?? ""}
        clienteId={journey.cliente_id ?? undefined}
        clienteNome={clienteNome}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["onboarding-attendances", journey.ticket_id] });
          qc.invalidateQueries({ queryKey: ["onboarding-events", journey.ticket_id] });
        }}
      />
    )}
    <Dialog open={concludeOpen} onOpenChange={setConcludeOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Go-live?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Ao concluir, os relógios de SLA serão congelados e a etapa/pausa em aberto será fechada.
        </p>
        {!(journey?.fase_atual === "implantacao" && etapaFinal) && (
          <Alert className="border-warning/50 bg-warning/15 text-warning [&>svg]:text-warning py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Você está registrando o Go-live antes da etapa final da implantação (permissão de administrador).
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium">Go-live real (opcional)</label>
          <Input type="date" value={goLiveReal} onChange={(e) => setGoLiveReal(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setConcludeOpen(false)}>Cancelar</Button>
          <Button size="sm" className="text-white border-0" style={{ background: "#22C55E" }} onClick={handleConclude}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar Go-live
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" /> Cancelar jornada?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A jornada será encerrada como cancelada, os relógios de SLA congelados e a etapa/pausa em aberto fechada. O motivo fica registrado no histórico.
        </p>
        <div className="space-y-1">
          <label className="text-xs font-medium">Motivo do cancelamento *</label>
          <Textarea value={cancelMotivo} onChange={(e) => setCancelMotivo(e.target.value)} rows={4} placeholder="Descreva o motivo..." />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setCancelOpen(false)}>Voltar</Button>
          <Button variant="destructive" size="sm" onClick={handleCancel}>
            <Ban className="h-4 w-4 mr-1" /> Confirmar cancelamento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" style={{ color: "hsl(38 92% 50%)" }} />
            Retornar ao vendedor
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Vendedor *</label>
            <Select value={returnVendorId} onValueChange={setReturnVendorId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecionar usuário" /></SelectTrigger>
              <SelectContent>
                {(tenantMembersQ.data ?? []).map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id} className="text-xs">{u.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Motivo *</label>
            <Select value={returnReasonId} onValueChange={setReturnReasonId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
              <SelectContent>
                {(vendorReturnReasonsQ.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {r.nome}
                      {r.atribuivel_vendedor && (
                        <Badge className="text-[9px] border-0 text-white" style={{ backgroundColor: "hsl(38 92% 50%)" }}>
                          atribuível
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Observação (opcional)</label>
            <Textarea value={returnText} onChange={(e) => setReturnText(e.target.value)} rows={3} className="text-xs" />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox checked={returnPauseSla} onCheckedChange={(v) => setReturnPauseSla(!!v)} />
            Pausar SLA enquanto aguarda o vendedor
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setReturnOpen(false)}>Cancelar</Button>
          <Button size="sm" className="text-white border-0" style={{ background: "hsl(38 92% 50%)" }} onClick={handleReturnToVendor}>
            <AlertTriangle className="h-4 w-4 mr-1" /> Confirmar retorno
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {journeyId && (
      <TransferResponsavelDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        journeyId={journeyId}
        responsavelAtualNome={journey?.responsavel_nome ?? null}
        membros={tenantMembersQ.data ?? []}
        onTransferido={() => {
          qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
          qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
          qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
          qc.invalidateQueries({ queryKey: ["onboarding-responsavel-history"] });
          qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
        }}
      />
    )}
    </>

  );
}

type AccField = { id: string; nome: string; tipo: "text" | "number" | "date" | "option" | "boolean"; opcoes: string[] | null; position: number };
type AccValue = { id: string; field_id: string; valor: string | null; coletado: boolean };

function AccountingCard({
  fields, values, loading, onSave,
}: {
  fields: AccField[];
  values: AccValue[];
  loading: boolean;
  onSave: (fieldId: string, valor: string | null, coletado: boolean) => Promise<void>;
}) {
  const byField = useMemo(() => {
    const m = new Map<string, AccValue>();
    values.forEach((v) => m.set(v.field_id, v));
    return m;
  }, [values]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const total = fields.length;
  const coletados = fields.reduce((n, f) => n + (byField.get(f.id)?.coletado ? 1 : 0), 0);

  async function commit(field: AccField, valor: string | null, coletado: boolean) {
    setSavingId(field.id);
    try { await onSave(field.id, valor, coletado); } finally { setSavingId(null); }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-border">
        <div className="p-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      </section>
    );
  }

  if (total === 0) return null;

  return (
    <section className="rounded-lg border border-border">
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 text-left">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4" /> Dados da contabilidade
          </h3>
        </button>
        <Badge variant="outline" className="text-[10px]">{coletados} de {total} coletados</Badge>
      </div>
      {open && (
        <div className="p-3 space-y-2.5">
          {fields.map((f) => {
            const cur = byField.get(f.id);
            const rawValor = drafts[f.id] ?? (cur?.valor ?? "");
            const coletado = cur?.coletado ?? false;
            return (
              <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <div className="min-w-0 space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{f.nome}</label>
                  {f.tipo === "text" && (
                    <Input
                      className="h-8 text-xs"
                      value={rawValor}
                      onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                      onBlur={() => { if (rawValor !== (cur?.valor ?? "")) commit(f, rawValor || null, coletado); }}
                    />
                  )}
                  {f.tipo === "number" && (
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={rawValor}
                      onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                      onBlur={() => { if (rawValor !== (cur?.valor ?? "")) commit(f, rawValor || null, coletado); }}
                    />
                  )}
                  {f.tipo === "date" && (
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={rawValor}
                      onChange={(e) => { setDrafts((d) => ({ ...d, [f.id]: e.target.value })); commit(f, e.target.value || null, coletado); }}
                    />
                  )}
                  {f.tipo === "option" && (
                    <Select
                      value={rawValor || undefined}
                      onValueChange={(v) => { setDrafts((d) => ({ ...d, [f.id]: v })); commit(f, v, coletado); }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        {(f.opcoes ?? []).map((op) => (
                          <SelectItem key={op} value={op} className="text-xs">{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {f.tipo === "boolean" && (
                    <div className="flex items-center gap-2 h-8">
                      <Checkbox
                        checked={rawValor === "true"}
                        onCheckedChange={(v) => { const nv = v ? "true" : "false"; setDrafts((d) => ({ ...d, [f.id]: nv })); commit(f, nv, coletado); }}
                      />
                      <span className="text-xs text-muted-foreground">{rawValor === "true" ? "Sim" : "Não"}</span>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0 mt-4">
                  <Checkbox
                    checked={coletado}
                    disabled={savingId === f.id}
                    onCheckedChange={(v) => commit(f, cur?.valor ?? (drafts[f.id] || null), !!v)}
                  />
                  Coletado
                </label>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

