import { useMemo, useState } from "react";
import { usePortao } from "@/hooks/usePortao";
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
  RotateCcw, TrendingUp, Info, Pause, UserX, HeartCrack,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

import { startOfMonth, endOfMonth } from "date-fns";
import OnboardingSlaOverview from "./OnboardingSlaOverview";
import SituacaoAgoraBand from "./SituacaoAgoraBand";
import KpiCard from "./KpiCard";
import OnboardingDashFilterBar from "./OnboardingDashFilterBar";
import TempoDeEntregaSection from "./TempoDeEntregaSection";
import PermanenciaSection from "./PermanenciaSection";
import { useJourneyNames } from "./useJourneyNames";
import { useOnboardingDashFilters } from "./useOnboardingDashFilters";
import { pct, separarJornadas, contarDeListas, listarSituacao, agregarTreinos, desfechoTreino } from "./dashMetrics";
import type { LinhaJornada } from "./jornadaLinha";

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
  /** Data de negócio do go-live. Só 58 das 125 jornadas concluídas a têm — o
   *  `concluido_em` é o fallback na coorte de permanência. */
  go_live_real: string | null;

  demand_type_nome: string | null;
  demand_type_id: string | null;
  cliente_id: string | null;
  responsavel_user_id: string | null;
  responsavel_nome: string | null;
  ticket_id: string | null;
  implantacao_iniciada_em: string | null;
  implantacao_concluida_em: string | null;
  onboarding_concluido_em: string | null;
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
  titulo: string | null;
  /** Quem/quando encerrou o sub-ticket — vale para cancelado e para desistência. */
  cancelado_em: string | null;
  cancelado_por: string | null;
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
  const podeVerDashboard = usePortao("onb.dashboard");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [desistenciasAbertas, setDesistenciasAbertas] = useState(false);
  /** Drill-down da tabela por tipo: cada número abre a lista de sessões que ele conta. */
  const [drillTreinos, setDrillTreinos] = useState<{ titulo: string; regra: string; linhas: TrainingRow[] } | null>(null);

  const journeysQ = useQuery({
    queryKey: ["onboarding-dash-journeys", effectiveTenantId, viewKey],
    enabled: canAccess && !!effectiveTenantId && unidadeFilterReady,
    queryFn: async () => {
      const rows = await fetchAllRows<JourneyRow>(() => {
        let q = (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, situacao, fase_atual, etapa_semaforo, sla_util_min, sla_corrido_min, cliente_unidade_id, cliente_id, concluido_em, aberta_em, demand_type_nome, demand_type_id, responsavel_user_id, responsavel_nome, ticket_id, implantacao_iniciada_em, implantacao_concluida_em, onboarding_concluido_em, setor_nome, sla_total_corrido_min, sla_total_pausado_min, sla_total_util_min, go_live_real")
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
          .select("id, journey_id, training_type_id, tipo_nome, conta_como_pdv, status, no_show, no_shows, tentativas, proprietario_presente, is_retreinamento, conduzido_por, agendado_para, realizado_em, titulo, cancelado_em, cancelado_por")
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

  /** Quando a jornada foi cancelada. `onboarding_journeys` NÃO guarda esse carimbo —
   *  a única fonte é o evento do ticket. Conferido em 25/08: 22 de 22 canceladas têm
   *  o evento, então a cobertura é total; ainda assim o card conta à parte as que
   *  vierem sem data, para não sumir com jornada em silêncio. */
  const canceladasEmQ = useQuery({
    queryKey: ["onboarding-dash-cancelado-em", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ ticket_id: string; created_at: string }>(() =>
        (supabase.from("support_ticket_events" as any) as any)
          .select("ticket_id, created_at")
          .eq("tenant_id", effectiveTenantId)
          .eq("event_type", "onboarding_cancelado"),
      );
      const m: Record<string, string> = {};
      rows.forEach((r) => {
        // Reabertura + novo cancelamento: vale o mais recente.
        if (!m[r.ticket_id] || r.created_at > m[r.ticket_id]) m[r.ticket_id] = r.created_at;
      });
      return m;
    },
  });

  const journeys = useMemo(() => journeysQ.data ?? [], [journeysQ.data]);

  const dashFilters = useOnboardingDashFilters(journeys, effectiveTenantId, canAccess, trainingsAllQ.data ?? []);

  /** Um mapa só de nomes para os dois blocos que abrem drill-down. */
  const nomes = useJourneyNames(journeys, dashFilters.periodosResponsavel, dashFilters.nomePorUsuario);

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

  /** As jornadas de cada cartão da faixa de situação, em linha inteira — o número
   *  sai desta mesma separação, então a lista do drill-down e o "15" do cartão não
   *  têm como divergir (DEM-0439). */
  const situacao = useMemo(() => {
    const canceladasEm = canceladasEmQ.data ?? {};
    return listarSituacao(
      journeysFiltradas.map((j) => ({
        ...j,
        cancelado_em: j.ticket_id ? (canceladasEm[j.ticket_id] ?? null) : null,
      })),
      dateRange,
    );
  }, [journeysFiltradas, canceladasEmQ.data, dateRange]);

  const contagem = useMemo(() => contarDeListas(situacao), [situacao]);

  /** O nome do cliente e do responsável entram só aqui, na borda da tela: a
   *  aritmética não conhece nome, e o painel não deve conhecer `JourneyRow`. */
  const linhasSituacao = useMemo(() => {
    const linha = (j: JourneyRow & { cancelado_em: string | null }): LinhaJornada => ({
      journeyId: j.journey_id,
      cliente: nomes.cliente(j.journey_id),
      // Dono de HOJE: o cartão conta jornadas, não mede tempo de ninguém.
      responsavel: nomes.responsavel(j.journey_id),
      situacao: j.situacao,
      abertaEm: j.aberta_em,
      fechadaEm: j.situacao === "cancelado" ? j.cancelado_em : j.concluido_em,
    });
    return {
      emAberto: situacao.emAberto.map(linha),
      abertasNoPeriodo: situacao.abertasNoPeriodo.map(linha),
      concluidas: situacao.concluidas.map(linha),
      canceladas: situacao.canceladas.map(linha),
    };
  }, [situacao, nomes]);

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


  // Treinos no período: usa realizado_em quando existe, senão agendado_para.
  // A desistência não tem `realizado_em` e pode nem ter chegado a ser agendada — para
  // ela o que aconteceu no período foi o encerramento.
  const tipoTreinoIds = dashFilters.tipoTreinoIds;
  const trainings = useMemo(() => {
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    return (trainingsAllQ.data ?? []).filter((t) => {
      const ref = t.realizado_em
        || (t.status === "desistencia" ? t.cancelado_em : null)
        || t.agendado_para;
      if (!ref) return false;
      const d = new Date(ref).getTime();
      if (d < from || d > to) return false;
      if (t.journey_id == null || !allowedJourneyIds.has(t.journey_id)) return false;
      // O filtro de tipo recorta a MEDIDA: escolher "Treinamento PDV" e continuar
      // somando as sessões de Estoque da mesma jornada seria responder outra pergunta.
      if (tipoTreinoIds.length > 0) {
        return t.training_type_id != null && tipoTreinoIds.includes(t.training_type_id);
      }
      return true;
    });
  }, [trainingsAllQ.data, dateRange, allowedJourneyIds, tipoTreinoIds]);

  // Resolver nomes via profiles → funcionarios. Entra quem conduziu o treino e também
  // quem encerrou o sub-ticket: a lista de desistências mostra os dois.
  const conduzidoIds = useMemo(
    () => Array.from(new Set(
      trainings.flatMap((t) => [t.conduzido_por, t.cancelado_por]).filter(Boolean),
    )) as string[],
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

  /** Card de treino vira botão só quando tem o que mostrar. */
  const abrirTreinos = (titulo: string, regra: string, linhas: TrainingRow[]) =>
    linhas.length > 0 ? () => setDrillTreinos({ titulo, regra, linhas }) : undefined;

  /** Lista do drill-down de desistências: quem desistiu, de qual treino e quem encerrou.
   *  Mais recente primeiro — é o que o gestor quer ver ao abrir. */
  const desistencias = useMemo(
    () =>
      trainings
        .filter((t) => t.status === "desistencia")
        .sort((a, b) => (b.cancelado_em ?? "").localeCompare(a.cancelado_em ?? "")),
    [trainings],
  );

  /** Faltas do treino. O contador manda; a flag pegajosa cobre o que é anterior ao
   *  backfill de 11/08. Contar falta pelo DESFECHO zeraria as colunas: desde 11/08 o
   *  no-show devolve o treino para `previsto` em vez de parar em `no_show`. */
  function faltasDe(t: { no_shows: number | null; no_show: boolean | null }): number {
    return (t.no_shows ?? 0) > 0 ? (t.no_shows as number) : (t.no_show === true ? 1 : 0);
  }

  // Tabela por implantador. Guarda as SESSÕES, não só o contador — cada número abre a
  // lista do que ele conta, como na tabela por tipo de treino.
  //
  // A coluna No-show é a única que NÃO é o tamanho da sua lista: ela soma as faltas, e o
  // contador sobe a cada remarcação. 14 faltas podem vir de 5 sessões, e é isso que o
  // painel precisa dizer ao abrir.
  const byImplantador = useMemo(() => {
    type Balde = { sessoes: TrainingRow[]; realizado: number; comFalta: TrainingRow[]; faltas: number; retreinos: TrainingRow[] };
    const m: Record<string, Balde> = {};
    trainings.forEach((t) => {
      const id = t.conduzido_por || "__sem__";
      if (!m[id]) m[id] = { sessoes: [], realizado: 0, comFalta: [], faltas: 0, retreinos: [] };
      const d = desfechoTreino(t.status);
      if (d === "cancelado") return; // cancelado não é performance de ninguém
      m[id].sessoes.push(t);
      if (d === "realizado") m[id].realizado += 1;
      const f = faltasDe(t);
      if (f > 0) {
        m[id].comFalta.push(t);
        m[id].faltas += f;
      }
      if (t.is_retreinamento) m[id].retreinos.push(t);
    });
    return Object.entries(m)
      .map(([id, b]) => ({
        id,
        nome: id === "__sem__" ? "Sem implantador" : (names[id] || "—"),
        ...b,
        total: b.sessoes.length,
        no_show: b.faltas,
        retreino: b.retreinos.length,
        pctRealizado: pct(b.realizado, b.sessoes.length),
      }))
      .sort((a, b) => b.total - a.total);
  }, [trainings, names]);

  // Tabela por tipo de treino. Guarda as SESSÕES, não só o contador: cada número da
  // tabela abre a lista do que ele conta.
  //
  // "Em aberto" (ex-"Previstos") não é o total planejado — é o que ainda não teve
  // desfecho. A conta que fecha é `emAberto + realizados + desistências + cancelados
  // = total`, e por isso a coluna Total existe. As FALTAS ficam fora dessa soma: o
  // contador sobe a cada remarcação, então a mesma sessão aparece várias vezes ali e
  // pode ainda acabar realizada — em set/26 foram 37 faltas em 32 sessões do Segundo
  // Treinamento, 2 delas realizadas depois.
  const byTipo = useMemo(() => {
    type Balde = {
      nome: string;
      emAberto: TrainingRow[];
      realizados: TrainingRow[];
      desistencias: TrainingRow[];
      cancelados: TrainingRow[];
      /** Sessões que registraram ao menos uma falta — o número exibido é a soma delas. */
      comFalta: TrainingRow[];
      faltas: number;
    };
    const m: Record<string, Balde> = {};
    trainings.forEach((t) => {
      const key = t.training_type_id || "__sem__";
      const nome = t.tipo_nome || "Sem tipo";
      if (!m[key]) m[key] = { nome, emAberto: [], realizados: [], desistencias: [], cancelados: [], comFalta: [], faltas: 0 };
      switch (desfechoTreino(t.status)) {
        case "em_aberto": m[key].emAberto.push(t); break;
        case "realizado": m[key].realizados.push(t); break;
        case "no_show": m[key].emAberto.push(t); break; // desfecho residual: segue em aberto
        case "desistencia": m[key].desistencias.push(t); break;
        case "cancelado": m[key].cancelados.push(t); break;
      }
      const f = faltasDe(t);
      if (f > 0) {
        m[key].comFalta.push(t);
        m[key].faltas += f;
      }
    });
    return Object.values(m)
      .map((b) => ({
        ...b,
        total: b.emAberto.length + b.realizados.length + b.desistencias.length + b.cancelados.length,
      }))
      .sort((a, b) => b.total - a.total);
  }, [trainings]);


  if (profileLoading || accessLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!canAccess) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso não liberado a este módulo.</div>;
  }
  // O menu esconde o item; isto fecha a URL digitada à mão.
  if (!podeVerDashboard) {
    return <div className="p-6 text-sm text-muted-foreground">Você não tem acesso ao Dashboard de Implantação.</div>;
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

          <SituacaoAgoraBand contagem={contagem} linhas={linhasSituacao} />

          {/* SLA — visão corrido vs. efetivo (total, pipeline, etapa, área) */}
          <OnboardingSlaOverview
            journeys={periodo}
            tenantId={effectiveTenantId}
            nomes={nomes}
            pipelineIds={dashFilters.pipelineIds}
            responsavelIds={dashFilters.responsavelIds}
            recorteResponsavel={dashFilters.recorteResponsavel}
            /* Permanência pós-implantação. Usa `ativas` pelo mesmo motivo do bloco
               abaixo — a coorte é a data de CONCLUSÃO — e ignora o `dateRange` do topo
               de propósito: a janela de coortes é escolhida dentro da própria seção.
               Vive como ABA daqui: fora da aba ativa o Radix desmonta o nó, então a
               query de cancelamentos só sai quando alguém abre a aba. */
            permanencia={
              <PermanenciaSection
                journeys={ativas}
                treinos={trainingsAllQ.data ?? []}
                tenantId={effectiveTenantId}
                nomes={nomes}
                tipoTreinoIds={tipoTreinoIds}
                periodosResponsavel={dashFilters.periodosResponsavel}
                nomePorUsuario={dashFilters.nomePorUsuario}
                recorteResponsavelExato={dashFilters.recorteResponsavelExato}
              />
            }
          />

          {/* Tempo de entrega. Usa `ativas`, não `periodo`: a coorte destes cards é a
              data de CONCLUSÃO, e `periodo` já recortou por sobreposição de abertura —
              com ele, jornada aberta antes da janela e terminada dentro dela sumiria,
              que é exatamente o caso que o card quer contar. */}
          <TempoDeEntregaSection
            journeys={ativas}
            tenantId={effectiveTenantId}
            dateRange={dateRange}
            allowedJourneyIds={allowedJourneyIds}
            nomes={nomes}
            pipelineIds={dashFilters.pipelineIds}
            fasePorPipeline={dashFilters.fasePorPipeline}
            recorteResponsavel={dashFilters.recorteResponsavel}
            recorteResponsavelExato={dashFilters.recorteResponsavelExato}
          />

          {/* KPI Row 1b: PDV + previsto/realizado */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Indicadores Fase 1 · PDV</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={CheckCircle2}
                label="Total PDV finalizados"
                onClick={abrirTreinos(
                  "Total PDV finalizados",
                  "Treinos realizados cujo tipo está marcado como PDV no cadastro.",
                  tr.listas.pdvFinalizados,
                )}
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
                onClick={abrirTreinos(
                  "Treinos realizados",
                  `Sessões concluídas no período. O percentual é sobre os ${tr.validos} válidos.`,
                  tr.listas.realizados,
                )}
                value={`${tr.realizadoPct}%`}
                sub={`${tr.realizado} realiz. / ${tr.validos} válidos`}
                tone={tr.realizadoPct >= 80 ? "success" : tr.realizadoPct >= 60 ? "warning" : "danger"}
                subTone="muted"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Faltas"
                onClick={abrirTreinos(
                  "Sessões com falta",
                  "Sessões que registraram ao menos uma falta. O contador sobe a cada remarcação, então a mesma sessão pode responder por mais de uma — e ainda acabar realizada.",
                  tr.listas.comFalta,
                )}
                value={String(tr.faltas)}
                sub={`${tr.comFalta} ${tr.comFalta === 1 ? "treino faltou" : "treinos faltaram"} ao menos 1x`}
                tone={tr.faltas === 0 ? "success" : "warning"}
                subTone="muted"
              />
              <KpiCard
                icon={RotateCcw}
                label="% Retreinamento"
                onClick={abrirTreinos(
                  "Retreinamentos",
                  `Sessões marcadas como retreinamento. O percentual é sobre os ${tr.validos} válidos.`,
                  tr.listas.retreinos,
                )}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                icon={AlertTriangle}
                label="Taxa de no-show"
                onClick={abrirTreinos(
                  "Sessões com falta",
                  "Sessões que registraram ao menos uma falta. A taxa é sobre as sessões, não sobre o total de faltas.",
                  tr.listas.comFalta,
                )}
                value={`${tr.noShowRate}%`}
                sub={`${tr.comFalta} de ${tr.validos} treinos • meta < 20%`}
                tone={tr.noShowRate < 20 ? "success" : tr.noShowRate < 30 ? "warning" : "danger"}
                subTone={tr.noShowRate < 20 ? "success" : "danger"}
              />
              <KpiCard
                icon={UserCheck}
                label="Proprietário presente"
                onClick={abrirTreinos(
                  "Realizados sem a resposta",
                  "Treinos realizados em que ninguém respondeu se o proprietário estava presente — é o que falta preencher.",
                  tr.listas.semProprietario,
                )}
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
                onClick={abrirTreinos(
                  "Treinos realizados",
                  "Sessões concluídas no período.",
                  tr.listas.realizados,
                )}
                value={String(tr.realizado)}
                sub={`${tr.validos} válidos · ${tr.cancelado} cancelados`}
                tone="info"
              />
              <KpiCard
                icon={HeartCrack}
                label="Desistências"
                value={String(tr.desistencia)}
                sub={
                  tr.desistencia === 0
                    ? "nenhum cliente recusou treinamento no período"
                    : `${tr.desistenciaPct}% dos ${tr.validos} válidos · clique para ver quem`
                }
                tone={tr.desistencia === 0 ? "default" : tr.desistenciaPct < 10 ? "warning" : "danger"}
                subTone={tr.desistencia === 0 ? "muted" : "warning"}
                onClick={tr.desistencia > 0 ? () => setDesistenciasAbertas(true) : undefined}
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
                      <th className="px-3 py-2 font-medium text-right">Em aberto</th>
                      <th className="px-3 py-2 font-medium text-right">Realizados</th>
                      <th className="px-3 py-2 font-medium text-right">Desistência</th>
                      <th className="px-3 py-2 font-medium text-right">Cancelados</th>
                      <th className="px-3 py-2 font-medium text-right text-foreground">Total</th>
                      <th className="px-3 py-2 font-medium text-right">Faltas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byTipo.map((row) => {
                      const cel = (linhas: TrainingRow[], valor: number, classe: string, rotulo: string, regra: string) => (
                        <td className={`px-3 py-2 text-right ${classe}`}>
                          {linhas.length === 0 ? (
                            valor
                          ) : (
                            <button
                              type="button"
                              className="cursor-pointer hover:underline underline-offset-2"
                              onClick={() => setDrillTreinos({ titulo: `${row.nome} · ${rotulo}`, regra, linhas })}
                            >
                              {valor}
                            </button>
                          )}
                        </td>
                      );
                      return (
                        <tr key={row.nome} className="border-t border-border hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">{row.nome}</td>
                          {cel(row.emAberto, row.emAberto.length, "", "em aberto",
                            "Sessões que ainda não tiveram desfecho — inclui as que estão esperando remarcação.")}
                          {cel(row.realizados, row.realizados.length, "text-[hsl(142_71%_45%)] font-medium", "realizados",
                            "Sessões concluídas no período.")}
                          {cel(row.desistencias, row.desistencias.length, row.desistencias.length > 0 ? "text-[hsl(25_95%_53%)] font-medium" : "", "desistências",
                            "O cliente recusou o treinamento e o sub-ticket foi encerrado.")}
                          {cel(row.cancelados, row.cancelados.length, "text-muted-foreground", "cancelados",
                            "Sessões canceladas — não contam como falta do cliente.")}
                          <td className="px-3 py-2 text-right font-semibold">{row.total}</td>
                          {cel(row.comFalta, row.faltas, row.faltas > 0 ? "text-destructive font-medium" : "", "faltas",
                            `${row.faltas} ${row.faltas === 1 ? "falta" : "faltas"} em ${row.comFalta.length} ${row.comFalta.length === 1 ? "sessão" : "sessões"}. O contador sobe a cada remarcação, então a mesma sessão pode aparecer com mais de uma — e ainda acabar realizada.`)}
                        </tr>
                      );
                    })}
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
                    {byImplantador.map((row) => {
                      const celImpl = (linhas: TrainingRow[], valor: number, classe: string, titulo: string, regra: string) => (
                        <td className={`px-3 py-2 text-right ${classe}`}>
                          {linhas.length === 0 ? (
                            valor
                          ) : (
                            <button
                              type="button"
                              className="cursor-pointer hover:underline underline-offset-2"
                              onClick={() => setDrillTreinos({ titulo, regra, linhas })}
                            >
                              {valor}
                            </button>
                          )}
                        </td>
                      );
                      return (
                        <tr key={row.id} className="border-t border-border hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">{row.nome}</td>
                          {celImpl(row.sessoes, row.total, "", `${row.nome} · treinos`,
                            "Sessões conduzidas por esta pessoa no período. Canceladas ficam de fora — não são performance de ninguém.")}
                          {celImpl(row.comFalta, row.no_show, row.no_show > 0 ? "text-destructive font-medium" : "",
                            `${row.nome} · no-show`,
                            `${row.faltas} ${row.faltas === 1 ? "falta" : "faltas"} em ${row.comFalta.length} ${row.comFalta.length === 1 ? "sessão" : "sessões"}. O contador sobe a cada remarcação, então a mesma sessão pode responder por mais de uma.`)}
                          {celImpl(row.retreinos, row.retreino, "", `${row.nome} · retreinos`,
                            "Sessões marcadas como retreinamento.")}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Progress value={row.pctRealizado} className="h-1.5 flex-1" />
                              <span className="text-[10px] text-muted-foreground w-10 text-right">{row.pctRealizado}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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

      {/* Drill-down do card de desistências. Fica fora do bloco de conteúdo para não
          depender do estado de carregamento da página. */}
      <Sheet open={desistenciasAbertas} onOpenChange={setDesistenciasAbertas}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <HeartCrack className="h-4 w-4 text-[hsl(25_95%_53%)]" />
              Desistências no período
            </SheetTitle>
            <SheetDescription className="text-xs">
              Treinamentos que o cliente recusou. {desistencias.length}{" "}
              {desistencias.length === 1 ? "sub-ticket encerrado" : "sub-tickets encerrados"}.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {desistencias.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                Nenhuma desistência no período selecionado.
              </p>
            ) : (
              desistencias.map((d) => (
                <div key={d.id ?? `${d.journey_id}-${d.cancelado_em}`} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium">
                      {d.journey_id ? nomes.cliente(d.journey_id) : "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {d.cancelado_em ? new Date(d.cancelado_em).toLocaleDateString("pt-BR") : "—"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {d.titulo || "Sem título"}
                    {d.tipo_nome ? ` · ${d.tipo_nome}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Encerrado por{" "}
                    <span className="text-foreground">
                      {(d.cancelado_por && names[d.cancelado_por]) || "—"}
                    </span>
                  </p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Drill-down da tabela por tipo de treino. */}
      <Sheet open={drillTreinos != null} onOpenChange={(o) => !o && setDrillTreinos(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">{drillTreinos?.titulo ?? ""}</SheetTitle>
            <SheetDescription className="text-xs">{drillTreinos?.regra ?? ""}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {(drillTreinos?.linhas ?? []).map((t) => {
              const quando = t.realizado_em || t.agendado_para || t.cancelado_em;
              const faltas = faltasDe(t);
              return (
                <div key={t.id ?? `${t.journey_id}-${quando}`} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium">
                      {t.journey_id ? nomes.cliente(t.journey_id) : "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {quando ? new Date(quando).toLocaleDateString("pt-BR") : "sem data"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.titulo || "Sem título"}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t.conduzido_por ? (
                      <>Conduzido por <span className="text-foreground">{names[t.conduzido_por] || "—"}</span></>
                    ) : (
                      "Sem condutor definido"
                    )}
                    {faltas > 0 && (
                      <span className="text-destructive"> · {faltas} {faltas === 1 ? "falta" : "faltas"}</span>
                    )}
                    {t.is_retreinamento && <span> · retreinamento</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
