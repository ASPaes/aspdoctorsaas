import { useMemo, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleAlert, Clock, GraduationCap, Rocket, RotateCcw, Search, Ticket, Users, UserX } from "lucide-react";
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
  /** Faltas de verdade. Não confundir com `tentativas`, que conta remarcações. */
  no_shows: number | null;
  ultimo_no_show_em: string | null;
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
  cancelado_em: string | null;
  implantacao_iniciada_em: string | null;
  /** Cancelado já dentro da Implantação. Cancelado antes disso nem chega aqui:
   *  para a Implantação aquele treinamento nunca existiu. */
  cancelado_na_implantacao: boolean | null;
  participantes_total: number | null;
  participantes_presentes: number | null;
  /** Treino sem lista de participantes ou com presença em aberto. */
  chamada_pendente: boolean | null;
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
  /** journey_id → ISO de quando a Implantação foi encerrada (go-live). Só as encerradas. */
  goLivePorJornada: Record<string, string>;
  /** Quantas jornadas na tela só apareceram porque há busca — go-live fora dos 30 dias. */
  goLiveForaDaJanela: number;
  /** Nome da jornada seguinte, quando existe: o cartão concluído mostra para onde foi. */
  proximaFaseNome: string | null;
  agrupado: boolean;
  onOpenJourney: (journeyId: string, sub?: { id: string; code: string | null }) => void;
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

/** "31/07" — data curta do go-live para o selo do cartão. */
function goLiveCurto(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Coluna virtual — não é etapa de pipeline, então não pode colidir com um uuid. */
const GOLIVE_COL_ID = "__impl_golive__";

/** Resumo de um ticket pai a partir dos seus sub-tickets. */
interface GrupoResumo {
  chave: string;
  code: string | null;
  cliente: string | null;
  journeyId: string;
  filhos: TrainingCardRow[];
  feitos: number;
  total: number;
  cancelados: number;
  semDono: number;
  responsaveis: number;
  pronto: boolean;
  /** Realização mais recente do grupo — ordena a coluna final por "acabou agora". */
  ultimoFeito: string | null;
}

/** Chave do pai. Sub-ticket sem código de pai cai na jornada, senão grupos distintos
 *  do mesmo cliente se fundiriam por nome. */
function chaveDoPai(r: TrainingCardRow): string {
  return r.parent_ticket_code || r.journey_id;
}

function resumirGrupo(chave: string, filhos: TrainingCardRow[]): GrupoResumo {
  const validos = filhos.filter((f) => f.status !== "cancelado");
  const feitos = validos.filter((f) => f.status === "realizado").length;
  const responsaveis = new Set(filhos.map((f) => f.conduzido_por).filter(Boolean));
  return {
    chave,
    code: filhos[0]?.parent_ticket_code ?? null,
    cliente: filhos[0]?.cliente_nome ?? null,
    journeyId: filhos[0]?.journey_id ?? "",
    filhos: [...filhos].sort((a, b) => (a.sub_seq ?? 0) - (b.sub_seq ?? 0)),
    feitos,
    total: validos.length,
    cancelados: filhos.length - validos.length,
    semDono: validos.filter((f) => !f.conduzido_por).length,
    responsaveis: responsaveis.size,
    pronto: validos.length > 0 && feitos === validos.length,
    ultimoFeito: validos.reduce<string | null>(
      (acc, f) => (f.realizado_em && (!acc || f.realizado_em > acc) ? f.realizado_em : acc),
      null,
    ),
  };
}

/** Cartão de ticket pai. Um componente só para a visão "Agrupar" e para a etapa final
 *  do quadro: se divergirem, o gestor vê dois resumos diferentes do mesmo ticket. */
function GrupoTicketCard({
  g, golive, etapaFinalId, draggingId, onOpen, onDragStartFilho, onDragEndFilho,
}: {
  g: GrupoResumo;
  golive?: string;
  /** Só na etapa final: as linhas de filho já finalizadas voltam a ser arrastáveis,
   *  para devolver um treino à etapa anterior sem abrir a jornada. */
  etapaFinalId?: string | null;
  draggingId?: string | null;
  onOpen: () => void;
  onDragStartFilho?: (e: DragEvent<HTMLDivElement>, f: TrainingCardRow) => void;
  onDragEndFilho?: () => void;
}) {
  const pct = g.total > 0 ? Math.round((g.feitos / g.total) * 100) : 0;
  return (
    <div
      onClick={onOpen}
      className="bg-card border rounded-md p-2.5 cursor-pointer transition-all hover:border-primary/40"
      style={golive ? { borderColor: "#22C55E", background: "hsl(142 71% 45% / 0.04)" } : g.pronto ? { borderColor: "#22C55E" } : undefined}
    >
      <div className="flex items-center gap-1.5">
        {golive ? (
          <Rocket className="h-3 w-3 shrink-0" style={{ color: "#16A34A" }} />
        ) : (
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: g.pronto ? "#22C55E" : "#F59E0B" }} />
        )}
        <span className="font-mono text-[11px] text-primary font-semibold">{g.code ?? "—"}</span>
        <span
          className="ml-auto text-[9px] px-1.5 py-0.5 rounded text-white font-medium"
          style={{ background: golive || g.pronto ? "#22C55E" : "#64748B" }}
        >
          {golive ? "concluída" : g.pronto ? "pronto" : `${g.filhos.length} ${g.filhos.length === 1 ? "filho" : "filhos"}`}
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
                : golive ? `go-live ${goLiveCurto(golive)}` : g.pronto ? "liberado para concluir" : ""}
        </span>
      </div>

      <div className="grid gap-1 mt-2 pt-2 border-t border-dashed border-border">
        {g.filhos.map((f) => {
          // Só o filho que já está na etapa final arrasta: os outros continuam
          // com cartão próprio na coluna deles, e arrastar daqui duplicaria a origem.
          const arrastavel = !!etapaFinalId && !!onDragStartFilho && f.current_stage_id === etapaFinalId;
          return (
            <div
              key={f.training_id}
              draggable={arrastavel}
              onDragStart={arrastavel ? (e) => { e.stopPropagation(); onDragStartFilho!(e, f); } : undefined}
              onDragEnd={arrastavel ? onDragEndFilho : undefined}
              className={`flex items-center gap-1.5 text-[10px] text-muted-foreground ${
                arrastavel ? "cursor-grab active:cursor-grabbing" : ""
              } ${draggingId === f.training_id ? "opacity-40" : ""}`}
            >
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
          );
        })}
      </div>
    </div>
  );
}

export default function ImplantacaoBoard({
  stages, rows, jornadasSemTreino, goLivePorJornada, goLiveForaDaJanela, proximaFaseNome,
  agrupado, onOpenJourney,
}: Props) {
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
      // Arrastar avisa, mas não impede: o cartão anda e fica com o selo de chamada
      // pendente até alguém abrir a jornada e marcar quem participou.
      if (res?.chamada_pendente) {
        toast.warning("Treinamento fechado sem a chamada", {
          description: "Abra a jornada e marque quem participou.",
        });
      } else {
        toast.success(res?.realizado ? "Treinamento concluído" : "Etapa atualizada");
      }
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
      // Go-live dado: a jornada inteira encerrou, o cartão sai das colunas de etapa e
      // vai para a coluna de conclusão — mesmo padrão de "Onboarding concluído".
      if (goLivePorJornada[r.journey_id]) return;
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
  }, [stages, rows, goLivePorJornada]);

  /** Coluna de conclusão: um cartão por ticket pai, não por treinamento. Depois do
   *  go-live o que interessa é "esta implantação acabou", não cada treino de novo. */
  const concluidas = useMemo(() => {
    const m = new Map<string, {
      journeyId: string; code: string | null; cliente: string | null; golive: string;
      situacao: string | null; treinos: number;
    }>();
    rows.forEach((r) => {
      const golive = goLivePorJornada[r.journey_id];
      if (!golive) return;
      const g = m.get(r.journey_id);
      if (g) { if (r.status !== "cancelado") g.treinos += 1; return; }
      m.set(r.journey_id, {
        journeyId: r.journey_id,
        code: r.parent_ticket_code,
        cliente: r.cliente_nome,
        golive,
        situacao: r.journey_situacao,
        treinos: r.status === "cancelado" ? 0 : 1,
      });
    });
    // Jornada que encerrou sem nenhum treinamento também precisa aparecer aqui.
    jornadasSemTreino.forEach((j) => {
      const golive = goLivePorJornada[j.journey_id];
      if (!golive || m.has(j.journey_id)) return;
      m.set(j.journey_id, {
        journeyId: j.journey_id, code: j.ticket_code, cliente: j.cliente_nome,
        golive, situacao: null, treinos: 0,
      });
    });
    return Array.from(m.values()).sort((a, b) => b.golive.localeCompare(a.golive));
  }, [rows, jornadasSemTreino, goLivePorJornada]);

  const semTreinoPorEtapa = useMemo(() => {
    const m: Record<string, JornadaSemTreino[]> = {};
    jornadasSemTreino.forEach((j) => {
      if (goLivePorJornada[j.journey_id]) return; // vai para a coluna de conclusão
      if (j.current_stage_id) (m[j.current_stage_id] ||= []).push(j);
    });
    return m;
  }, [jornadasSemTreino, goLivePorJornada]);

  /** Visão do gestor: um cartão por ticket pai.
   *  Não é kanban — um cliente pode ter um treinamento concluído e outro em no-show
   *  ao mesmo tempo, então não existe uma coluna só para ele. */
  /** Todos os sub-tickets indexados pelo ticket pai. O cartão da etapa final precisa
   *  enxergar os irmãos que ainda estão em outras colunas para dizer "2 de 3". */
  const filhosPorPai = useMemo(() => {
    const m = new Map<string, TrainingCardRow[]>();
    rows.forEach((r) => {
      const chave = chaveDoPai(r);
      const lista = m.get(chave);
      if (lista) lista.push(r);
      else m.set(chave, [r]);
    });
    return m;
  }, [rows]);

  const grupos = useMemo(
    () =>
      Array.from(filhosPorPai.entries())
        .map(([chave, filhos]) => resumirGrupo(chave, filhos))
        .sort((a, b) => (a.code || "").localeCompare(b.code || "")),
    [filhosPorPai],
  );

  const etapaFinalId = useMemo(() => stages.find((s) => s.is_final)?.id ?? null, [stages]);

  /** Etapa final: um cartão por ticket pai, não por sub-ticket. Arrastar mais um filho
   *  para cá só atualiza o contador do pai que já está na coluna. */
  const gruposFinalizados = useMemo(() => {
    if (!etapaFinalId) return [];
    const chaves: string[] = [];
    const vistos = new Set<string>();
    (porEtapa[etapaFinalId] ?? []).forEach((r) => {
      const chave = chaveDoPai(r);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      chaves.push(chave);
    });
    return chaves
      .map((chave) => resumirGrupo(chave, filhosPorPai.get(chave) ?? []))
      .sort((a, b) => (b.ultimoFeito ?? "").localeCompare(a.ultimoFeito ?? ""));
  }, [porEtapa, etapaFinalId, filhosPorPai]);

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
          {grupos.map((g) => (
            <GrupoTicketCard
              key={g.chave}
              g={g}
              // Sem isto um grupo com go-live fica idêntico a um só "liberado para concluir".
              golive={goLivePorJornada[g.journeyId]}
              onOpen={() => onOpenJourney(g.journeyId)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Quadro por etapa ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-x-auto p-4">
      {goLiveForaDaJanela > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md border border-[#22C55E]/30 bg-[#22C55E]/[0.06] text-[11px] text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#16A34A]" />
          <span>
            A busca está mostrando <span className="font-medium text-foreground">{goLiveForaDaJanela}</span>{" "}
            {goLiveForaDaJanela === 1 ? "implantação encerrada" : "implantações encerradas"} fora dos últimos 30 dias.
            Sem busca, o quadro mostra só os go-lives recentes.
          </span>
        </div>
      )}
      <div className="flex flex-row gap-3 min-h-full pb-2">
        {stages.map((col) => {
          // Na etapa final o cartão é o ticket pai; nas outras, o sub-ticket.
          const isFinal = col.id === etapaFinalId;
          const items = isFinal ? [] : porEtapa[col.id] ?? [];
          const gruposDaCol = isFinal ? gruposFinalizados : [];
          const orfas = semTreinoPorEtapa[col.id] ?? [];
          const cartoes = items.length + gruposDaCol.length + orfas.length;
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
                <Badge variant="outline" className="ml-auto text-[10px]">{cartoes}</Badge>
              </div>

              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
                {cartoes === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground/60 py-6 px-2">
                    Nenhum treinamento aqui.
                  </div>
                ) : (
                  <>
                    {gruposDaCol.map((g) => (
                      <GrupoTicketCard
                        key={g.chave}
                        g={g}
                        etapaFinalId={etapaFinalId}
                        draggingId={draggingId}
                        onOpen={() => onOpenJourney(g.journeyId)}
                        onDragStartFilho={(e, f) => {
                          e.dataTransfer.setData("trainingId", f.training_id);
                          e.dataTransfer.setData("fromStageId", f.current_stage_id ?? "");
                          setDraggingId(f.training_id);
                        }}
                        onDragEndFilho={() => setDraggingId(null)}
                      />
                    ))}

                    {items.map((t) => {
                      const feito = t.status === "realizado";
                      // Pelo STATUS, não pela presença da data: depois de um no-show a
                      // `agendado_para` é limpa, mas os treinos anteriores a 11/08 ainda
                      // carregam a data do treino que não aconteceu — e anunciavam
                      // "Treino 04/08 16:00" numa coluna de fila de agendamento.
                      const agendado = t.status === "agendado" && !!t.agendado_para;
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
                          onClick={() => onOpenJourney(t.journey_id, { id: t.ticket_id, code: t.ticket_code })}
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
                            {!feito && !agendado && (
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
                            {(t.no_shows ?? 0) > 0 && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium text-[hsl(0_84%_60%)] bg-[hsl(0_84%_60%)]/10"
                                title={
                                  t.ultimo_no_show_em
                                    ? `Última falta: treino de ${formatTrainingDateTime(t.ultimo_no_show_em)}`
                                    : "O cliente faltou ao treino"
                                }
                              >
                                <UserX className="h-3 w-3" /> no-show · {t.no_shows}ª
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
                            {(t.participantes_total ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {t.participantes_total} · {t.participantes_presentes ?? 0} presente
                                {(t.participantes_presentes ?? 0) === 1 ? "" : "s"}
                              </span>
                            )}
                            {/* Fechou pelo quadro sem a chamada: o aviso mora no cartão.
                                Jornada encerrada não recebe o selo — não há o que cobrar. */}
                            {feito && t.chamada_pendente
                              && t.journey_situacao !== "concluido" && t.journey_situacao !== "cancelado" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium text-[hsl(38_92%_50%)] bg-[hsl(38_92%_50%)]/10">
                                <CircleAlert className="h-3 w-3" /> chamada pendente
                              </span>
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

        {/* Coluna de conclusão, espelhando "Onboarding concluído": a etapa final do
            pipeline é para o filho encerrado com irmão ainda em andamento; quando TUDO
            encerra, o go-live traz o ticket inteiro para cá. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverCol(GOLIVE_COL_ID);
          }}
          onDragLeave={() => setDragOverCol(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverCol(null);
            toast.error("O go-live é dado pelo ticket, e só com todos os treinamentos encerrados.");
          }}
          className={`flex flex-col min-w-[280px] w-[280px] rounded-lg border border-emerald-500/40 bg-emerald-500/5 transition-all ${
            dragOverCol === GOLIVE_COL_ID ? "ring-2 ring-emerald-500/60" : ""
          }`}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/30 bg-emerald-500/10 rounded-t-lg">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "#22C55E" }} />
            <span className="text-xs font-medium truncate text-emerald-700 dark:text-emerald-400">
              Implantação concluída
            </span>
            <Badge variant="outline" className="ml-auto text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              {concluidas.length}
            </Badge>
          </div>

          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
            {concluidas.length === 0 ? (
              <div className="text-center text-[11px] text-muted-foreground/50 py-6 px-2">
                Nenhuma implantação concluída nos últimos 30 dias.
              </div>
            ) : (
              concluidas.map((c) => {
                const encerrou = c.situacao === "concluido";
                return (
                  <div
                    key={`golive-${c.journeyId}`}
                    onClick={() => onOpenJourney(c.journeyId)}
                    className="bg-card border rounded-md p-2.5 cursor-pointer hover:border-emerald-500/60 transition-all"
                    style={{ borderColor: "#22C55E55" }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: "#22C55E" }} />
                      <span className="font-mono text-[11px] text-primary font-semibold">{c.code ?? "—"}</span>
                      <span
                        className="ml-auto text-[9px] px-1.5 py-0.5 rounded text-white"
                        style={{ background: encerrou || !proximaFaseNome ? "#22C55E" : "#3B82F6" }}
                      >
                        {encerrou || !proximaFaseNome ? "concluída" : `→ em ${proximaFaseNome}`}
                      </span>
                    </div>
                    <p className="text-xs text-foreground truncate">{c.cliente ?? "—"}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/90 mt-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1" title="Data do go-live">
                        <Rocket className="h-3 w-3" /> Go-live {goLiveCurto(c.golive)}
                      </span>
                      {c.treinos > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="h-3 w-3" />
                          {c.treinos} {c.treinos === 1 ? "treinamento" : "treinamentos"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
