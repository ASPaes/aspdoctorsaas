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
  RotateCcw, TrendingUp, Info,
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
  id: string;
  journey_id: string;
  status: string | null;
  no_show: boolean | null;
  tentativas: number | null;
  proprietario_presente: boolean | null;
  is_retreinamento: boolean | null;
  conduzido_por: string | null;
  realizado_em: string | null;
}

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
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
    queryKey: ["onboarding-dash-trainings-all", effectiveTenantId],
    enabled: isSuperAdmin && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<TrainingRow>(() =>
        (supabase.from("onboarding_training_sessions" as any) as any)
          .select("id, journey_id, status, no_show, tentativas, proprietario_presente, is_retreinamento, conduzido_por, realizado_em")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const trainings = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    return (trainingsAllQ.data ?? []).filter((t) => {
      if (!t.realizado_em) return false;
      const d = new Date(t.realizado_em).getTime();
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

  // KPIs treinos
  const realizadosOuNoShow = trainings.filter((t) => t.status === "realizado" || t.no_show === true);
  const noShows = trainings.filter((t) => t.no_show === true);
  const noShowRate = pct(noShows.length, realizadosOuNoShow.length);
  const realizados = trainings.filter((t) => t.status === "realizado");
  const propPresent = realizados.filter((t) => t.proprietario_presente === true);
  const propRate = pct(propPresent.length, realizados.length);
  const retreinos = trainings.filter((t) => t.is_retreinamento === true).length;

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

  if (profileLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isSuperAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito a super administradores.</div>;
  }

  const loading = journeysQ.isLoading || trainingsQ.isLoading;

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
