import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { AttendanceDetailModal } from "@/components/tickets/AttendanceDetailModal";
import { CsatReportModal } from "@/components/tickets/CsatReportModal";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { subDays } from "date-fns";
import {
  Search, Inbox, SlidersHorizontal, X, Clock, MessageCircle, User,
  ChevronLeft, ChevronRight, Headphones, Plus, TicketCheck,
} from "lucide-react";

const PAGE_SIZE = 100;

const STATUS_LABELS: Record<string, string> = {
  waiting: "Aguardando",
  in_progress: "Em andamento",
  closed: "Encerrado",
};
const STATUS_CLASSES: Record<string, string> = {
  waiting: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  in_progress: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  closed: "bg-green-500/10 text-green-400 border-green-500/20",
};
const CLOSURE_LABELS: Record<string, string> = {
  manual: "Manual",
  inactivity_auto: "Inatividade",
  silent: "Silencioso",
};
const CLOSURE_CLASSES: Record<string, string> = {
  manual: "bg-green-500/10 text-green-400 border-green-500/20",
  inactivity_auto: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  silent: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDur(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60 > 0 ? ` ${secs % 60}s` : ""}`;
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
}

interface Props {
  isAdminOrHead?: boolean;
  userId?: string | null;
  departmentFilter?: string;
  agenteFilter?: string;
  embedded?: boolean;
  dateRangeOverride?: { from: Date; to: Date };
  statusFilterOverride?: string;
  closureTypeOverride?: string;
  csatFilterOverride?: string;
  csatScoreFilterOverride?: string;
  ticketFilterOverride?: string;
  sentimentFilterOverride?: string;
  instanceFilterOverride?: string;
}

function AttendancesTab({ isAdminOrHead = true, userId = null, departmentFilter = "all", agenteFilter: parentAgenteFilter = "all", embedded = false, dateRangeOverride, statusFilterOverride, closureTypeOverride, csatFilterOverride, csatScoreFilterOverride, ticketFilterOverride, sentimentFilterOverride, instanceFilterOverride }: Props = {}) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [internalDateRange, setInternalDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 30), to: new Date() });
  const dateRange = dateRangeOverride || internalDateRange;
  const setDateRange = dateRangeOverride ? () => {} : setInternalDateRange;

  const [internalStatusFilter, setInternalStatusFilter] = useState<string>("all");
  const statusFilter = statusFilterOverride || internalStatusFilter;
  const setStatusFilter = statusFilterOverride ? () => {} : setInternalStatusFilter;
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);
  const [atendenteFilter, setAtendenteFilter] = useState<string>("all");
  const [departamentoFilter, setDepartamentoFilter] = useState<string>("all");
  const [closureTypeFilter, setClosureTypeFilter] = useState<string>("all");
  const [csatFilter, setCsatFilter] = useState<string>("all");
  const [csatScoreFilter, setCsatScoreFilter] = useState<string>("all");
  const [ticketFilter, setTicketFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [csatModalOpen, setCsatModalOpen] = useState(false);

  const { data: csatScale } = useQuery({
    queryKey: ["csat-scale-att", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("support_csat_score_max")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return (data?.support_csat_score_max ?? 5) as number;
    },
  });

  useEffect(() => {
    setPage(0);
  }, [dateRange, statusFilter, atendenteFilter, departamentoFilter, closureTypeFilter, csatFilter, csatScoreFilter, ticketFilter, sentimentFilter, instanceFilter, debouncedSearch]);

  const { data: agentes = [] } = useQuery({
    queryKey: ["attendances_agentes", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionarios:funcionario_id(nome)")
        .eq("tenant_id", tid)
        .not("funcionario_id", "is", null);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p: any) => p.funcionarios?.nome)
        .map((p: any) => ({ user_id: p.user_id as string, nome: p.funcionarios.nome as string }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome));
    },
  });

  const { data: departamentos = [] } = useQuery({
    queryKey: ["attendances_departamentos_all", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: instances = [] } = useQuery({
    queryKey: ["attendances_instances", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_instances" as any) as any)
        .select("id, display_name, instance_name")
        .eq("tenant_id", tid)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string | null; instance_name: string }>;
    },
  });

  const effectiveDeptFilter = embedded && departmentFilter !== "all" ? departmentFilter : departamentoFilter;
  const effectiveAgente = embedded && parentAgenteFilter !== "all" ? parentAgenteFilter : atendenteFilter;
  const effectiveClosureType = embedded && closureTypeOverride && closureTypeOverride !== "all" ? closureTypeOverride : closureTypeFilter;
  const effectiveCsatFilter = embedded && csatFilterOverride && csatFilterOverride !== "all" ? csatFilterOverride : csatFilter;
  const effectiveCsatScoreFilter = embedded && csatScoreFilterOverride && csatScoreFilterOverride !== "all" ? csatScoreFilterOverride : csatScoreFilter;
  const effectiveTicketFilter = embedded && ticketFilterOverride && ticketFilterOverride !== "all" ? ticketFilterOverride : ticketFilter;
  const effectiveSentimentFilter = embedded && sentimentFilterOverride && sentimentFilterOverride !== "all" ? sentimentFilterOverride : sentimentFilter;
  const effectiveInstanceFilter = embedded && instanceFilterOverride && instanceFilterOverride !== "all" ? instanceFilterOverride : instanceFilter;

  const fromISO = dateRange.from.toISOString();
  const toDate = new Date(dateRange.to);
  toDate.setHours(23, 59, 59, 999);
  const toISO = toDate.toISOString();

  const { data: metrics } = useQuery({
    queryKey: ["attendance_summary_metrics", tid, fromISO, toISO, statusFilter, effectiveAgente, effectiveDeptFilter, effectiveClosureType, effectiveCsatFilter, effectiveCsatScoreFilter, effectiveTicketFilter, effectiveSentimentFilter, isAdminOrHead, userId],
    enabled: !!tid,
    queryFn: async () => {
      const toEnd = new Date(dateRange.to);
      toEnd.setHours(23, 59, 59, 999);
      const { data, error } = await (supabase.rpc as any)("get_attendance_summary_metrics", {
        p_date_from: dateRange.from.toISOString(),
        p_date_to: toEnd.toISOString(),
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_agent_id: !isAdminOrHead && userId ? userId : (effectiveAgente !== "all" ? effectiveAgente : null),
        p_department_id: effectiveDeptFilter !== "all" ? effectiveDeptFilter : null,
        p_closure_type: effectiveClosureType !== "all" ? effectiveClosureType : null,
        p_tenant_id: tid,
        p_csat_filter: effectiveCsatFilter !== "all" ? effectiveCsatFilter : null,
        p_csat_score: effectiveCsatScoreFilter !== "all" ? parseInt(effectiveCsatScoreFilter) : null,
        p_ticket_filter: effectiveTicketFilter !== "all" ? effectiveTicketFilter : null,
        p_sentiment_filter: effectiveSentimentFilter !== "all" ? effectiveSentimentFilter : null,
      });
      if (error) throw error;
      return data as {
        total: number;
        median_wait_seconds: number;
        median_handle_seconds: number;
        median_first_response_seconds: number;
        avg_csat: number;
        csat_count: number;
        csat_sent_count: number;
        total_closed: number;
        total_open: number;
      };
    },
  });

  const { data: result, isLoading } = useQuery({
    queryKey: ["attendances_list", tid, fromISO, toISO, statusFilter, effectiveAgente, effectiveDeptFilter, effectiveClosureType, effectiveCsatFilter, effectiveCsatScoreFilter, effectiveTicketFilter, effectiveSentimentFilter, effectiveInstanceFilter, page, isAdminOrHead, userId, debouncedSearch],
    enabled: !!tid,
    queryFn: async () => {
      let q = (supabase.from("support_attendances" as any) as any)
        .select(`
          id, attendance_code, status, closure_type, created_from,
          opened_at, assumed_at, closed_at,
          wait_seconds, handle_seconds, first_response_time_seconds,
          msg_customer_count, msg_agent_count, assigned_to,
          ai_summary, ai_category, ticket_id, cliente_id, contact_id, department_id,
          csat_sent, csat_score, last_sentiment,
          contact_name, contact_phone, instance_id,
          whatsapp_contacts:contact_id(name, phone_number),
          clientes:cliente_id(nome_fantasia),
          support_departments:department_id(name)
        `, { count: "exact" })
        .eq("tenant_id", tid)
        .gte("opened_at", fromISO)
        .lte("opened_at", toISO)
        .order("opened_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (effectiveAgente !== "all") q = q.eq("assigned_to", effectiveAgente);
      if (effectiveDeptFilter !== "all") q = q.eq("department_id", effectiveDeptFilter);
      if (effectiveClosureType !== "all") q = q.eq("closure_type", effectiveClosureType);
      if (effectiveCsatFilter === "sent") q = q.eq("csat_sent", true);
      if (effectiveCsatFilter === "not_sent") q = q.eq("csat_sent", false);
      if (effectiveCsatFilter === "answered") q = q.not("csat_score", "is", null);
      if (effectiveCsatFilter === "unanswered") { q = q.eq("csat_sent", true).is("csat_score", null); }
      if (effectiveCsatScoreFilter !== "all") q = q.eq("csat_score", parseInt(effectiveCsatScoreFilter));
      if (effectiveTicketFilter === "with") q = q.not("ticket_id", "is", null);
      if (effectiveTicketFilter === "without") q = q.is("ticket_id", null);
      if (effectiveSentimentFilter !== "all") q = q.eq("last_sentiment", effectiveSentimentFilter);
      if (effectiveInstanceFilter !== "all") q = q.eq("instance_id", effectiveInstanceFilter);
      if (debouncedSearch.trim().length >= 2) {
        const s = debouncedSearch.trim().replace(/[%,()]/g, "");
        q = q.or(`attendance_code.ilike.%${s}%,contact_name.ilike.%${s}%,contact_phone.ilike.%${s}%`);
      }
      if (!isAdminOrHead && userId) q = q.eq("assigned_to", userId);

      const { data, error, count } = await q;
      if (error) throw error;
      return { items: (data ?? []) as any[], total: count ?? 0 };
    },
  });

  const attendances = result?.items ?? [];
  const totalCount = result?.total ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);



  const filtered = attendances;

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (atendenteFilter !== "all") c++;
    if (departamentoFilter !== "all") c++;
    if (closureTypeFilter !== "all") c++;
    if (csatFilter !== "all") c++;
    if (csatScoreFilter !== "all") c++;
    if (ticketFilter !== "all") c++;
    if (sentimentFilter !== "all") c++;
    if (instanceFilter !== "all") c++;
    return c;
  }, [atendenteFilter, departamentoFilter, closureTypeFilter, csatFilter, csatScoreFilter, ticketFilter, sentimentFilter, instanceFilter]);

  const clearAdvancedFilters = () => {
    setAtendenteFilter("all");
    setDepartamentoFilter("all");
    setClosureTypeFilter("all");
    setCsatFilter("all");
    setCsatScoreFilter("all");
    setTicketFilter("all");
    setSentimentFilter("all");
    setInstanceFilter("all");
  };

  const CSAT_FILTER_LABELS: Record<string, string> = {
    sent: "CSAT enviado",
    not_sent: "Sem CSAT",
    answered: "CSAT respondido",
    unanswered: "CSAT não respondido",
  };
  const TICKET_FILTER_LABELS: Record<string, string> = {
    with: "Com ticket",
    without: "Sem ticket",
  };
  const SENTIMENT_FILTER_LABELS: Record<string, string> = {
    positive: "😊 Positivo",
    neutral: "😐 Neutro",
    negative: "😠 Negativo",
  };

  const getFilterLabel = (type: string, value: string): string => {
    if (type === "atendente") return agentes.find((a: any) => a.user_id === value)?.nome ?? value;
    if (type === "departamento") return departamentos.find((d: any) => d.id === value)?.name ?? value;
    if (type === "closure") return CLOSURE_LABELS[value] ?? value;
    if (type === "csat") return CSAT_FILTER_LABELS[value] ?? value;
    if (type === "csatScore") return `Nota CSAT: ⭐${value}`;
    if (type === "ticket") return TICKET_FILTER_LABELS[value] ?? value;
    if (type === "sentiment") return SENTIMENT_FILTER_LABELS[value] ?? value;
    if (type === "instance") {
      const i = instances.find((x: any) => x.id === value);
      return i ? (i.display_name || i.instance_name) : value;
    }
    return value;
  };

  const filtersPopover = (
    <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-3">
        <div className="grid grid-cols-2 gap-3">
          {!embedded && isAdminOrHead && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Atendente</label>
              <Select value={atendenteFilter} onValueChange={setAtendenteFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {agentes.map((a: any) => (
                    <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!embedded && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Departamento</label>
              <Select value={departamentoFilter} onValueChange={setDepartamentoFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {departamentos.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5 col-span-2">
            <label className="text-xs text-muted-foreground">Tipo de encerramento</label>
            <Select value={closureTypeFilter} onValueChange={setClosureTypeFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="inactivity_auto">Inatividade</SelectItem>
                <SelectItem value="silent">Silencioso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">CSAT</label>
            <Select value={csatFilter} onValueChange={setCsatFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="sent">CSAT enviado</SelectItem>
                <SelectItem value="not_sent">Sem envio de CSAT</SelectItem>
                <SelectItem value="answered">CSAT respondido</SelectItem>
                <SelectItem value="unanswered">CSAT não respondido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Nota CSAT</label>
            <Select value={csatScoreFilter} onValueChange={setCsatScoreFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas notas</SelectItem>
                <SelectItem value="1">⭐ 1</SelectItem>
                <SelectItem value="2">⭐ 2</SelectItem>
                <SelectItem value="3">⭐ 3</SelectItem>
                <SelectItem value="4">⭐ 4</SelectItem>
                <SelectItem value="5">⭐ 5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Ticket</label>
            <Select value={ticketFilter} onValueChange={setTicketFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="with">Com ticket</SelectItem>
                <SelectItem value="without">Sem ticket</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Sentimento IA</label>
            <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="positive">😊 Positivo</SelectItem>
                <SelectItem value="neutral">😐 Neutro</SelectItem>
                <SelectItem value="negative">😠 Negativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <div className="flex justify-end mt-3 pt-3 border-t">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAdvancedFilters}>
              Limpar filtros
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  const chipsBlock = activeFilterCount > 0 && (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-muted-foreground">Filtros:</span>
      {!embedded && atendenteFilter !== "all" && (
        <button
          onClick={() => setAtendenteFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("atendente", atendenteFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {!embedded && departamentoFilter !== "all" && (
        <button
          onClick={() => setDepartamentoFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("departamento", departamentoFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {closureTypeFilter !== "all" && (
        <button
          onClick={() => setClosureTypeFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("closure", closureTypeFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {csatFilter !== "all" && (
        <button
          onClick={() => setCsatFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("csat", csatFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {csatScoreFilter !== "all" && (
        <button
          onClick={() => setCsatScoreFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("csatScore", csatScoreFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {ticketFilter !== "all" && (
        <button
          onClick={() => setTicketFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("ticket", ticketFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      {sentimentFilter !== "all" && (
        <button
          onClick={() => setSentimentFilter("all")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          {getFilterLabel("sentiment", sentimentFilter)}
          <X className="h-3 w-3" />
        </button>
      )}
      <button
        onClick={clearAdvancedFilters}
        className="text-[11px] text-muted-foreground hover:text-foreground ml-1 transition-colors"
      >
        Limpar todos
      </button>
    </div>
  );


  return (
    <div className="space-y-3">
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-2xl font-semibold font-mono mt-0.5">{metrics.total}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{metrics.total_closed} encerrados · {metrics.total_open} abertos</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">TME MEDIANA</p>
            <p className="text-2xl font-semibold font-mono mt-0.5">{formatDur(metrics.median_wait_seconds)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Tempo de espera</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">TPR MEDIANA</p>
            <p className="text-2xl font-semibold font-mono mt-0.5">{formatDur(metrics.median_first_response_seconds)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Primeira resposta</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">TMA MEDIANA</p>
            <p className="text-2xl font-semibold font-mono mt-0.5">{formatDur(metrics.median_handle_seconds)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Tempo atendimento</p>
          </div>
          <button type="button" onClick={() => setCsatModalOpen(true)} className="bg-card border border-primary/40 rounded-lg p-3 text-left hover:border-primary/70 transition-colors">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">CSAT médio</p>
            <p className={`text-2xl font-semibold font-mono mt-0.5 ${metrics.avg_csat >= 4 ? "text-green-400" : metrics.avg_csat >= 3 ? "text-yellow-400" : "text-red-400"}`}>
              {metrics.avg_csat > 0 ? metrics.avg_csat : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {metrics.csat_count} avaliações
              {metrics.csat_sent_count > 0 && (
                <span className="ml-1">
                  ({Math.round((metrics.csat_count / metrics.csat_sent_count) * 100)}% resposta)
                </span>
              )}
            </p>
          </button>
        </div>
      )}

      {embedded && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar atendimento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      )}

      {!embedded && (
        <>
          {/* Filtros primários */}
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="waiting">Aguardando</SelectItem>
                <SelectItem value="in_progress">Em andamento</SelectItem>
                <SelectItem value="closed">Encerrado</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por código, contato, telefone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>

            {filtersPopover}
          </div>

          {/* Chips de filtros ativos */}
          {chipsBlock}
        </>
      )}


      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="h-10 w-10 mb-2 opacity-50" />
          <p className="text-sm">Nenhum atendimento encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((att: any) => {
            const agenteName = agentes.find((a: any) => a.user_id === att.assigned_to)?.nome ?? "Não atribuído";
            return (
              <button
                key={att.id}
                onClick={() => { setSelectedId(att.id); setDetailOpen(true); }}
                className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors space-y-1.5"
              >
                {/* Row 1 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-primary font-semibold shrink-0">
                    {att.attendance_code}
                  </span>
                  <span className="text-sm font-medium truncate min-w-0">
                    {att.whatsapp_contacts?.name ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate min-w-0">
                    · {att.clientes?.nome_fantasia ?? "Sem cliente"}
                  </span>
                  <div className="flex-1" />
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_CLASSES[att.status] ?? ""}`}>
                    {STATUS_LABELS[att.status] ?? att.status}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                    {formatDt(att.opened_at)}
                  </span>
                </div>

                {/* Row 2 */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 min-w-0 truncate">
                    <User className="h-3 w-3 shrink-0" />
                    {agenteName}
                  </span>
                  <span className="truncate">· {att.support_departments?.name ?? "—"}</span>
                  {att.status === "closed" && att.closure_type && (
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${CLOSURE_CLASSES[att.closure_type] ?? ""}`}>
                      {CLOSURE_LABELS[att.closure_type] ?? att.closure_type}
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                    <Clock className="h-3 w-3" />
                    TME: {formatDur(att.wait_seconds)}
                  </span>
                  <span className="shrink-0 font-mono">TMA: {formatDur(att.handle_seconds)}</span>
                  {att.status === "closed" && !att.ticket_id && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent("create-ticket-from-attendance", {
                          detail: { attendanceId: att.id, clienteId: att.cliente_id, contactId: att.contact_id, departmentId: att.department_id }
                        }));
                      }}>
                      <Plus className="h-3 w-3" /> Ticket
                    </Button>
                  )}
                  {att.ticket_id && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent("open-ticket", { detail: { ticketId: att.ticket_id } }));
                      }}>
                      <TicketCheck className="h-3 w-3" /> Ver ticket
                    </Button>
                  )}
                </div>

                {/* Row 3 — Resumo IA */}
                {att.ai_summary && (
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    <span className="font-medium">Resumo IA:</span> {att.ai_summary}
                  </div>
                )}

                {/* Row 4 — Contadores */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" />
                    {att.msg_customer_count ?? 0} msgs cliente
                  </span>
                  <span>· {att.msg_agent_count ?? 0} msgs agente</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {page + 1} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AttendanceDetailModal
        attendanceId={selectedId}
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelectedId(null); }}
      />
      <CsatReportModal
        open={csatModalOpen}
        onOpenChange={setCsatModalOpen}
        tenantId={tid}
        dateFrom={dateRange.from}
        dateTo={dateRange.to}
        departmentId={effectiveDeptFilter !== "all" ? effectiveDeptFilter : undefined}
        scoreMax={csatScale ?? 5}
      />
    </div>
  );
}

export { AttendancesTab };
