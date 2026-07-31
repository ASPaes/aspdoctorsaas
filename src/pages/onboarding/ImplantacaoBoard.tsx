import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, GraduationCap, RotateCcw, Ticket, UserX } from "lucide-react";
import { toast } from "sonner";
import { formatTrainingDateTime, isTrainingUrgent, readableOn } from "./OnboardingPage";

/** Uma linha de vw_onboarding_training_cards. */
export interface TrainingCardRow {
  training_id: string;
  journey_id: string;
  ticket_id: string;
  ticket_code: string | null;
  sub_seq: number | null;
  parent_ticket_id: string | null;
  parent_ticket_code: string | null;
  titulo: string | null;
  status: string | null;
  agendado_para: string | null;
  realizado_em: string | null;
  tentativas: number | null;
  no_show: boolean | null;
  is_retreinamento: boolean | null;
  link_agendamento: string | null;
  current_stage_id: string | null;
  conduzido_por: string | null;
  conduzido_por_nome: string | null;
  training_type_id: string | null;
  training_type_nome: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_unidade_id: number | null;
  journey_situacao: string | null;
  demand_type_nome: string | null;
  demand_type_cor: string | null;
  etapa_entrou_em: string | null;
}

/** Jornada que já está na Implantação mas ainda não tem nenhum treinamento.
 *  Sem isso ela sumiria do quadro ao trocar o cartão de jornada por cartão de treino. */
export interface JornadaSemTreino {
  journey_id: string;
  ticket_code: string | null;
  cliente_nome: string | null;
  current_stage_id: string | null;
  responsavel_nome: string | null;
  demand_type_nome: string | null;
  demand_type_cor: string | null;
}

interface StageCol {
  id: string;
  nome: string;
  cor: string | null;
  is_final: boolean | null;
}

interface Props {
  stages: StageCol[];
  rows: TrainingCardRow[];
  jornadasSemTreino: JornadaSemTreino[];
  agrupado: boolean;
  onOpenJourney: (journeyId: string) => void;
}

const STATUS_COR: Record<string, string> = {
  previsto: "#6B7280",
  agendado: "#0EA5E9",
  realizado: "#22C55E",
  no_show: "#EF4444",
  cancelado: "#334155",
};

function iniciais(nome: string | null): string {
  const n = (nome || "").trim();
  if (!n) return "?";
  const p = n.split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** Cor estável por pessoa, para o mesmo agente ter sempre o mesmo avatar. */
function corDoAgente(id: string | null): string {
  const paleta = ["#0EA5E9", "#8B5CF6", "#F59E0B", "#14B8A6", "#EC4899", "#6366F1"];
  if (!id) return "#64748B";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return paleta[h % paleta.length];
}

export default function ImplantacaoBoard({ stages, rows, jornadasSemTreino, agrupado, onOpenJourney }: Props) {
  const queryClient = useQueryClient();
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ["onboarding-training-cards"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-training"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-board-trainings"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-journeys"] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
  }

  async function handleDrop(trainingId: string, targetStageId: string, fromStageId: string) {
    if (fromStageId === targetStageId) return;
    try {
      const { data, error } = await (supabase.rpc as any)("move_onboarding_training_stage", {
        p_training_id: trainingId,
        p_target_stage_id: targetStageId,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(
          res.reason === "treino_cancelado" ? "Treinamento cancelado não anda no quadro." :
          res.reason === "treino_excluido" ? "Este treinamento foi excluído." :
          "Não foi possível mover o treinamento.",
        );
        return;
      }
      toast.success(res?.realizado ? "Treinamento concluído" : "Etapa atualizada");
      invalidar();
    } catch (e: any) {
      toast.error(e.message || "Erro ao mover o treinamento");
    }
  }

  const porEtapa = useMemo(() => {
    const m: Record<string, TrainingCardRow[]> = {};
    stages.forEach((s) => (m[s.id] = []));
    rows.forEach((r) => {
      if (r.status === "cancelado") return; // fica só no agrupado e no histórico do pai
      if (r.current_stage_id && m[r.current_stage_id]) m[r.current_stage_id].push(r);
    });
    Object.values(m).forEach((lista) =>
      lista.sort((a, b) => {
        const da = a.agendado_para ? new Date(a.agendado_para).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.agendado_para ? new Date(b.agendado_para).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      }),
    );
    return m;
  }, [stages, rows]);

  const semTreinoPorEtapa = useMemo(() => {
    const m: Record<string, JornadaSemTreino[]> = {};
    jornadasSemTreino.forEach((j) => {
      if (j.current_stage_id) (m[j.current_stage_id] ||= []).push(j);
    });
    return m;
  }, [jornadasSemTreino]);

  /** Visão do gestor: um cartão por ticket pai.
   *  Não é kanban — um cliente pode ter um treinamento concluído e outro em no-show
   *  ao mesmo tempo, então não existe uma coluna só para ele. */
  const grupos = useMemo(() => {
    const m = new Map<string, { chave: string; code: string | null; cliente: string | null; journeyId: string; filhos: TrainingCardRow[] }>();
    rows.forEach((r) => {
      const chave = r.parent_ticket_code || r.journey_id;
      if (!m.has(chave)) {
        m.set(chave, { chave, code: r.parent_ticket_code, cliente: r.cliente_nome, journeyId: r.journey_id, filhos: [] });
      }
      m.get(chave)!.filhos.push(r);
    });
    return Array.from(m.values())
      .map((g) => {
        const validos = g.filhos.filter((f) => f.status !== "cancelado");
        const feitos = validos.filter((f) => f.status === "realizado").length;
        const cancelados = g.filhos.length - validos.length;
        const responsaveis = new Set(g.filhos.map((f) => f.conduzido_por).filter(Boolean));
        return {
          ...g,
          filhos: g.filhos.sort((a, b) => (a.sub_seq ?? 0) - (b.sub_seq ?? 0)),
          feitos,
          total: validos.length,
          cancelados,
          semDono: g.filhos.filter((f) => f.status !== "cancelado" && !f.conduzido_por).length,
          responsaveis: responsaveis.size,
          pronto: validos.length > 0 && feitos === validos.length,
        };
      })
      .sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  }, [rows]);

  // ── Visão agrupada ────────────────────────────────────────────────────────
  if (agrupado) {
    if (grupos.length === 0) {
      return (
        <div className="flex-1 p-8 text-center text-sm text-muted-foreground">
          Nenhum treinamento na Implantação com os filtros atuais.
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
          {grupos.map((g) => {
            const pct = g.total > 0 ? Math.round((g.feitos / g.total) * 100) : 0;
            return (
              <div
                key={g.chave}
                onClick={() => onOpenJourney(g.journeyId)}
                className="bg-card border rounded-md p-2.5 cursor-pointer transition-all hover:border-primary/40"
                style={g.pronto ? { borderColor: "#22C55E" } : undefined}
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: g.pronto ? "#22C55E" : "#F59E0B" }} />
                  <span className="font-mono text-[11px] text-primary font-semibold">{g.code ?? "—"}</span>
                  <span
                    className="ml-auto text-[9px] px-1.5 py-0.5 rounded text-white font-medium"
                    style={{ background: g.pronto ? "#22C55E" : "#64748B" }}
                  >
                    {g.pronto ? "pronto" : `${g.filhos.length} ${g.filhos.length === 1 ? "filho" : "filhos"}`}
                  </span>
                </div>
                <p className="text-xs text-foreground mt-1 truncate">{g.cliente ?? "—"}</p>

                <div className="h-1 rounded-full bg-muted overflow-hidden mt-2">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between gap-2 mt-1.5 text-[10px] text-muted-foreground">
                  <span>{g.feitos} de {g.total} {g.total === 1 ? "concluído" : "concluídos"}</span>
                  <span>
                    {g.cancelados > 0
                      ? `${g.cancelados} cancelado${g.cancelados > 1 ? "s" : ""}`
                      : g.semDono > 0
                        ? `${g.semDono} sem responsável`
                        : g.responsaveis > 1
                          ? `${g.responsaveis} responsáveis`
                          : g.pronto ? "liberado para concluir" : ""}
                  </span>
                </div>

                <div className="grid gap-1 mt-2 pt-2 border-t border-dashed border-border">
                  {g.filhos.map((f) => (
                    <div key={f.training_id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono text-foreground font-medium shrink-0">-{f.sub_seq ?? "?"}</span>
                      <span className={`truncate ${f.status === "cancelado" ? "line-through" : ""}`}>
                        {f.titulo}
                        {f.conduzido_por_nome ? ` · ${f.conduzido_por_nome}` : ""}
                      </span>
                      <span
                        className="ml-auto shrink-0 font-medium"
                        style={{ color: STATUS_COR[f.status ?? "previsto"] }}
                      >
                        {f.status === "realizado"
                          ? "✓"
                          : f.status === "cancelado"
                            ? "cancelado"
                            : f.agendado_para
                              ? formatTrainingDateTime(f.agendado_para).split(" ")[0]
                              : "sem data"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Quadro por etapa ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-x-auto p-4">
      <div className="flex flex-row gap-3 min-h-full pb-2">
        {stages.map((col) => {
          const items = porEtapa[col.id] ?? [];
          const orfas = semTreinoPorEtapa[col.id] ?? [];
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
                const tid = e.dataTransfer.getData("trainingId");
                const from = e.dataTransfer.getData("fromStageId");
                if (tid) handleDrop(tid, col.id, from);
                setDragOverCol(null);
              }}
              className={`flex flex-col min-w-[280px] w-[280px] bg-muted/30 border border-border rounded-lg transition-all ${isOver ? "ring-2" : ""}`}
              style={isOver ? { boxShadow: `0 0 0 2px ${color}66` } : undefined}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-xs font-medium truncate">{col.nome}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">{items.length + orfas.length}</Badge>
              </div>

              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
                {items.length === 0 && orfas.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground/60 py-6 px-2">
                    Nenhum treinamento aqui.
                  </div>
                ) : (
                  <>
                    {items.map((t) => {
                      const feito = t.status === "realizado";
                      const agendado = !!t.agendado_para && !feito;
                      return (
                        <div
                          key={t.training_id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("trainingId", t.training_id);
                            e.dataTransfer.setData("fromStageId", t.current_stage_id ?? "");
                            setDraggingId(t.training_id);
                          }}
                          onDragEnd={() => setDraggingId(null)}
                          onClick={() => onOpenJourney(t.journey_id)}
                          className={`bg-card border rounded-md p-2.5 hover:border-primary/40 transition-all cursor-pointer active:cursor-grabbing ${
                            draggingId === t.training_id ? "opacity-40 scale-95" : ""
                          }`}
                          style={feito ? { borderColor: "#22C55E" } : undefined}
                        >
                          {agendado && (
                            <div
                              className="flex items-center gap-1.5 -mx-2.5 -mt-2.5 mb-2 px-2.5 py-1.5 rounded-t-md text-[10px] font-medium text-white"
                              style={{ background: "linear-gradient(90deg, #0EA5E9, #0284C7)" }}
                              title={`Treino agendado${t.conduzido_por_nome ? ` · ${t.conduzido_por_nome}` : ""}`}
                            >
                              <GraduationCap className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                Treino {formatTrainingDateTime(t.agendado_para)}
                                {t.conduzido_por_nome ? ` · ${t.conduzido_por_nome}` : ""}
                              </span>
                              {isTrainingUrgent(t.agendado_para) && (
                                <span className="relative flex h-2 w-2 ml-auto shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-1.5 mb-1">
                            {feito ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: "#22C55E" }} />
                            ) : (
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: STATUS_COR[t.status ?? "previsto"] }}
                                title={`Status: ${t.status}`}
                              />
                            )}
                            <span className="font-mono text-[11px] text-primary font-semibold">
                              {t.parent_ticket_code ?? ""}
                              <span className="text-[hsl(199_89%_48%)]">-{t.sub_seq ?? "?"}</span>
                            </span>
                            {feito && (
                              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded text-white" style={{ background: "#22C55E" }}>
                                realizado
                              </span>
                            )}
                            {!feito && !t.agendado_para && (
                              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded text-white" style={{ background: "#64748B" }}>
                                sem data
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-foreground line-clamp-2">{t.titulo || "Sem título"}</p>
                          {t.cliente_nome && (
                            <p className="text-[11px] text-muted-foreground truncate mt-1">{t.cliente_nome}</p>
                          )}

                          {t.conduzido_por_nome ? (
                            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                              <span
                                className="h-4 w-4 rounded-full grid place-items-center text-[8px] font-bold text-white shrink-0"
                                style={{ background: corDoAgente(t.conduzido_por) }}
                              >
                                {iniciais(t.conduzido_por_nome)}
                              </span>
                              {t.conduzido_por_nome}
                            </p>
                          ) : (
                            <p className="text-[11px] truncate flex items-center gap-1.5 mt-0.5 text-[hsl(38_92%_50%)]">
                              <UserX className="h-3 w-3 shrink-0" /> Sem responsável definido
                            </p>
                          )}

                          {t.training_type_nome && (
                            <span
                              className="inline-flex items-center mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium"
                              style={{ background: "#0EA5E9", color: readableOn("#0EA5E9") }}
                            >
                              {t.training_type_nome}
                            </span>
                          )}

                          {t.parent_ticket_code && (
                            <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-dashed border-border text-[10px] text-muted-foreground">
                              <Ticket className="h-3 w-3 shrink-0" />
                              <span className="font-mono text-foreground/90 truncate">{t.parent_ticket_code}</span>
                              {t.demand_type_nome && <span className="truncate">· {t.demand_type_nome}</span>}
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/90 mt-1.5 flex-wrap">
                            {feito && t.realizado_em && (
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> {formatTrainingDateTime(t.realizado_em)}
                              </span>
                            )}
                            {(t.tentativas ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1 text-[hsl(38_92%_50%)]">
                                <RotateCcw className="h-3 w-3" />
                                {t.tentativas} {t.tentativas === 1 ? "tentativa" : "tentativas"}
                              </span>
                            )}
                            {t.is_retreinamento && (
                              <span className="inline-flex items-center gap-1 text-[hsl(262_83%_58%)]">retreinamento</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {orfas.map((j) => (
                      <div
                        key={`orfa-${j.journey_id}`}
                        onClick={() => onOpenJourney(j.journey_id)}
                        className="bg-card border border-dashed rounded-md p-2.5 hover:border-primary/40 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground" />
                          <span className="font-mono text-[11px] text-primary font-semibold">{j.ticket_code ?? "—"}</span>
                          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                            sem treinamento
                          </span>
                        </div>
                        <p className="text-xs text-foreground truncate">{j.cliente_nome ?? "—"}</p>
                        {j.responsavel_nome && (
                          <p className="text-[11px] text-muted-foreground truncate mt-1">Resp.: {j.responsavel_nome}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/80 mt-1.5 inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Agende o primeiro treinamento pelo ticket
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
