import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, CheckCircle2, AlertTriangle, UserCheck, GraduationCap,
  RotateCcw, TrendingUp, Info, Pause, UserX,
} from "lucide-react";

import { startOfMonth, endOfMonth } from "date-fns";
import OnboardingSlaOverview from "./OnboardingSlaOverview";
import SituacaoAgoraBand from "./SituacaoAgoraBand";
import KpiCard from "./KpiCard";
import OnboardingDashFilterBar from "./OnboardingDashFilterBar";
import { useOnboardingDashFilters } from "./useOnboardingDashFilters";
import { pct, separarJornadas, contarSituacao, agregarTreinos, desfechoTreino } from "./dashMetrics";

interface JourneyRow {
  journey_id: string;
  situacao: string | null;
  aberta_em: string | null;
  fase_atual: string | null;
  etapa_semaforo: "verde" | "amarelo" | "vermelho" | "sem_sla" | null;
  sla_util_min: number | null;
  sla_corrido_min: number | null;
  // Campos usados pela visão de SLA (corrido vs. efetivo)
  concluido_em: string | null;

  demand_type_nome: string | null;
  demand_type_id: string | null;
  responsavel_user_id: string | null;
  responsavel_nome: string | null;
  ticket_id: string | null;
  implantacao_iniciada_em: string | null;
  implantacao_concluida_em: string | null;
  setor_nome: string | null;
  sla_total_corrido_min: number | null;
  sla_total_pausado_min: number | null;
  sla_total_util_min: number | null;
}

interface TrainingRow {
  id?: string;
  journey_id: string | null;
  training_type_id: string | null;
  tipo_nome: string | null;
  conta_como_pdv: boolean | null;
  status: string | null;
  no_show: boolean | null;
  no_shows: number | null;
  tentativas: number | null;
  proprietario_presente: boolean | null;
  is_retreinamento: boolean | null;
  conduzido_por: string | null;
  realizado_em: string | null;
  agendado_para: string | null;
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

export default function OnboardingDashboardPage() {
  const { profileLoading } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const { selectedUnidadeIds, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { canAccess, isLoading: accessLoading } = useOnboardingAccess();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const journeysQ = useQuery({
    queryKey: ["onboarding-dash-journeys", effectiveTenantId, viewKey],
    enabled: canAccess && !!effectiveTenantId && unidadeFilterReady,
    queryFn: async () => {
      const rows = await fetchAllRows<JourneyRow>(() => {
        let q = (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, situacao, fase_atual, etapa_semaforo, sla_util_min, sla_corrido_min, cliente_unidade_id, concluido_em, aberta_em, demand_type_nome, demand_type_id, responsavel_user_id, responsavel_nome, ticket_id, implantacao_iniciada_em, implantacao_concluida_em, setor_nome, sla_total_corrido_min, sla_total_pausado_min, sla_total_util_min")
          .eq("tenant_id", effectiveTenantId);
        if (selectedUnidadeIds.length > 0) q = q.in("cliente_unidade_id", selectedUnidadeIds);
        return q;
      });
      return rows;
    },
  });

  const trainingsAllQ = useQuery({
    queryKey: ["onboarding-dash-trainings-kpis", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<TrainingRow>(() =>
        (supabase.from("vw_onboarding_training_kpis" as any) as any)
          .select("journey_id, training_type_id, tipo_nome, conta_como_pdv, status, no_show, no_shows, tentativas, proprietario_presente, is_retreinamento, conduzido_por, agendado_para, realizado_em")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  /** O card de PDV mostra 0 quando NENHUM tipo de treino tem a flag marcada — o que é
   *  cadastro em branco, não resultado. Esta query distingue os dois casos. */
  const temTipoPdvQ = useQuery({
    queryKey: ["onboarding-dash-tem-tipo-pdv", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_training_types" as any) as any)
        .select("id")
        .eq("tenant_id", effectiveTenantId)
        .eq("conta_como_pdv", true)
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown[]).length > 0;
    },
  });

  /** Só afirma "falta marcar" quando a query confirmou. Enquanto carrega, mostra o número. */
  const semTipoPdv = temTipoPdvQ.data === false;

  const pausesAllQ = useQuery({
    queryKey: ["onboarding-dash-pauses-by-reason", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ journey_id: string; motivo_nome: string | null; minutos: number | null; em_andamento: boolean; iniciada_em: string }>(() =>
        (supabase.from("vw_onboarding_pauses_by_reason" as any) as any)
          .select("journey_id, motivo_nome, minutos, em_andamento, iniciada_em")
          .eq("tenant_id", effectiveTenantId)
      );
      return rows;
    },
  });

  const journeys = useMemo(() => journeysQ.data ?? [], [journeysQ.data]);

  const dashFilters = useOnboardingDashFilters(journeys, effectiveTenantId, canAccess);

  /** O filtro entra ANTES de tudo: `ativas` e `allowedJourneyIds` derivam daqui, e é
   *  por isso que treinos, pausas e retornos obedecem ao filtro sem mudança própria. */
  const journeysFiltradas = useMemo(
    () => (dashFilters.ativo ? journeys.filter((j) => dashFilters.allowedByFilter.has(j.journey_id)) : journeys),
    [journeys, dashFilters.ativo, dashFilters.allowedByFilter],
  );

  /** Canceladas ficam fora de tudo. Só a faixa "Situação agora" usa a lista inteira. */
  const { ativas, periodo } = useMemo(
    () => separarJornadas(journeysFiltradas, dateRange),
    [journeysFiltradas, dateRange],
  );

  const contagem = useMemo(() => contarSituacao(journeysFiltradas), [journeysFiltradas]);

  /** Allowlist de treinos/pausas/retornos: SEM canceladas, mas SEM recorte por
   *  abertura — esses três já filtram pela data do próprio evento. Usar `periodo`
   *  aqui sumiria com um treino de agosto numa jornada aberta em junho. */
  const allowedJourneyIds = useMemo(
    () => new Set(ativas.map((j) => j.journey_id)),
    [ativas]
  );

  const pausesByReasonAgg = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    const rows = (pausesAllQ.data ?? []).filter((p) => {
      const d = new Date(p.iniciada_em).getTime();
      return d >= from && d <= to && allowedJourneyIds.has(p.journey_id);
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
  }, [pausesAllQ.data, dateRange, allowedJourneyIds]);

  const pausesTotalMin = useMemo(
    () => pausesByReasonAgg.reduce((s, r) => s + r.minutos, 0),
    [pausesByReasonAgg]
  );

  const vendorReturnsAllQ = useQuery({
    queryKey: ["onboarding-dash-vendor-returns", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{
        journey_id: string; vendedor_user_id: string; motivo_nome: string | null; atribuivel_vendedor: boolean;
        retornado_em: string; resolvido_em: string | null; em_aberto: boolean; minutos: number | null;
      }>(() =>
        (supabase.from("vw_onboarding_vendor_returns" as any) as any)
          .select("journey_id, vendedor_user_id, motivo_nome, atribuivel_vendedor, retornado_em, resolvido_em, em_aberto, minutos")
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
      return d >= from && d <= to && allowedJourneyIds.has(r.journey_id);
    });
  }, [vendorReturnsAllQ.data, dateRange, allowedJourneyIds]);

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
      return d >= from && d <= to && t.journey_id != null && allowedJourneyIds.has(t.journey_id);
    });
  }, [trainingsAllQ.data, dateRange, allowedJourneyIds]);

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

  const names = namesQ.data ?? {};

  // KPIs treinos — desfecho vem do status; falta vem do contador `no_shows`.
  const tr = useMemo(() => agregarTreinos(trainings), [trainings]);

  /** Faltas do treino. O contador manda; a flag pegajosa cobre o que é anterior ao
   *  backfill de 11/08. Contar falta pelo DESFECHO zeraria as colunas: desde 11/08 o
   *  no-show devolve o treino para `previsto` em vez de parar em `no_show`. */
  function faltasDe(t: { no_shows: number | null; no_show: boolean | null }): number {
    return (t.no_shows ?? 0) > 0 ? (t.no_shows as number) : (t.no_show === true ? 1 : 0);
  }

  // Tabela por implantador
  const byImplantador = useMemo(() => {
    const m: Record<string, { total: number; realizado: number; no_show: number; retreino: number }> = {};
    trainings.forEach((t) => {
      const id = t.conduzido_por || "__sem__";
      if (!m[id]) m[id] = { total: 0, realizado: 0, no_show: 0, retreino: 0 };
      const d = desfechoTreino(t.status);
      if (d === "cancelado") return; // cancelado não é performance de ninguém
      m[id].total += 1;
      if (d === "realizado") m[id].realizado += 1;
      m[id].no_show += faltasDe(t);
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
    const m: Record<string, { nome: string; previstos: number; realizados: number; no_show: number; cancelados: number }> = {};
    trainings.forEach((t) => {
      const key = t.training_type_id || "__sem__";
      const nome = t.tipo_nome || "Sem tipo";
      if (!m[key]) m[key] = { nome, previstos: 0, realizados: 0, no_show: 0, cancelados: 0 };
      switch (desfechoTreino(t.status)) {
        case "em_aberto": m[key].previstos += 1; break;
        case "realizado": m[key].realizados += 1; break;
        case "no_show": m[key].previstos += 1; break; // desfecho residual: segue em aberto
        case "cancelado": m[key].cancelados += 1; break;
      }
      m[key].no_show += faltasDe(t);
    });
    return Object.values(m).sort((a, b) => (b.realizados + b.previstos) - (a.realizados + a.previstos));
  }, [trainings]);


  if (profileLoading || accessLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!canAccess) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso não liberado a este módulo.</div>;
  }

  const loading = journeysQ.isLoading || trainingsAllQ.isLoading;

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-y-auto">
      <div className="p-4 border-b border-border bg-background sticky top-0 z-10 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Dashboard de Onboarding</h1>
            <p className="text-xs text-muted-foreground">SLA de jornadas e performance por implantador</p>
          </div>
          <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} align="end" />
        </div>
        <OnboardingDashFilterBar
          filtro={dashFilters.filtro}
          setFiltro={dashFilters.setFiltro}
          limpar={dashFilters.limpar}
          ativo={dashFilters.ativo}
          opcoes={dashFilters.opcoes}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {dashFilters.ativo && journeysFiltradas.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="text-sm font-medium">Nenhuma jornada bate com os filtros.</p>
              <Button variant="link" size="sm" onClick={dashFilters.limpar}>
                Limpar filtros
              </Button>
            </div>
          )}

          <SituacaoAgoraBand contagem={contagem} />

          {/* SLA — visão corrido vs. efetivo (total, pipeline, etapa, área) */}
          <OnboardingSlaOverview journeys={periodo} tenantId={effectiveTenantId} />

          {/* KPI Row 1b: PDV + previsto/realizado */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Indicadores Fase 1 · PDV</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={CheckCircle2}
                label="Total PDV finalizados"
                value={semTipoPdv ? "—" : String(tr.pdvFinalizados)}
                sub={
                  semTipoPdv
                    ? "nenhum tipo de treino marcado como PDV no cadastro"
                    : `${tr.realizado} treinos realizados no período`
                }
                tone={semTipoPdv ? "default" : "success"}
                subTone={semTipoPdv ? "warning" : "muted"}
              />
              <KpiCard
                icon={GraduationCap}
                label="% Realizado"
                value={`${tr.realizadoPct}%`}
                sub={`${tr.realizado} realiz. / ${tr.validos} válidos`}
                tone={tr.realizadoPct >= 80 ? "success" : tr.realizadoPct >= 60 ? "warning" : "danger"}
                subTone="muted"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Faltas"
                value={String(tr.faltas)}
                sub={`${tr.comFalta} ${tr.comFalta === 1 ? "treino faltou" : "treinos faltaram"} ao menos 1x`}
                tone={tr.faltas === 0 ? "success" : "warning"}
                subTone="muted"
              />
              <KpiCard
                icon={RotateCcw}
                label="% Retreinamento"
                value={`${tr.retreinosPct}%`}
                sub={`${tr.retreinos} de ${tr.validos} treinos`}
                tone={tr.retreinosPct < 15 ? "success" : tr.retreinosPct < 30 ? "warning" : "danger"}
                subTone="muted"
              />
            </div>
            {semTipoPdv && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Para este indicador funcionar, marque "conta como PDV" no tipo de treino em{" "}
                <Link to="/onboarding-implantacao/config" className="underline hover:text-foreground">
                  Configuração · Implantação
                </Link>
                , aba "Tipos de treino".
              </p>
            )}
          </section>


          {/* KPI Row 2: Treinos */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Treinamentos no período</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <KpiCard
                icon={AlertTriangle}
                label="Taxa de no-show"
                value={`${tr.noShowRate}%`}
                sub={`${tr.comFalta} de ${tr.validos} treinos • meta < 20%`}
                tone={tr.noShowRate < 20 ? "success" : tr.noShowRate < 30 ? "warning" : "danger"}
                subTone={tr.noShowRate < 20 ? "success" : "danger"}
              />
              <KpiCard
                icon={UserCheck}
                label="Proprietário presente"
                value={tr.propPct == null ? "—" : `${tr.propPct}%`}
                sub={
                  tr.propPct == null
                    ? `não informado em ${tr.realizado} ${tr.realizado === 1 ? "treino realizado" : "treinos realizados"}`
                    : `${tr.propSim} de ${tr.propInformado} informados · ${tr.propInformado} de ${tr.realizado} preenchidos · meta > 90%`
                }
                tone={tr.propPct == null ? "default" : tr.propPct >= 90 ? "success" : tr.propPct >= 75 ? "warning" : "danger"}
                subTone={tr.propPct == null ? "warning" : tr.propPct >= 90 ? "success" : "danger"}
              />
              <KpiCard
                icon={GraduationCap}
                label="Treinos realizados"
                value={String(tr.realizado)}
                sub={`${tr.validos} válidos · ${tr.cancelado} cancelados`}
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
                      <th className="px-3 py-2 font-medium text-right">Cancelados</th>
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
                        <td className="px-3 py-2 text-right text-muted-foreground">{row.cancelados}</td>
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

          {/* Retornos ao vendedor */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Retornos ao vendedor</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <KpiCard
                icon={UserX}
                label="Total de retornos"
                value={String(vendorReturnsTotal)}
                sub="no período"
                tone="info"
                subTone="muted"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Atribuíveis ao vendedor"
                value={String(vendorReturnsAtribuiveis)}
                sub={`${vendorReturnsAtribuiveisPct}% do total · qualidade`}
                tone={vendorReturnsAtribuiveisPct === 0 ? "success" : vendorReturnsAtribuiveisPct < 30 ? "warning" : "danger"}
                subTone={vendorReturnsAtribuiveisPct === 0 ? "success" : vendorReturnsAtribuiveisPct < 30 ? "warning" : "danger"}
              />
              <KpiCard
                icon={Pause}
                label="Em aberto"
                value={String(vendorReturnsPeriodo.filter((r) => r.em_aberto).length)}
                sub="aguardando vendedor"
                tone="warning"
                subTone="muted"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Por vendedor</h3>
                  <Badge variant="outline" className="text-[10px]">{vendorReturnsByVendor.length}</Badge>
                </div>
                {vendorReturnsByVendor.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-6 text-center">Nenhum retorno no período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-medium">Vendedor</th>
                          <th className="px-3 py-2 font-medium text-right">Total</th>
                          <th className="px-3 py-2 font-medium text-right">Atribuíveis</th>
                          <th className="px-3 py-2 font-medium text-right">TMR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorReturnsByVendor.map((row) => (
                          <tr key={row.id} className="border-t border-border hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium">{row.nome}</td>
                            <td className="px-3 py-2 text-right">{row.total}</td>
                            <td className={`px-3 py-2 text-right ${row.atribuiveis > 0 ? "text-[hsl(38_92%_50%)] font-medium" : ""}`}>
                              {row.atribuiveis}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {row.tmr != null ? formatMin(row.tmr) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Por motivo</h3>
                  <Badge variant="outline" className="text-[10px]">{vendorReturnsByReason.length}</Badge>
                </div>
                {vendorReturnsByReason.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-6 text-center">Nenhum retorno no período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-medium">Motivo</th>
                          <th className="px-3 py-2 font-medium text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorReturnsByReason.map((row) => (
                          <tr key={row.nome} className="border-t border-border hover:bg-muted/20">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium">{row.nome}</span>
                                {row.atribuivel && (
                                  <Badge className="text-[9px] border-0 text-white" style={{ backgroundColor: "hsl(38 92% 50%)" }}>
                                    atribuível
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-medium">{row.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
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
