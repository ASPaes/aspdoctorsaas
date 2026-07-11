import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2, Clock, Pause, Play, ChevronRight, Calendar, CheckCircle2,
  Circle, AlertCircle, MessageSquare, GraduationCap, User, ArrowRight,
} from "lucide-react";

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
};

export default function JourneyDetailSheet({ open, onOpenChange, journeyId, tenantId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [pauseReasonId, setPauseReasonId] = useState<string>("");
  const [pauseText, setPauseText] = useState("");
  const [pausePopoverOpen, setPausePopoverOpen] = useState(false);
  const [nextStageId, setNextStageId] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setChecked({});
      setNote("");
      setPauseReasonId("");
      setPauseText("");
      setNextStageId("");
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
        .select("id, pipeline_id")
        .eq("id", journeyId)
        .maybeSingle();
      return data as any;
    },
  });

  const pipelineId = journeyRowQ.data?.pipeline_id as string | undefined;

  const stagesQ = useQuery({
    queryKey: ["onboarding-detail-stages", pipelineId],
    enabled: !!pipelineId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, nome, position, cor, is_final")
        .eq("tenant_id", tenantId)
        .eq("pipeline_id", pipelineId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; position: number; cor: string | null; is_final: boolean | null }>;
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

  const attendancesQ = useQuery({
    queryKey: ["onboarding-attendances", journey?.ticket_id],
    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("id, attendance_code, status, opened_at, closed_at, participant_label")
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

  const cliente = clienteQ.data;
  const clienteNome = cliente?.nome_fantasia || cliente?.razao_social || "—";
  const isPaused = journey?.situacao === "pausado" || journey?.situacao === "parado";

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

  async function handleAddNote() {
    if (!journey?.ticket_id || !note.trim() || !user?.id) return;
    try {
      const { error } = await (supabase.from("support_ticket_events" as any) as any).insert({
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

  const loading = journeyQ.isLoading || !journey;
  const slaColor = SEMAFORO_COLOR[journey?.etapa_semaforo || "sem_sla"];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-5xl p-0 flex flex-col gap-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-5 border-b border-border">
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
                    {isPaused && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Pause className="h-3 w-3" /> pausado
                      </Badge>
                    )}
                  </div>
                  <SheetTitle className="text-base mt-1 truncate">{clienteNome}</SheetTitle>
                  {journey.assunto && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{journey.assunto}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPaused ? (
                    <Button size="sm" variant="outline" onClick={handleResume}>
                      <Play className="h-4 w-4 mr-1" /> Retomar
                    </Button>
                  ) : (
                    <Popover open={pausePopoverOpen} onOpenChange={setPausePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Pause className="h-4 w-4 mr-1" /> Pausar
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
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sem tempo parado</div>
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
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-5">
                {/* LEFT */}
                <div className="space-y-5">
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Trainings */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <GraduationCap className="h-4 w-4" /> Sub-tickets de treino
                      </h3>
                      <Badge variant="outline" className="text-[10px]">{trainings.length}</Badge>
                    </div>
                    <div className="p-3 space-y-2">
                      {trainings.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2 text-center">Nenhum treino cadastrado.</p>
                      ) : (
                        trainings.map((t) => (
                          <div key={t.id} className="rounded-md border border-border p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium truncate">{t.titulo}</span>
                              <Badge variant="outline" className="text-[10px] capitalize">{t.status}</Badge>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                              {t.agendado_para && <span>Agendado: {formatDateTime(t.agendado_para)}</span>}
                              {t.realizado_em && <span>Realizado: {formatDateTime(t.realizado_em)}</span>}
                              {t.tentativas > 0 && <span>Tentativas: {t.tentativas}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {t.no_show && <Badge variant="destructive" className="text-[9px]">no-show</Badge>}
                              {t.is_retreinamento && <Badge variant="outline" className="text-[9px]">retreinamento</Badge>}
                              {t.proprietario_presente && <Badge variant="outline" className="text-[9px]">proprietário presente</Badge>}
                            </div>
                          </div>
                        ))
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
                        <Button size="sm" onClick={handleAdvance} disabled={isPaused}>
                          Avançar <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </div>
                      {isPaused && (
                        <p className="text-[10px] text-muted-foreground">Retome o onboarding para avançar de etapa.</p>
                      )}
                    </div>
                  </section>

                  {/* Attendances */}
                  <section className="rounded-lg border border-border">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" /> Atendimentos vinculados
                      </h3>
                      <Badge variant="outline" className="text-[10px]">{attendances.length}</Badge>
                    </div>
                    <div className="p-3 space-y-1.5">
                      {attendances.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2 text-center">Nenhum atendimento vinculado.</p>
                      ) : (
                        attendances.map((a) => (
                          <div key={a.id} className="rounded-md border border-border p-2 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-primary">{a.attendance_code}</span>
                            <span className="text-[11px] text-muted-foreground truncate flex-1">
                              {a.participant_label || "—"}
                            </span>
                            <Badge variant="outline" className="text-[9px] capitalize">{a.status}</Badge>
                          </div>
                        ))
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
                          events.map((ev: any) => (
                            <div key={ev.id} className="flex items-start gap-2 text-xs">
                              <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{EVENT_LABELS[ev.event_type] || ev.event_type}</span>
                                  <span className="text-[10px] text-muted-foreground">{formatDateTime(ev.created_at)}</span>
                                </div>
                                {ev.content && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{ev.content}</p>}
                                {(ev.old_value || ev.new_value) && (
                                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                                    {ev.old_value || "—"} <ChevronRight className="inline h-3 w-3" /> {ev.new_value || "—"}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
