import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, CheckCircle2, AlertTriangle, UserCheck, GraduationCap,
  RotateCcw, TrendingUp, Info, Pause, UserX,
} from "lucide-react";

import { startOfMonth, endOfMonth } from "date-fns";

interface JourneyRow {
  journey_id: string;
  situacao: string | null;
  fase_atual: string | null;
  etapa_semaforo: "verde" | "amarelo" | "vermelho" | "sem_sla" | null;
  sla_util_min: number | null;
  sla_corrido_min: number | null;
}

interface TrainingRow {
  id?: string;
  journey_id: string | null;
  training_type_id: string | null;
  tipo_nome: string | null;
  conta_como_pdv: boolean | null;
  status: string | null;
  no_show: boolean | null;
  tentativas: number | null;
  proprietario_presente: boolean | null;
  is_retreinamento: boolean | null;
  conduzido_por: string | null;
  realizado_em: string | null;
  agendado_para: string | null;
}


function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function formatMin(min: number | null | undefined): string {
  if (min == null || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function KpiCard({
  icon: Icon, label, value, sub, tone = "default", subTone,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  subTone?: "success" | "warning" | "danger" | "muted";
}) {
  const toneClass: Record<string, string> = {
    default: "text-foreground",
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    info: "text-[hsl(199_89%_48%)]",
  };
  const subToneClass: Record<string, string> = {
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    muted: "text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${toneClass[tone]}`} />
      </div>
      <div className={`text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
      {sub && <div className={`text-[11px] ${subToneClass[subTone ?? "muted"]}`}>{sub}</div>}
    </div>
  );
}

export default function OnboardingDashboardPage() {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const isSuperAdmin = profile?.is_super_admin === true;

  const journeysQ = useQuery({
    queryKey: ["onboarding-dash-journeys", effectiveTenantId],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<JourneyRow>(() =>
        (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, situacao, fase_atual, etapa_semaforo, sla_util_min, sla_corrido_min")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const trainingsAllQ = useQuery({
    queryKey: ["onboarding-dash-trainings-kpis", effectiveTenantId],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<TrainingRow>(() =>
        (supabase.from("vw_onboarding_training_kpis" as any) as any)
          .select("journey_id, training_type_id, tipo_nome, conta_como_pdv, status, no_show, tentativas, proprietario_presente, is_retreinamento, conduzido_por, agendado_para, realizado_em")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const pausesAllQ = useQuery({
    queryKey: ["onboarding-dash-pauses-by-reason", effectiveTenantId],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ motivo_nome: string | null; minutos: number | null; em_andamento: boolean; iniciada_em: string }>(() =>
        (supabase.from("vw_onboarding_pauses_by_reason" as any) as any)
          .select("motivo_nome, minutos, em_andamento, iniciada_em")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const pausesByReasonAgg = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    const rows = (pausesAllQ.data ?? []).filter((p) => {
      const d = new Date(p.iniciada_em).getTime();
      return d >= from && d <= to;
    });
    const agg = new Map<string, { minutos: number; count: number; em_andamento: boolean }>();
    rows.forEach((p) => {
      const name = p.motivo_nome || "Sem motivo";
      const cur = agg.get(name) || { minutos: 0, count: 0, em_andamento: false };
      cur.minutos += p.minutos ?? 0;
      cur.count += 1;
      cur.em_andamento = cur.em_andamento || p.em_andamento;
      agg.set(name, cur);
    });
    return Array.from(agg.entries())
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.minutos - a.minutos);
  }, [pausesAllQ.data, dateRange]);

  const pausesTotalMin = useMemo(
    () => pausesByReasonAgg.reduce((s, r) => s + r.minutos, 0),
    [pausesByReasonAgg]
  );

  const vendorReturnsAllQ = useQuery({
    queryKey: ["onboarding-dash-vendor-returns", effectiveTenantId],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{
        vendedor_user_id: string; motivo_nome: string | null; atribuivel_vendedor: boolean;
        retornado_em: string; resolvido_em: string | null; em_aberto: boolean; minutos: number | null;
      }>(() =>
        (supabase.from("vw_onboarding_vendor_returns" as any) as any)
          .select("vendedor_user_id, motivo_nome, atribuivel_vendedor, retornado_em, resolvido_em, em_aberto, minutos")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const vendorReturnsPeriodo = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    return (vendorReturnsAllQ.data ?? []).filter((r) => {
      const d = new Date(r.retornado_em).getTime();
      return d >= from && d <= to;
    });
  }, [vendorReturnsAllQ.data, dateRange]);

  const vendorReturnUserIds = useMemo(
    () => Array.from(new Set(vendorReturnsPeriodo.map((r) => r.vendedor_user_id).filter(Boolean))) as string[],
    [vendorReturnsPeriodo]
  );

  const vendorNamesQ = useQuery({
    queryKey: ["onboarding-dash-vendor-names", vendorReturnUserIds.join(",")],
    enabled: vendorReturnUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", vendorReturnUserIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => {
        if (p.funcionarios?.nome) map[p.user_id] = p.funcionarios.nome;
      });
      return map;
    },
  });

  const vendorNames = vendorNamesQ.data ?? {};

  const vendorReturnsTotal = vendorReturnsPeriodo.length;
  const vendorReturnsAtribuiveis = vendorReturnsPeriodo.filter((r) => r.atribuivel_vendedor).length;
  const vendorReturnsAtribuiveisPct = pct(vendorReturnsAtribuiveis, vendorReturnsTotal);

  const vendorReturnsByVendor = useMemo(() => {
    const m: Record<string, { total: number; atribuiveis: number; minutosResolvidos: number; countResolvidos: number }> = {};
    vendorReturnsPeriodo.forEach((r) => {
      const id = r.vendedor_user_id || "__sem__";
      if (!m[id]) m[id] = { total: 0, atribuiveis: 0, minutosResolvidos: 0, countResolvidos: 0 };
      m[id].total += 1;
      if (r.atribuivel_vendedor) m[id].atribuiveis += 1;
      if (r.resolvido_em && r.minutos != null) {
        m[id].minutosResolvidos += r.minutos;
        m[id].countResolvidos += 1;
      }
    });
    return Object.entries(m).map(([id, s]) => ({
      id,
      nome: id === "__sem__" ? "—" : (vendorNames[id] || "—"),
      total: s.total,
      atribuiveis: s.atribuiveis,
      tmr: s.countResolvidos > 0 ? s.minutosResolvidos / s.countResolvidos : null,
    })).sort((a, b) => b.total - a.total);
  }, [vendorReturnsPeriodo, vendorNames]);

  const vendorReturnsByReason = useMemo(() => {
    const m: Record<string, { total: number; atribuivel: boolean }> = {};
    vendorReturnsPeriodo.forEach((r) => {
      const nome = r.motivo_nome || "Sem motivo";
      if (!m[nome]) m[nome] = { total: 0, atribuivel: r.atribuivel_vendedor };
      m[nome].total += 1;
    });
    return Object.entries(m).map(([nome, s]) => ({ nome, ...s })).sort((a, b) => b.total - a.total);
  }, [vendorReturnsPeriodo]);


  // Treinos no período: usa realizado_em quando existe, senão agendado_para
  const trainings = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    return (trainingsAllQ.data ?? []).filter((t) => {
      const ref = t.realizado_em || t.agendado_para;
      if (!ref) return false;
      const d = new Date(ref).getTime();
      return d >= from && d <= to;
    });
  }, [trainingsAllQ.data, dateRange]);

  // Resolver nomes dos implantadores via profiles → funcionarios
  const conduzidoIds = useMemo(
    () => Array.from(new Set(trainings.map((t) => t.conduzido_por).filter(Boolean))) as string[],
    [trainings]
  );

  const namesQ = useQuery({
    queryKey: ["onboarding-dash-implantador-names", conduzidoIds.join(",")],
    enabled: conduzidoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", conduzidoIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => {
        if (p.funcionarios?.nome) map[p.user_id] = p.funcionarios.nome;
      });
      return map;
    },
  });

  const journeys = journeysQ.data ?? [];
  const names = namesQ.data ?? {};

  // KPIs jornadas (SLA)
  const totalJ = journeys.length;
  const noPrazo = journeys.filter((j) => j.etapa_semaforo === "verde" || j.etapa_semaforo === "amarelo").length;
  const foraPrazo = journeys.filter((j) => j.etapa_semaforo === "vermelho").length;
  const semSla = journeys.filter((j) => !j.etapa_semaforo || j.etapa_semaforo === "sem_sla").length;
  const noPrazoPct = pct(noPrazo, totalJ - semSla);
  const concluidas = journeys.filter((j) => j.situacao === "concluido").length;

  // KPIs treinos
  const realizadosOuNoShow = trainings.filter((t) => t.status === "realizado" || t.no_show === true);
  const noShows = trainings.filter((t) => t.no_show === true);
  const noShowRate = pct(noShows.length, realizadosOuNoShow.length);
  const realizados = trainings.filter((t) => t.status === "realizado");
  const propPresent = realizados.filter((t) => t.proprietario_presente === true);
  const propRate = pct(propPresent.length, realizados.length);
  const retreinos = trainings.filter((t) => t.is_retreinamento === true);
  const retreinosPct = pct(retreinos.length, trainings.length);

  // Previstos/Agendados vs Realizados
  const previstos = trainings.filter((t) => t.status === "previsto" || t.status === "agendado");
  const realizadoPct = pct(realizados.length, previstos.length + realizados.length);

  // PDV finalizados: treinos realizados com conta_como_pdv=true
  const pdvFinalizados = realizados.filter((t) => t.conta_como_pdv === true).length;

  // Primeiro no-show: treinos com no_show=true e tentativas <= 1
  const primeiroNoShow = trainings.filter((t) => t.no_show === true && (t.tentativas ?? 0) <= 1).length;

  // Tabela por implantador
  const byImplantador = useMemo(() => {
    const m: Record<string, { total: number; realizado: number; no_show: number; retreino: number }> = {};
    trainings.forEach((t) => {
      const id = t.conduzido_por || "__sem__";
      if (!m[id]) m[id] = { total: 0, realizado: 0, no_show: 0, retreino: 0 };
      m[id].total += 1;
      if (t.status === "realizado") m[id].realizado += 1;
      if (t.no_show) m[id].no_show += 1;
      if (t.is_retreinamento) m[id].retreino += 1;
    });
    return Object.entries(m)
      .map(([id, s]) => ({
        id,
        nome: id === "__sem__" ? "Sem implantador" : (names[id] || "—"),
        ...s,
        pctRealizado: pct(s.realizado, s.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [trainings, names]);

  // Tabela por tipo de treino
  const byTipo = useMemo(() => {
    const m: Record<string, { nome: string; previstos: number; realizados: number; no_show: number }> = {};
    trainings.forEach((t) => {
      const key = t.training_type_id || "__sem__";
      const nome = t.tipo_nome || "Sem tipo";
      if (!m[key]) m[key] = { nome, previstos: 0, realizados: 0, no_show: 0 };
      if (t.status === "previsto" || t.status === "agendado") m[key].previstos += 1;
      if (t.status === "realizado") m[key].realizados += 1;
      if (t.no_show) m[key].no_show += 1;
    });
    return Object.values(m).sort((a, b) => (b.realizados + b.previstos) - (a.realizados + a.previstos));
  }, [trainings]);


  if (profileLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isSuperAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a super administradores.</div>;
  }

  const loading = journeysQ.isLoading || trainingsAllQ.isLoading;

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border bg-background sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold">Dashboard de Onboarding</h1>
          <p className="text-xs text-muted-foreground">SLA de jornadas e performance por implantador</p>
        </div>
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} align="end" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {/* KPI Row 1: SLA jornadas */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SLA de Jornadas</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={CheckCircle2}
                label="No prazo"
                value={`${noPrazoPct}%`}
                sub={`${noPrazo} de ${totalJ - semSla} jornadas`}
                tone="success"
                subTone="muted"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Fora do prazo"
                value={String(foraPrazo)}
                sub={`${pct(foraPrazo, totalJ - semSla)}% do total`}
                tone="danger"
                subTone="muted"
              />
              <KpiCard
                icon={TrendingUp}
                label="Total ativas"
                value={String(totalJ)}
                sub={`${semSla} sem SLA definido`}
                tone="info"
                subTone="muted"
              />
              <KpiCard
                icon={GraduationCap}
                label="Retreinamentos"
                value={String(retreinos)}
                sub="no período"
                tone="warning"
                subTone="muted"
              />
            </div>
          </section>

          {/* KPI Row 1b: PDV + previsto/realizado */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Indicadores Fase 1 · PDV</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={CheckCircle2}
                label="Total PDV finalizados"
                value={String(pdvFinalizados)}
                sub={`${concluidas} jornadas concluídas`}
                tone="success"
                subTone="muted"
              />
              <KpiCard
                icon={GraduationCap}
                label="% Realizado"
                value={`${realizadoPct}%`}
                sub={`${realizados.length} realiz. / ${previstos.length} prev.`}
                tone={realizadoPct >= 80 ? "success" : realizadoPct >= 60 ? "warning" : "danger"}
                subTone="muted"
              />
              <KpiCard
                icon={AlertTriangle}
                label="1º No-show"
                value={String(primeiroNoShow)}
                sub={`${noShowRate}% no-show geral`}
                tone={primeiroNoShow === 0 ? "success" : "warning"}
                subTone="muted"
              />
              <KpiCard
                icon={RotateCcw}
                label="% Retreinamento"
                value={`${retreinosPct}%`}
                sub={`${retreinos.length} de ${trainings.length} treinos`}
                tone={retreinosPct < 15 ? "success" : retreinosPct < 30 ? "warning" : "danger"}
                subTone="muted"
              />
            </div>
          </section>


          {/* KPI Row 2: Treinos */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Treinamentos no período</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <KpiCard
                icon={AlertTriangle}
                label="Taxa de no-show"
                value={`${noShowRate}%`}
                sub={`${noShows.length} de ${realizadosOuNoShow.length} • meta < 20%`}
                tone={noShowRate < 20 ? "success" : noShowRate < 30 ? "warning" : "danger"}
                subTone={noShowRate < 20 ? "success" : "danger"}
              />
              <KpiCard
                icon={UserCheck}
                label="Proprietário presente"
                value={`${propRate}%`}
                sub={`${propPresent.length} de ${realizados.length} • meta > 90%`}
                tone={propRate >= 90 ? "success" : propRate >= 75 ? "warning" : "danger"}
                subTone={propRate >= 90 ? "success" : "danger"}
              />
              <KpiCard
                icon={GraduationCap}
                label="Treinos realizados"
                value={String(realizados.length)}
                sub={`${trainings.length} agendados no total`}
                tone="info"
              />
            </div>
          </section>

          {/* Tabela por tipo de treino */}
          <section className="rounded-lg border border-border bg-card">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Quantidade por tipo de treino</h2>
              <Badge variant="outline" className="text-[10px]">{byTipo.length}</Badge>
            </div>
            {byTipo.length === 0 ? (
              <p className="text-xs text-muted-foreground p-6 text-center">Nenhum treino registrado no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium text-right">Previstos</th>
                      <th className="px-3 py-2 font-medium text-right">Realizados</th>
                      <th className="px-3 py-2 font-medium text-right">No-show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byTipo.map((row) => (
                      <tr key={row.nome} className="border-t border-border hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{row.nome}</td>
                        <td className="px-3 py-2 text-right">{row.previstos}</td>
                        <td className="px-3 py-2 text-right text-[hsl(142_71%_45%)] font-medium">{row.realizados}</td>
                        <td className={`px-3 py-2 text-right ${row.no_show > 0 ? "text-destructive font-medium" : ""}`}>
                          {row.no_show}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tabela por implantador */}

          <section className="rounded-lg border border-border bg-card">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Performance por implantador</h2>
              <Badge variant="outline" className="text-[10px]">{byImplantador.length}</Badge>
            </div>
            {byImplantador.length === 0 ? (
              <p className="text-xs text-muted-foreground p-6 text-center">Nenhum treino registrado no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Implantador</th>
                      <th className="px-3 py-2 font-medium text-right">Treinos</th>
                      <th className="px-3 py-2 font-medium text-right">No-show</th>
                      <th className="px-3 py-2 font-medium text-right">Retreinos</th>
                      <th className="px-3 py-2 font-medium min-w-[200px]">% Realizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byImplantador.map((row) => (
                      <tr key={row.id} className="border-t border-border hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{row.nome}</td>
                        <td className="px-3 py-2 text-right">{row.total}</td>
                        <td className={`px-3 py-2 text-right ${row.no_show > 0 ? "text-destructive font-medium" : ""}`}>
                          {row.no_show}
                        </td>
                        <td className="px-3 py-2 text-right">{row.retreino}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={row.pctRealizado} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground w-10 text-right">{row.pctRealizado}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tempo parado por motivo */}
          <section className="rounded-lg border border-border bg-card">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Pause className="h-4 w-4" /> Tempo parado por motivo
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Soma de minutos por motivo em pausas iniciadas no período · total {formatMin(pausesTotalMin)}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">{pausesByReasonAgg.length}</Badge>
            </div>
            {pausesByReasonAgg.length === 0 ? (
              <p className="text-xs text-muted-foreground p-6 text-center">Nenhuma pausa iniciada no período selecionado.</p>
            ) : (
              <div className="p-3 space-y-1.5">
                {pausesByReasonAgg.map((r) => {
                  const p = pausesTotalMin > 0 ? (r.minutos / pausesTotalMin) * 100 : 0;
                  return (
                    <div key={r.nome} className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium truncate">{r.nome}</span>
                          {r.em_andamento && (
                            <Badge className="text-[9px] border-0 text-white shrink-0" style={{ backgroundColor: "hsl(38 92% 50%)" }}>
                              em andamento
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground shrink-0">· {r.count}x</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums shrink-0">{formatMin(r.minutos)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded bg-muted overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{ width: `${Math.max(2, p)}%`, background: "hsl(38 92% 50%)" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Fase 2 placeholder */}
          <section className="rounded-lg border border-dashed border-border bg-muted/20 p-4 flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold">Fase 2 (em breve)</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Continuidade de vendas, clientes com menos de 100 vendas e recuperados — chegam com a integração OEM (PDV Legal).
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
