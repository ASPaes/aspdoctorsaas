import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Clock, CheckCircle2, Pause, TrendingUp } from "lucide-react";
import { formatMinUtil as formatMin, formatMinCal } from "./slaFormat";

/**
 * Visão de SLA do onboarding — separa o TEMPO BRUTO de expediente do TEMPO EFETIVO
 * (bruto menos as pausas manuais).
 *
 * TUDO que é comparado com o SLA alvo está em HORÁRIO ÚTIL (expediente do setor do
 * pipeline). O tempo de CALENDÁRIO aparece só como referência secundária — comparar
 * calendário com um alvo em minutos úteis daria "0% no prazo" sempre.
 *
 * Fontes de verdade:
 *  - vw_onboarding_journeys: sla_*_util_min (útil já sem pausas) e sla_*_pausado_min
 *    (pausas, também em minutos úteis). Bruto = util + pausado.
 *    sla_*_corrido_min = calendário, só informativo.
 *  - onboarding_pipelines.sla_total_minutos  → SLA alvo da fase/pipeline (minutos úteis)
 *  - onboarding_stages.sla_minutos           → SLA alvo da etapa (minutos úteis)
 *  - onboarding_stage_history: duracao_util_minutos (expediente) vs duracao_minutos (calendário)
 *
 * Regra de "no prazo": tempo acumulado ≤ SLA alvo, avaliado em bruto e em efetivo.
 *  Jornada no prazo = todas as fases já iniciadas dentro do orçamento.
 */

export interface SlaJourneyRow {
  journey_id: string | null;
  concluido_em: string | null;
  pipeline_onboarding_id: string | null;
  pipeline_implantacao_id: string | null;
  demand_type_nome: string | null;
  setor_nome: string | null;
  sla_onb_corrido_min: number | null;
  sla_onb_pausado_min: number | null;
  sla_onb_util_min: number | null;
  sla_imp_corrido_min: number | null;
  sla_imp_pausado_min: number | null;
  sla_imp_util_min: number | null;
  sla_total_corrido_min: number | null;
  sla_total_pausado_min: number | null;
  sla_total_util_min: number | null;
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

type Tone = "success" | "warning" | "danger" | "info" | "default";
const toneText: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-[hsl(142_71%_45%)]",
  warning: "text-[hsl(38_92%_50%)]",
  danger: "text-destructive",
  info: "text-[hsl(199_89%_48%)]",
};
type Status = "green" | "amber" | "red";
const statusBg: Record<Status, string> = { green: "bg-[hsl(142_71%_45%)]", amber: "bg-[hsl(38_92%_50%)]", red: "bg-destructive" };
const statusTxt: Record<Status, string> = { green: "text-[hsl(142_71%_45%)]", amber: "text-[hsl(38_92%_50%)]", red: "text-destructive" };

const compliance = (v: number): Status => (v >= 90 ? "green" : v >= 70 ? "amber" : "red"); // % no prazo — maior é melhor
const consumo = (v: number): Status => (v >= 100 ? "red" : v >= 70 ? "amber" : "green"); // consumo do SLA — menor é melhor
const complianceTone = (v: number): Tone => {
  const s = compliance(v);
  return s === "green" ? "success" : s === "amber" ? "warning" : "danger";
};

/* ---------- cards ---------- */

function KpiCard({ icon: Icon, label, value, sub, tone = "default" }: { icon: any; label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${toneText[tone]}`} />
      </div>
      <div className={`text-2xl font-semibold ${toneText[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ComplianceRow({ label, v }: { label: string; v: number }) {
  const s = compliance(v);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11.5px] text-muted-foreground">
        <span>{label}</span>
        <span className={`text-sm font-semibold ${statusTxt[s]}`}>{v}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
        <div className={`h-full rounded-full ${statusBg[s]}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
    </div>
  );
}

function ComplianceCard({ name, badge, meta, npC, npE, ct, et }: { name: string; badge?: string; meta: string; npC: number; npE: number; ct: string; et: string }) {
  const dot = compliance(npC);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusBg[dot]}`} />
          {name}
        </div>
        {badge && <Badge variant="outline" className="text-[10px] shrink-0">{badge}</Badge>}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{meta}</div>
      <div className="h-px bg-border my-3" />
      <div className="flex flex-col gap-2">
        <ComplianceRow label="No prazo · bruto" v={npC} />
        <ComplianceRow label="No prazo · efetivo" v={npE} />
      </div>
      <div className="h-px bg-border my-3" />
      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span>Ciclo médio</span>
        <span>
          bruto <b className="text-foreground font-semibold">{ct}</b> · efetivo <b className="text-[hsl(142_71%_45%)] font-semibold">{et}</b>
        </span>
      </div>
    </div>
  );
}

function EtapaCard({ name, pipe, sla, ct, et, ePct }: { name: string; pipe: string; sla: string; ct: string; et: string; ePct: number }) {
  const eS = consumo(ePct);
  const SC = 1.3; // escala 0..130% do SLA → largura total
  const efeW = Math.min(ePct, 130) / SC;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusBg[eS]}`} />
          {name}
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">SLA {sla}</Badge>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{pipe}</div>
      <div className="relative h-[11px] rounded-md bg-muted overflow-hidden my-2.5">
        <div className={`absolute left-0 top-0 h-full rounded-l-md ${statusBg[eS]}`} style={{ width: `${efeW}%` }} />
        <span className="absolute -top-0.5 -bottom-0.5 w-px bg-muted-foreground/50" style={{ left: "53.8%" }} />
        <span className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-destructive" style={{ left: "76.9%" }} />
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">Expediente</span>
        <span>
          <b className={`font-semibold ${statusTxt[eS]}`}>{et}</b> · {ePct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-[11.5px] mt-1">
        <span className="text-muted-foreground">Calendário</span>
        <span className="text-muted-foreground">{ct}</span>
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground p-6 text-center border border-border rounded-lg bg-card">{children}</p>;
}

/* ---------- componente ---------- */

export default function OnboardingSlaOverview({ journeys, tenantId }: { journeys: SlaJourneyRow[]; tenantId: string | null }) {
  const [areaDim, setAreaDim] = useState<"demanda" | "setor">("demanda");

  const pipelinesQ = useQuery({
    queryKey: ["onb-sla-pipelines", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_pipelines")
        .select("id, nome, fase, sla_total_minutos, position")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stagesQ = useQuery({
    queryKey: ["onb-sla-stages", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_stages")
        .select("id, nome, sla_minutos, pipeline_id, position")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const historyQ = useQuery({
    queryKey: ["onb-sla-stage-history", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      fetchAllRows<{ journey_id: string; stage_id: string; duracao_minutos: number | null; duracao_util_minutos: number | null }>(() =>
        supabase
          .from("onboarding_stage_history")
          .select("journey_id, stage_id, duracao_minutos, duracao_util_minutos")
          .eq("tenant_id", tenantId!)
          .not("duracao_minutos", "is", null),
      ),
  });

  const pipeMap = useMemo(() => new Map((pipelinesQ.data ?? []).map((p) => [p.id, p])), [pipelinesQ.data]);
  const stageMap = useMemo(() => new Map((stagesQ.data ?? []).map((s) => [s.id, s])), [stagesQ.data]);

  // Fases já iniciadas de uma jornada, com seu SLA alvo (pipeline).
  // O gate de "fase iniciada" continua sendo o tempo de calendário — uma fase que só
  // rodou fora do expediente tem 0 min úteis, mas já começou e precisa entrar na conta.
  const journeyPhases = useMemo(() => {
    return (j: SlaJourneyRow): { pipelineId: string; bruto: number; efetivo: number; target: number }[] => {
      const out: { pipelineId: string; bruto: number; efetivo: number; target: number }[] = [];
      const onbT = j.pipeline_onboarding_id ? pipeMap.get(j.pipeline_onboarding_id)?.sla_total_minutos : null;
      if (j.pipeline_onboarding_id && (j.sla_onb_corrido_min ?? 0) > 0 && onbT && onbT > 0) {
        const efetivo = j.sla_onb_util_min ?? 0;
        out.push({ pipelineId: j.pipeline_onboarding_id, bruto: efetivo + (j.sla_onb_pausado_min ?? 0), efetivo, target: onbT });
      }
      const impT = j.pipeline_implantacao_id ? pipeMap.get(j.pipeline_implantacao_id)?.sla_total_minutos : null;
      if (j.pipeline_implantacao_id && (j.sla_imp_corrido_min ?? 0) > 0 && impT && impT > 0) {
        const efetivo = j.sla_imp_util_min ?? 0;
        out.push({ pipelineId: j.pipeline_implantacao_id, bruto: efetivo + (j.sla_imp_pausado_min ?? 0), efetivo, target: impT });
      }
      return out;
    };
  }, [pipeMap]);

  // KPIs "SLA Total"
  const total = useMemo(() => {
    let withSla = 0, okC = 0, okE = 0, sumParado = 0, sumBruto = 0, sumCal = 0, started = 0, cicloCal = 0, cicloE = 0;
    journeys.forEach((j) => {
      const phases = journeyPhases(j);
      if (phases.length) {
        withSla++;
        if (phases.every((p) => p.bruto <= p.target)) okC++;
        if (phases.every((p) => p.efetivo <= p.target)) okE++;
      }
      const cal = j.sla_total_corrido_min ?? 0;
      const efe = j.sla_total_util_min ?? 0;
      const par = j.sla_total_pausado_min ?? 0;
      sumCal += cal;
      sumBruto += efe + par;
      sumParado += par;
      if (cal > 0) {
        started++;
        cicloCal += cal;
        cicloE += efe;
      }
    });
    return {
      withSla,
      okC,
      okE,
      pctC: pct(okC, withSla),
      pctE: pct(okE, withSla),
      parado: sumParado,
      paradoPct: pct(sumParado, sumBruto),
      cicloCal: started ? cicloCal / started : 0,
      cicloE: started ? cicloE / started : 0,
    };
  }, [journeys, journeyPhases]);

  // Por pipeline
  const pipelineAgg = useMemo(() => {
    const m = new Map<string, { count: number; sumC: number; sumE: number; withinC: number; withinE: number }>();
    journeys.forEach((j) => {
      journeyPhases(j).forEach((ph) => {
        const cur = m.get(ph.pipelineId) ?? { count: 0, sumC: 0, sumE: 0, withinC: 0, withinE: 0 };
        cur.count++;
        cur.sumC += ph.bruto;
        cur.sumE += ph.efetivo;
        if (ph.bruto <= ph.target) cur.withinC++;
        if (ph.efetivo <= ph.target) cur.withinE++;
        m.set(ph.pipelineId, cur);
      });
    });
    return (pipelinesQ.data ?? [])
      .filter((p) => m.has(p.id))
      .map((p) => {
        const v = m.get(p.id)!;
        return {
          id: p.id,
          nome: p.nome,
          fase: p.fase === "implantacao" ? "Implantação" : "Onboarding",
          count: v.count,
          npC: pct(v.withinC, v.count),
          npE: pct(v.withinE, v.count),
          ct: formatMin(v.sumC / v.count),
          et: formatMin(v.sumE / v.count),
          target: formatMin(p.sla_total_minutos),
        };
      })
      .sort((a, b) => a.fase.localeCompare(b.fase) || a.nome.localeCompare(b.nome));
  }, [journeys, journeyPhases, pipelinesQ.data]);

  // Por área (tipo de demanda / setor)
  const areaAgg = useMemo(() => {
    const m = new Map<string, { count: number; okC: number; okE: number; sumC: number; sumE: number }>();
    journeys.forEach((j) => {
      const phases = journeyPhases(j);
      if (!phases.length) return;
      const key = (areaDim === "demanda" ? j.demand_type_nome : j.setor_nome) || "— sem classificação";
      const cur = m.get(key) ?? { count: 0, okC: 0, okE: 0, sumC: 0, sumE: 0 };
      cur.count++;
      if (phases.every((p) => p.bruto <= p.target)) cur.okC++;
      if (phases.every((p) => p.efetivo <= p.target)) cur.okE++;
      // mesma base das abas Total e Pipeline (antes esta aba usava corrido − pausado,
      // uma grandeza diferente para o mesmo conceito de "efetivo")
      cur.sumE += j.sla_total_util_min ?? 0;
      cur.sumC += (j.sla_total_util_min ?? 0) + (j.sla_total_pausado_min ?? 0);
      m.set(key, cur);
    });
    return Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        count: v.count,
        npC: pct(v.okC, v.count),
        npE: pct(v.okE, v.count),
        ct: formatMin(v.sumC / v.count),
        et: formatMin(v.sumE / v.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [journeys, journeyPhases, areaDim]);

  // Por etapa (histórico de etapas concluídas)
  const etapaAgg = useMemo(() => {
    const allowed = new Set(journeys.map((j) => j.journey_id));
    const m = new Map<string, { count: number; sumC: number; sumE: number }>();
    (historyQ.data ?? []).forEach((h) => {
      if (!allowed.has(h.journey_id)) return;
      const st = stageMap.get(h.stage_id);
      if (!st || !st.sla_minutos || st.sla_minutos <= 0) return;
      const c = h.duracao_minutos ?? 0; // calendário — informativo
      const e = h.duracao_util_minutos ?? 0; // expediente — é o que se compara com o SLA
      const cur = m.get(h.stage_id) ?? { count: 0, sumC: 0, sumE: 0 };
      cur.count++;
      cur.sumC += c;
      cur.sumE += e;
      m.set(h.stage_id, cur);
    });
    return Array.from(m.entries())
      .map(([id, v]) => {
        const st = stageMap.get(id)!;
        const pipe = pipeMap.get(st.pipeline_id);
        const avgC = v.sumC / v.count;
        const avgE = v.sumE / v.count;
        return {
          id,
          nome: st.nome,
          pipeNome: pipe?.nome ?? "—",
          sla: formatMin(st.sla_minutos),
          ct: formatMinCal(avgC),
          et: formatMin(avgE),
          ePct: Math.round((avgE / st.sla_minutos!) * 100),
          pipePos: pipe?.position ?? 0,
          stagePos: st.position,
        };
      })
      .sort((a, b) => a.pipePos - b.pipePos || a.stagePos - b.stagePos);
  }, [journeys, historyQ.data, stageMap, pipeMap]);

  return (
    <>
      {/* ===== SLA Total ===== */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          SLA Total · {total.withSla} jornadas com SLA · medido em horário útil
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={Clock} label="No prazo · bruto" value={`${total.pctC}%`} sub={`${total.okC} de ${total.withSla} no prazo`} tone={complianceTone(total.pctC)} />
          <KpiCard icon={CheckCircle2} label="No prazo · efetivo" value={`${total.pctE}%`} sub={`${total.okE} de ${total.withSla} no prazo`} tone={complianceTone(total.pctE)} />
          <KpiCard icon={Pause} label="Tempo parado" value={formatMin(total.parado)} sub={`${total.paradoPct}% do expediente`} tone="warning" />
          <KpiCard icon={TrendingUp} label="Ciclo médio · efetivo" value={formatMin(total.cicloE)} sub={`calendário ${formatMinCal(total.cicloCal)}`} tone="success" />
        </div>
      </section>

      {/* ===== SLA por dimensão (abas) ===== */}
      <section>
        <Tabs defaultValue="pipeline">
          <TabsList>
            <TabsTrigger value="pipeline" className="gap-1.5">
              Por Pipeline <span className="text-[10px] rounded-full bg-border px-1.5 leading-4">{pipelineAgg.length}</span>
            </TabsTrigger>
            <TabsTrigger value="etapa" className="gap-1.5">
              Por Etapa <span className="text-[10px] rounded-full bg-border px-1.5 leading-4">{etapaAgg.length}</span>
            </TabsTrigger>
            <TabsTrigger value="area" className="gap-1.5">
              Por Área <span className="text-[10px] rounded-full bg-border px-1.5 leading-4">{areaAgg.length}</span>
            </TabsTrigger>
          </TabsList>

          {/* Pipeline */}
          <TabsContent value="pipeline">
            <p className="text-[11px] text-muted-foreground mb-2">% no prazo · bruto vs. efetivo (horário útil), por pipeline</p>
            {pipelineAgg.length === 0 ? (
              <EmptyNote>Nenhuma jornada com SLA de pipeline definido.</EmptyNote>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pipelineAgg.map((p) => (
                  <ComplianceCard key={p.id} name={p.nome} badge={p.fase} meta={`${p.count} ${p.count === 1 ? "jornada" : "jornadas"} · SLA ${p.target}`} npC={p.npC} npE={p.npE} ct={p.ct} et={p.et} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Etapa */}
          <TabsContent value="etapa">
            <div className="flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground mb-2">
              <span className="inline-flex items-center gap-1.5"><span className="w-5 h-2 rounded-sm bg-[hsl(142_71%_45%)]" />Expediente consumido</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-destructive" />linha do SLA (100%) · marca fina = 70%</span>
            </div>
            {etapaAgg.length === 0 ? (
              <EmptyNote>Nenhuma etapa concluída com SLA definido no período.</EmptyNote>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {etapaAgg.map((e) => (
                  <EtapaCard key={e.id} name={e.nome} pipe={e.pipeNome} sla={e.sla} ct={e.ct} et={e.et} ePct={e.ePct} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Área */}
          <TabsContent value="area">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <p className="text-[11px] text-muted-foreground">% no prazo · bruto vs. efetivo (horário útil)</p>
              <div className="inline-flex bg-muted rounded-md p-0.5">
                {(["demanda", "setor"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setAreaDim(d)}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-sm transition-colors",
                      areaDim === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d === "demanda" ? "Tipo de demanda" : "Setor"}
                  </button>
                ))}
              </div>
            </div>
            {areaAgg.length === 0 ? (
              <EmptyNote>Nenhuma jornada com SLA para agrupar por {areaDim === "demanda" ? "tipo de demanda" : "setor"}.</EmptyNote>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {areaAgg.map((a) => (
                  <ComplianceCard key={a.key} name={a.key} meta={`${a.count} ${a.count === 1 ? "jornada" : "jornadas"}`} npC={a.npC} npE={a.npE} ct={a.ct} et={a.et} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </>
  );
}
