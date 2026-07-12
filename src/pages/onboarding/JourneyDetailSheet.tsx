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
  UserPlus, Star, X, Users, Package, Plus, Trash2, Download, RotateCcw, AlertTriangle, Ban,
} from "lucide-react";


type Papel = "implantador" | "vendedor" | "especialista" | "outro";
const PAPEL_OPTIONS: { value: Papel; label: string }[] = [
  { value: "implantador", label: "Implantador" },
  { value: "vendedor", label: "Vendedor" },
  { value: "especialista", label: "Especialista" },
  { value: "outro", label: "Outro" },
];
const PAPEL_COLOR: Record<Papel, string> = {
  implantador: "hsl(142 71% 45%)",
  vendedor: "hsl(199 89% 48%)",
  especialista: "hsl(262 83% 58%)",
  outro: "hsl(215 16% 47%)",
};

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
}


const SEMAFORO_COLOR: Record<string, string> = {
  verde: "hsl(142 71% 45%)",
  amarelo: "hsl(38 92% 50%)",
  vermelho: "hsl(0 84% 60%)",
  sem_sla: "hsl(215 16% 47%)",
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

export default function JourneyDetailSheet({ open, onOpenChange, journeyId, tenantId }: Props) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
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
  const [newParticipantUserId, setNewParticipantUserId] = useState<string>("");
  const [newParticipantPapel, setNewParticipantPapel] = useState<Papel>("especialista");

  // Trainings
  const [addTrainingOpen, setAddTrainingOpen] = useState(false);
  const [addTrainingOpenTop, setAddTrainingOpenTop] = useState(false);
  const [newTrainingTitle, setNewTrainingTitle] = useState("");
  const [newTrainingDate, setNewTrainingDate] = useState("");
  const [newTrainingConductor, setNewTrainingConductor] = useState<string>("");
  const [newTrainingRetreat, setNewTrainingRetreat] = useState(false);
  const [newTrainingTypeId, setNewTrainingTypeId] = useState<string>("");

  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

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


  useEffect(() => {
    if (!open) {
      setChecked({});
      setNote("");
      setPauseReasonId("");
      setPauseText("");
      setNextStageId("");
      setAddParticipantOpen(false);
      setNewParticipantUserId("");
      setNewParticipantPapel("especialista");
      setAddTrainingOpen(false);
      setNewTrainingTitle("");
      setNewTrainingDate("");
      setNewTrainingConductor("");
      setNewTrainingRetreat(false);
      setNewTrainingTypeId("");

      setRescheduleId(null);
      setRescheduleDate("");
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
        .select("id, stage_id, entrou_em, saiu_em, duracao_minutos")
        .eq("journey_id", journeyId)
        .order("entrou_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; stage_id: string; entrou_em: string; saiu_em: string | null; duracao_minutos: number | null }>;
    },
  });

  const checklistQ = useQuery({
    queryKey: ["onboarding-stage-checklist", journey?.current_stage_id],
    enabled: !!journey?.current_stage_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stage_checklist" as any) as any)
        .select("id, texto, is_required, position")
        .eq("stage_id", journey!.current_stage_id!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; texto: string; is_required: boolean; position: number }>;
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

  const eventUserIds = useMemo(() => {
    const ids = new Set<string>();
    (eventsQ.data ?? []).forEach((e: any) => { if (e.user_id) ids.add(e.user_id); });
    return Array.from(ids);
  }, [eventsQ.data]);

  const eventUsersQ = useQuery({
    queryKey: ["onboarding-event-users", tenantId, eventUserIds.sort().join(",")],
    enabled: !!tenantId && eventUserIds.length > 0,
    queryFn: async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", tenantId!)
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
        .select("id, titulo, status, agendado_para, realizado_em, tentativas, no_show, proprietario_presente, is_retreinamento, conduzido_por, ticket_id")
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

  const participantsQ = useQuery({
    queryKey: ["onboarding-participants", journey?.ticket_id],
    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_participants" as any) as any)
        .select("id, user_id, papel, created_at")
        .eq("ticket_id", journey!.ticket_id!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; user_id: string; papel: Papel; created_at: string }>;
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
  const checklist = checklistQ.data ?? [];
  const events = eventsQ.data ?? [];
  const trainings = trainingQ.data ?? [];
  const attendances = attendancesQ.data ?? [];

  const historyByStage = useMemo(() => {
    const m: Record<string, { entrou_em: string; saiu_em: string | null; duracao_minutos: number | null }> = {};
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

  const accumulatedByStage = useMemo(() => {
    const m: Record<string, number> = {};
    let acc = 0;
    stages.forEach((s, idx) => {
      const isCurrent = s.id === journey?.current_stage_id;
      const h = historyByStage[s.id];
      if (isCurrent) {
        acc += journey?.etapa_atual_min ?? 0;
      } else if (currentStageIndex >= 0 && idx < currentStageIndex && h?.duracao_minutos != null) {
        acc += h.duracao_minutos;
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
    const checkedIds = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
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
      qc.invalidateQueries({ queryKey: ["onboarding-stage-checklist"] });
      setChecked({});
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

  async function handleAddParticipant() {
    if (!journey?.ticket_id || !tenantId || !newParticipantUserId) {
      toast.error("Selecione um usuário");
      return;
    }
    try {
      const { error } = await (supabase.from("onboarding_participants" as any) as any).insert({
        tenant_id: tenantId,
        ticket_id: journey.ticket_id,
        user_id: newParticipantUserId,
        papel: newParticipantPapel,
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
          content: `Adicionado: ${nome} (${newParticipantPapel})`,
        });
      }
      toast.success("Participante adicionado");
      setAddParticipantOpen(false);
      setNewParticipantUserId("");
      setNewParticipantPapel("especialista");
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar participante");
    }
  }

  async function handleRemoveParticipant(id: string, userId: string, papel: Papel) {
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
          content: `Removido: ${nome} (${papel})`,
        });
      }
      toast.success("Participante removido");
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover participante");
    }
  }

  async function handleCreateTraining() {
    if (!journeyId || !newTrainingTitle.trim()) {
      toast.error("Informe o título do treino");
      return;
    }
    const movesToImplantation = journey?.fase_atual === "onboarding";
    try {
      const { error } = await (supabase.rpc as any)("create_onboarding_training", {
        p_journey_id: journeyId,
        p_titulo: newTrainingTitle.trim(),
        p_agendado_para: newTrainingDate ? new Date(newTrainingDate).toISOString() : null,
        p_conduzido_por: newTrainingConductor || null,
        p_is_retreinamento: newTrainingRetreat,
        p_training_type_id: newTrainingTypeId || null,

      });
      if (error) throw error;
      toast.success(
        movesToImplantation
          ? "Treino agendado — jornada movida para Implantação."
          : "Treino agendado"
      );
      setAddTrainingOpen(false);
      setAddTrainingOpenTop(false);
      setNewTrainingTitle("");
      setNewTrainingDate("");
      setNewTrainingConductor("");
      setNewTrainingRetreat(false);
      setNewTrainingTypeId("");
      qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
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

  async function updateTraining(id: string, patch: Record<string, any>) {
    if (!tenantId) return;
    const { error } = await (supabase.from("onboarding_training_sessions" as any) as any)
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
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
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {journey.ticket_code && (
                      <span className="font-mono text-xs text-primary font-semibold">{journey.ticket_code}</span>
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
                <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 pr-10">
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
                        {journey?.fase_atual === "onboarding" && (
                          <Alert className="border-warning/50 bg-warning/15 text-warning [&>svg]:text-warning py-2 text-xs">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              Ao agendar este treino, a jornada será concluída no Onboarding e iniciará a fase de Implantação.
                            </AlertDescription>
                          </Alert>
                        )}
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
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={newTrainingRetreat}
                            onCheckedChange={(v) => setNewTrainingRetreat(!!v)}
                          />
                          É retreinamento?
                        </label>
                        <Button size="sm" className="w-full" onClick={handleCreateTraining}>Agendar</Button>
                      </PopoverContent>
                    </Popover>
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

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tempo corrido</div>
                  <div className="text-lg font-semibold mt-0.5 flex items-center gap-1.5">
                    <Clock className="h-4 w-4" style={{ color: slaColor }} />
                    {formatMin(journey.sla_corrido_min)}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tempo efetivo (sem pausas)</div>
                  <div className="text-lg font-semibold mt-0.5 flex items-center gap-1.5">
                    <Clock className="h-4 w-4" style={{ color: slaColor }} />
                    {formatMin(journey.sla_util_min)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">Pausado: {formatMin(journey.sla_pausado_min)}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Go-live previsto</div>
                  <div className="text-lg font-semibold mt-0.5 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {formatDate(journey.go_live_previsto)}
                  </div>
                </div>
              </div>

              {/* Breakdown por fase */}
              <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">SLA por fase</div>
                <div className="grid grid-cols-3 gap-3">
                  {(() => {
                    const isCurrentOnboarding = journey.fase_atual === "onboarding";
                    const isCurrentImplantacao = journey.fase_atual === "implantacao";
                    const onbFrozen = !!journey.onboarding_concluido;
                    const impStarted = !!journey.implantacao_iniciada_em;
                    const totalUtil = (journey.sla_total_corrido_min ?? 0) - (journey.sla_total_pausado_min ?? 0);
                    return (
                      <>
                        <div className={`rounded-md border p-2.5 transition-colors ${isCurrentOnboarding ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`h-1.5 w-1.5 rounded-full ${isCurrentOnboarding ? "bg-primary" : "bg-muted-foreground/50"}`} />
                            <span className="text-[11px] font-medium">Onboarding</span>
                            {onbFrozen && (
                              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">congelado</span>
                            )}
                          </div>
                          <div className="text-sm font-semibold">
                            {formatMin(journey.sla_onb_util_min)}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            pausado {formatMin(journey.sla_onb_pausado_min)}
                          </div>
                        </div>

                        <div className={`rounded-md border p-2.5 transition-colors ${isCurrentImplantacao ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`h-1.5 w-1.5 rounded-full ${isCurrentImplantacao ? "bg-primary" : "bg-muted-foreground/50"}`} />
                            <span className="text-[11px] font-medium">Implantação</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {impStarted ? formatMin(journey.sla_imp_util_min) : "—"}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {impStarted ? `pausado ${formatMin(journey.sla_imp_pausado_min)}` : "não iniciada"}
                          </div>
                        </div>

                        <div className="rounded-md border border-border bg-card p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                            <span className="text-[11px] font-medium">Total</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {formatMin(journey.sla_total_corrido_min)}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            efetivo {formatMin(totalUtil > 0 ? totalUtil : 0)}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-5">
                {/* LEFT */}
                <div className="space-y-5">
                  {/* Participants */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Users className="h-4 w-4" /> Responsável & participantes
                      </h3>
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
                            <Select value={newParticipantPapel} onValueChange={(v) => setNewParticipantPapel(v as Papel)}>
                              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PAPEL_OPTIONS.map((p) => (
                                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" className="w-full" onClick={handleAddParticipant}>Adicionar</Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="p-3 space-y-2">
                      {(participantsQ.data ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2 text-center">Nenhum participante cadastrado.</p>
                      ) : (
                        (["implantador", "vendedor", "especialista", "outro"] as Papel[]).map((papel) => {
                          const rows = (participantsQ.data ?? []).filter((p) => p.papel === papel);
                          if (!rows.length) return null;
                          const isImpl = papel === "implantador";
                          return (
                            <div key={papel} className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-[10px] uppercase tracking-wide font-semibold"
                                  style={{ color: PAPEL_COLOR[papel] }}
                                >
                                  {isImpl ? "Responsável" : PAPEL_OPTIONS.find((o) => o.value === papel)?.label}
                                </span>
                              </div>
                              {rows.map((p) => (
                                <div
                                  key={p.id}
                                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5"
                                >
                                  {isImpl ? (
                                    <Star className="h-3.5 w-3.5 shrink-0" style={{ color: PAPEL_COLOR[papel] }} fill={PAPEL_COLOR[papel]} />
                                  ) : (
                                    <User className="h-3.5 w-3.5 shrink-0" style={{ color: PAPEL_COLOR[papel] }} />
                                  )}
                                  <span className="text-xs flex-1 truncate">
                                    {memberNameMap.get(p.user_id) || "—"}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] capitalize"
                                    style={{ borderColor: PAPEL_COLOR[papel], color: PAPEL_COLOR[papel] }}
                                  >
                                    {papel}
                                  </Badge>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() => handleRemoveParticipant(p.id, p.user_id, p.papel)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  {/* Timeline stages */}
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
                                  <span className="text-[10px] text-muted-foreground shrink-0">{formatMin(h.duracao_minutos)}</span>
                                )}
                                {isCurrent && journey.etapa_atual_min != null && (
                                  <span className="text-[10px] font-medium shrink-0" style={{ color: slaColor }}>
                                    {formatMin(journey.etapa_atual_min)}
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
                                  Acumulado até aqui: <span className="font-medium text-foreground/80">{formatMin(accumulatedByStage[s.id])}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Pauses by reason */}
                  {pausesByReason.length > 0 && (
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



                  {/* Modules */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Package className="h-4 w-4" /> Módulos da jornada
                      </h3>
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
                  </section>

                  {/* Dados da contabilidade */}
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

                  {/* Trainings */}



                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <GraduationCap className="h-4 w-4" /> Sub-tickets de treino
                      </h3>
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
                              {journey?.fase_atual === "onboarding" && (
                                <Alert className="border-warning/50 bg-warning/15 text-warning [&>svg]:text-warning py-2 text-xs">
                                  <AlertTriangle className="h-4 w-4" />
                                  <AlertDescription className="text-xs">
                                    Ao agendar este treino, a jornada será concluída no Onboarding e iniciará a fase de Implantação.
                                  </AlertDescription>
                                </Alert>
                              )}
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


                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                  checked={newTrainingRetreat}
                                  onCheckedChange={(v) => setNewTrainingRetreat(!!v)}
                                />
                                É retreinamento?
                              </label>
                              <Button size="sm" className="w-full" onClick={handleCreateTraining}>Agendar</Button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
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
                  </section>

                </div>

                {/* RIGHT */}
                <div className="space-y-5">
                  {/* Checklist + Advance */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border">
                      <h3 className="text-sm font-semibold">Checklist da etapa</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{journey.stage_nome}</p>
                    </div>
                    <div className="p-3 space-y-2">
                      {checklist.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2 text-center">Sem itens de checklist para esta etapa.</p>
                      ) : (
                        checklist.map((c) => (
                          <label key={c.id} className="flex items-start gap-2 cursor-pointer">
                            <Checkbox
                              checked={!!checked[c.id]}
                              onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [c.id]: !!v }))}
                              className="mt-0.5"
                            />
                            <span className="text-xs">
                              {c.texto}
                              {c.is_required && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-destructive font-medium uppercase">
                                  <AlertCircle className="h-2.5 w-2.5" />obrigatório
                                </span>
                              )}
                            </span>
                          </label>
                        ))
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

                  {/* Attachments */}
                  {journey?.ticket_id && (
                    <section className="rounded-lg border border-border">
                      <div className="p-3 border-b border-border">
                        <h3 className="text-sm font-semibold">Anexos</h3>
                      </div>
                      <div className="p-3">
                        <TicketAttachments
                          ticketId={journey.ticket_id}
                          tenantId={tenantId!}
                          canDelete={profile?.is_super_admin === true || profile?.role === "admin"}
                        />
                      </div>
                    </section>
                  )}

                  {/* Attendances */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" /> Atendimentos vinculados
                      </h3>
                      <Badge variant="outline" className="text-[10px]">{attendances.length}</Badge>
                    </div>
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
                  </section>

                  {/* Events */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border">
                      <h3 className="text-sm font-semibold">Timeline de eventos</h3>
                    </div>
                    <div className="p-3 space-y-3">
                      <div className="space-y-2">
                        <Textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Adicionar nota do agente..."
                          rows={2}
                          className="text-xs"
                        />
                        <Button size="sm" onClick={handleAddNote} disabled={!note.trim()}>
                          Adicionar nota
                        </Button>
                      </div>
                      <Separator />
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                        {events.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">Sem eventos registrados.</p>
                        ) : (
                          events.map((ev: any) => {
                            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                            const isStageChange = ev.event_type === "onboarding_mudou_etapa";
                            const oldIsUuid = ev.old_value && UUID_RE.test(String(ev.old_value).trim());
                            const newIsUuid = ev.new_value && UUID_RE.test(String(ev.new_value).trim());
                            const hideRawValues = isStageChange && (oldIsUuid || newIsUuid);
                            const showRawValues = (ev.old_value || ev.new_value) && !hideRawValues && !oldIsUuid && !newIsUuid;
                            const legacyStageFallback = isStageChange && hideRawValues && !ev.content;
                            const authorName = ev.user_id ? (eventUsersQ.data?.[ev.user_id] ?? "Usuário") : "Sistema";
                            return (
                              <div key={ev.id} className="flex items-start gap-2 text-xs">
                                <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{EVENT_LABELS[ev.event_type] || ev.event_type}</span>
                                    <span className="text-[10px] text-muted-foreground">{formatDateTime(ev.created_at)}</span>
                                    <span className="text-[10px] text-muted-foreground">· {authorName}</span>
                                  </div>
                                  {ev.content && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{ev.content}</p>}
                                  {legacyStageFallback && (
                                    <p className="text-xs text-muted-foreground mt-0.5">Mudança de etapa</p>
                                  )}
                                  {showRawValues && (
                                    <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                                      {ev.old_value || "—"} <ChevronRight className="inline h-3 w-3" /> {ev.new_value || "—"}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
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
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" /> Dados da contabilidade
        </h3>
        <Badge variant="outline" className="text-[10px]">{coletados} de {total} coletados</Badge>
      </div>
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
    </section>
  );
}

