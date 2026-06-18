import { useState, useMemo, useEffect, useCallback } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCheck, Plus, Search, MessageCircle, Phone, User, Mail, Inbox, Calendar, Clock, SlidersHorizontal, X, Headphones, LayoutList, LayoutGrid, Bell, Building2, Download } from "lucide-react";
import { useClienteSearch } from "@/components/whatsapp/hooks/useClienteSearch";
import { subDays } from "date-fns";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { PendingClosuresTab } from "@/components/tickets/PendingClosuresTab";
import { AttendancesTab } from "@/components/tickets/AttendancesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { SupportTicketDetailDialog } from "@/components/tickets/SupportTicketDetailDialog";
import { CreateSupportTicketModal } from "@/components/tickets/CreateSupportTicketModal";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { TicketsKanbanView } from "@/components/tickets/TicketsKanbanView";
import { CsatReportModal } from "@/components/tickets/CsatReportModal";




function ChannelIcon({ canal }: { canal: string | null }) {
  const cls = "h-4 w-4 text-muted-foreground";
  switch (canal) {
    case "whatsapp": return <MessageCircle className={cls} />;
    case "telefone": return <Phone className={cls} />;
    case "presencial": return <User className={cls} />;
    case "email": return <Mail className={cls} />;
    default: return <MessageCircle className={cls} />;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

interface TicketRow {
  id: string;
  ticket_code: string | null;
  assunto: string | null;
  status_id: string | null;
  prioridade: string | null;
  canal_origem: string | null;
  tipo_horario: string | null;
  aberto_em: string | null;
  concluido_em: string | null;
  agendado_para: string | null;
  parent_ticket_id: string | null;
  horario_inicio: string | null;
  horario_fim: string | null;
  duracao_minutos: number | null;
  responsavel_user_id: string | null;
  clientes: { nome_fantasia: string } | null;
  produtos: { nome: string } | null;
  service_categories: { nome: string } | null;
  service_subcategories: { nome: string } | null;
  service_types: { nome: string } | null;
  ticket_tag_assignments?: Array<{ tag: { id: string; name: string; color: string } | null }>;
}

function SortableDeptPill({ dept, isActive, onClick }: { dept: { id: string; name: string }; isActive: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dept.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`shrink-0 inline-flex items-center gap-1 pl-1 pr-3 py-1.5 text-xs rounded-full border transition-colors ${
        isActive
          ? "bg-primary/10 text-primary border-primary/30 font-medium"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none p-0.5 opacity-50 hover:opacity-100"
        aria-label="Reordenar"
        type="button"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button type="button" onClick={onClick} className="outline-none">
        {dept.name}
      </button>
    </div>
  );
}

export default function SupportTickets() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 30), to: new Date() });
  const [produtoFilter, setProdutoFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [atendenteFilter, setAtendenteFilter] = useState<string>("all");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("all");
  const [canalFilter, setCanalFilter] = useState<string>("all");
  const [tipoHorarioFilter, setTipoHorarioFilter] = useState<string>("all");
  const [subcategoriaFilter, setSubcategoriaFilter] = useState<string>("all");
  const [serviceTypeFilters, setServiceTypeFilters] = useState<string[]>([]);
  const [search, setSearch] = useState<string>("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ticketsView, setTicketsView] = useState<string>("lista");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [csatModalOpen, setCsatModalOpen] = useState(false);
  const [ticketStateFilter, setTicketStateFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recent");
  const [attClosureTypeFilter, setAttClosureTypeFilter] = useState<string>("all");
  const [attCsatFilter, setAttCsatFilter] = useState<string>("all");
  const [attCsatScoreFilter, setAttCsatScoreFilter] = useState<string>("all");
  const [attTicketFilter, setAttTicketFilter] = useState<string>("all");
  const [attSentimentFilter, setAttSentimentFilter] = useState<string>("all");
  const [attInstanceFilter, setAttInstanceFilter] = useState<string>("all");
  const [clienteFilterId, setClienteFilterId] = useState<string | null>(null);
  const [clienteFilterName, setClienteFilterName] = useState<string>("");
  const [clienteSearchTerm, setClienteSearchTerm] = useState<string>("");
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const PAGE_SIZE = 100;
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    dateRange.from, dateRange.to,
    produtoFilter, statusFilter, atendenteFilter, categoriaFilter, subcategoriaFilter,
    canalFilter, tipoHorarioFilter, serviceTypeFilters, departmentFilter, tagFilters,
    clienteFilterId, selectedUnidadeId, ticketStateFilter, sortBy, debouncedSearch,
  ]);
  const { results: clienteSearchResults, isLoading: clienteSearchLoading } = useClienteSearch(clienteSearchTerm);
  const queryClient = useQueryClient();

  const handleKanbanStatusChange = async (ticketId: string, newStatusId: string) => {
    try {
      const { error } = await (supabase.rpc as any)("update_ticket_status", {
        p_ticket_id: ticketId,
        p_new_status_id: newStatusId,
      });
      if (error) throw error;
      toast.success("Status atualizado");
      queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
      queryClient.invalidateQueries({ queryKey: ["support_ticket_detail", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support_ticket_events", ticketId] });
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    }
  };

  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null);
    });
  }, []);

  const { data: profile } = useProfile(userId ?? undefined);
  const isAdminOrHead = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin === true;
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin === true;
  const [attSearchOverride, setAttSearchOverride] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (departmentFilter === "all" && ticketsView === "kanban") {
      setTicketsView("lista");
    }
  }, [departmentFilter]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.ticketId) {
        setSelectedTicketId(detail.ticketId);
        setDetailOpen(true);
      }
    };
    window.addEventListener("open-ticket-detail", handler);
    return () => window.removeEventListener("open-ticket-detail", handler);
  }, []);

  useEffect(() => {
    const handleOpenTicket = (e: any) => {
      setSelectedTicketId(e.detail.ticketId);
      setDetailOpen(true);
    };
    const handleCreateFromAttendance = (_e: any) => {
      setCreateOpen(true);
    };
    window.addEventListener("open-ticket", handleOpenTicket);
    window.addEventListener("create-ticket-from-attendance", handleCreateFromAttendance);
    return () => {
      window.removeEventListener("open-ticket", handleOpenTicket);
      window.removeEventListener("create-ticket-from-attendance", handleCreateFromAttendance);
    };
  }, []);

  const { data: unseenMentions = [], refetch: refetchMentions } = useQuery({
    queryKey: ["unseen_mentions", userId],
    enabled: !!userId,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_mentions" as any) as any)
        .select("id, ticket_id, mentioned_by, created_at, support_tickets:ticket_id(ticket_code, assunto)")
        .eq("mentioned_user_id", userId)
        .is("seen_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; ticket_id: string; mentioned_by: string; created_at: string;
        support_tickets: { ticket_code: string | null; assunto: string | null } | null;
      }>;
    },
  });

  const mentionedByIds = [...new Set(unseenMentions.map(m => m.mentioned_by).filter(Boolean))];
  const { data: mentionerNames = [] } = useQuery({
    queryKey: ["mentioner_names", mentionedByIds.join(",")],
    enabled: mentionedByIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", mentionedByIds);
      if (error) throw error;
      return ((data ?? []) as any[]).map((p: any) => ({
        user_id: p.user_id as string,
        nome: (p.funcionarios?.nome ?? "Agente") as string,
      }));
    },
  });
  const getMentionerName = (uid: string) => mentionerNames.find(m => m.user_id === uid)?.nome ?? "Agente";

  const handleMentionClick = async (mention: any) => {
    try {
      await (supabase.rpc as any)("mark_mention_seen", { p_mention_id: mention.id });
      refetchMentions();
      setSelectedTicketId(mention.ticket_id);
      setDetailOpen(true);
    } catch {}
  };

  const handleMarkAllSeen = async () => {
    try {
      await (supabase.rpc as any)("mark_all_mentions_seen");
      refetchMentions();
      toast.success("Todas as notificações marcadas como vistas");
    } catch {}
  };

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("ticket_mentions_realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "ticket_mentions",
        filter: `mentioned_user_id=eq.${userId}`,
      }, () => {
        refetchMentions();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);



  const { data: produtos = [] } = useQuery({
    queryKey: ["support_tickets_produtos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  const { data: agentes = [] } = useQuery({
    queryKey: ["support_tickets_agentes", tid],
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

  const { data: categories = [] } = useQuery({
    queryKey: ["support_tickets_categories", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_categories" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ["support_tickets_subcategories", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_subcategories" as any) as any)
        .select("id, nome, category_id")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; category_id: string }>;
    },
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["support_tickets_service_types", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_types" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const { data: ticketStatuses = [] } = useQuery({
    queryKey: ["ticket_statuses", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_statuses" as any) as any)
        .select("id, name, slug, color, position, is_initial, is_terminal, is_active, department_id")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; slug: string; color: string; position: number; is_initial: boolean; is_terminal: boolean; is_active: boolean; department_id: string | null }>;
    },
  });

  const { data: supportDepartments = [] } = useQuery({
    queryKey: ["support_departments_list", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name, slug")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .eq("usa_tickets", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; slug: string }>;
    },
  });

  const { data: whatsappInstances = [] } = useQuery({
    queryKey: ["whatsapp_instances_filter", tid],
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

  const DEPT_ORDER_KEY = `dept-order-${tid}-${userId}`;

  const [deptOrder, setDeptOrder] = useState<string[] | null>(null);

  useEffect(() => {
    if (!supportDepartments.length) return;
    try {
      const saved = localStorage.getItem(DEPT_ORDER_KEY);
      if (saved) {
        setDeptOrder(JSON.parse(saved));
      }
    } catch {}
  }, [supportDepartments, DEPT_ORDER_KEY]);

  const orderedDepartmentsFromState = useMemo(() => {
    if (!supportDepartments.length) return [];
    if (!deptOrder) return supportDepartments;
    const deptMap = new Map(supportDepartments.map(d => [d.id, d]));
    const ordered = deptOrder
      .filter(id => deptMap.has(id))
      .map(id => deptMap.get(id)!);
    for (const d of supportDepartments) {
      if (!deptOrder.includes(d.id)) ordered.push(d);
    }
    return ordered;
  }, [supportDepartments, deptOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDeptDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedDepartmentsFromState.findIndex(d => d.id === active.id);
    const newIndex = orderedDepartmentsFromState.findIndex(d => d.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(orderedDepartmentsFromState, oldIndex, newIndex);
    const newOrder = reordered.map(d => d.id);
    setDeptOrder(newOrder);
    localStorage.setItem(DEPT_ORDER_KEY, JSON.stringify(newOrder));
  }, [orderedDepartmentsFromState, DEPT_ORDER_KEY]);

  const selectedDeptSlug = supportDepartments.find(d => d.id === departmentFilter)?.slug;
  const { data: implantacaoMetrics } = useQuery({
    queryKey: ["implantacao_metrics", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), departmentFilter],
    enabled: !!tid && selectedDeptSlug === "implantacao",
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_avg_implantacao_days", {
        p_tenant_id: tid,
        p_date_from: dateRange?.from ? dateRange.from.toISOString().slice(0, 10) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        p_date_to: dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        p_department_id: departmentFilter !== "all" ? departmentFilter : null,
      });
      if (error) throw error;
      return data as { avg_days: number; total_concluidas: number; min_days: number; max_days: number } | null;
    },
  });

  // CSAT: escala do tenant + resumo do período (para o card)
  const { data: csatScale } = useQuery({
    queryKey: ["csat-scale", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("support_csat_score_max")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return (data?.support_csat_score_max ?? 5) as number;
    },
  });

  const { data: csatSummary } = useQuery({
    queryKey: ["csat-card-summary", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), departmentFilter],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_csat_report_summary", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString().slice(0, 10),
        p_date_to: dateRange.to.toISOString().slice(0, 10),
        p_department_id: departmentFilter !== "all" ? departmentFilter : null,
      });
      if (error) throw error;
      return data as { media: number | null; respostas: number; enviadas: number };
    },
  });

  const { data: availableTags = [] } = useQuery({
    queryKey: ["ticket_tags_filter", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_tags" as any) as any)
        .select("id, name, color").eq("tenant_id", tid).eq("is_active", true).order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string }>;
    },
  });

  const filteredStatuses = useMemo(
    () => departmentFilter === "all"
      ? ticketStatuses
      : ticketStatuses.filter((s) => s.department_id === departmentFilter),
    [ticketStatuses, departmentFilter]
  );

  const getStatusInfo = (statusId: string | null) => {
    const s = ticketStatuses.find((x) => x.id === statusId);
    if (!s) return { name: "Sem status", color: "#6b7280", isTerminal: false };
    return { name: s.name, color: s.color, isTerminal: s.is_terminal };
  };

  const filteredSubcategories = useMemo(
    () => categoriaFilter === "all"
      ? subcategories
      : subcategories.filter((s) => s.category_id === categoriaFilter),
    [subcategories, categoriaFilter]
  );

  useEffect(() => {
    setSubcategoriaFilter("all");
  }, [categoriaFilter]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (produtoFilter !== "all") count++;
    if (atendenteFilter !== "all") count++;
    if (categoriaFilter !== "all") count++;
    if (subcategoriaFilter !== "all") count++;
    if (canalFilter !== "all") count++;
    if (tipoHorarioFilter !== "all") count++;
    if (serviceTypeFilters.length > 0) count++;
    if (tagFilters.length > 0) count++;
    if (ticketsView === "atendimentos") {
      if (attClosureTypeFilter !== "all") count++;
      if (attCsatFilter !== "all") count++;
      if (attCsatScoreFilter !== "all") count++;
      if (attTicketFilter !== "all") count++;
      if (attSentimentFilter !== "all") count++;
      if (attInstanceFilter !== "all") count++;
    }
    return count;
  }, [produtoFilter, atendenteFilter, categoriaFilter, subcategoriaFilter, canalFilter, tipoHorarioFilter, serviceTypeFilters, tagFilters, ticketsView, attClosureTypeFilter, attCsatFilter, attCsatScoreFilter, attTicketFilter, attSentimentFilter, attInstanceFilter]);

  const clearAdvancedFilters = () => {
    setProdutoFilter("all");
    setAtendenteFilter("all");
    setCategoriaFilter("all");
    setSubcategoriaFilter("all");
    setCanalFilter("all");
    setTipoHorarioFilter("all");
    setServiceTypeFilters([]);
    setTagFilters([]);
  };

  const getFilterLabel = (type: string, value: string): string => {
    switch (type) {
      case "produto": return produtos.find(p => String(p.id) === value)?.nome ?? value;
      case "atendente": return agentes.find(a => a.user_id === value)?.nome ?? value;
      case "categoria": return categories.find(c => c.id === value)?.nome ?? value;
      case "subcategoria": return filteredSubcategories.find(s => s.id === value)?.nome ?? value;
      case "canal": {
        const labels: Record<string, string> = { whatsapp: "WhatsApp", telefone: "Telefone", presencial: "Presencial", email: "E-mail" };
        return labels[value] ?? value;
      }
      case "tipoHorario": return value === "plantao" ? "Plantão" : "Comercial";
      default: return value;
    }
  };

  const { data: listData = { rows: [] as TicketRow[], total: 0 }, isLoading } = useQuery({
    queryKey: ["support_tickets_list", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), produtoFilter, statusFilter, atendenteFilter, categoriaFilter, canalFilter, tipoHorarioFilter, subcategoriaFilter, serviceTypeFilters.join(","), tagFilters.join(","), departmentFilter, isAdminOrHead, userId, clienteFilterId, selectedUnidadeId, ticketStateFilter, sortBy, debouncedSearch, currentPage, ticketStatuses.map((s) => s.id).join(",")],
    enabled: !!tid,
    queryFn: async () => {
      const fromISO = dateRange.from.toISOString();
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      const toISO = toDate.toISOString();

      const terminalIds = ticketStatuses.filter((s: any) => s.is_terminal).map((s: any) => s.id);
      const openIds = ticketStatuses.filter((s: any) => !s.is_terminal).map((s: any) => s.id);

      let taggedTicketIds: string[] | null = null;
      if (tagFilters.length > 0) {
        const { data: taggedIds } = await (supabase.from("ticket_tag_assignments" as any) as any)
          .select("ticket_id").in("tag_id", tagFilters);
        if (!taggedIds || taggedIds.length === 0) {
          return { rows: [] as TicketRow[], total: 0 };
        }
        taggedTicketIds = taggedIds.map((t: any) => t.ticket_id);
      }

      let q = (supabase.from("support_tickets" as any) as any)
        .select(`
          id, ticket_code, assunto, status_id, prioridade, canal_origem, tipo_horario,
          aberto_em, concluido_em, agendado_para, parent_ticket_id,
          horario_inicio, horario_fim, duracao_minutos, responsavel_user_id,
          clientes:cliente_id(nome_fantasia),
          produtos:produto_id(nome),
          service_categories:category_id(nome),
          service_subcategories:subcategory_id(nome),
          service_types:service_type_id(nome),
          ticket_tag_assignments(tag:tag_id(id, name, color))
        `, { count: "exact" })
        .eq("tenant_id", tid)
        .is("deleted_at", null)
        .gte("aberto_em", fromISO)
        .lte("aberto_em", toISO);

      if (!isAdminOrHead && userId) q = q.eq("responsavel_user_id", userId);
      if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
      if (statusFilter !== "all") q = q.eq("status_id", statusFilter);
      if (atendenteFilter !== "all") q = q.eq("responsavel_user_id", atendenteFilter);
      if (categoriaFilter !== "all") q = q.eq("category_id", categoriaFilter);
      if (canalFilter !== "all") q = q.eq("canal_origem", canalFilter);
      if (tipoHorarioFilter !== "all") q = q.eq("tipo_horario", tipoHorarioFilter);
      if (subcategoriaFilter !== "all") q = q.eq("subcategory_id", subcategoriaFilter);
      if (serviceTypeFilters.length > 0) q = q.in("service_type_id", serviceTypeFilters);
      if (departmentFilter !== "all") q = q.eq("department_id", departmentFilter);
      if (clienteFilterId) q = q.eq("cliente_id", clienteFilterId);
      if (selectedUnidadeId) q = q.eq("unidade_base_id", selectedUnidadeId);
      if (taggedTicketIds) q = q.in("id", taggedTicketIds);

      if (ticketStateFilter === "closed" && terminalIds.length > 0) {
        q = q.in("status_id", terminalIds);
      } else if (ticketStateFilter === "open" && openIds.length > 0) {
        q = q.or(`status_id.in.(${openIds.join(",")}),status_id.is.null`);
      }

      const s = debouncedSearch.trim().replace(/,/g, "");
      if (s) {
        q = q.or(`ticket_code.ilike.*${s}*,assunto.ilike.*${s}*`);
      }

      if (sortBy === "cliente") {
        q = q.order("nome_fantasia", { ascending: true, referencedTable: "clientes" });
      } else if (sortBy === "agenda") {
        q = q.order("agendado_para", { ascending: true, nullsFirst: false });
      } else {
        q = q.order("aberto_em", { ascending: false });
      }

      q = q.range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as TicketRow[], total: count ?? 0 };
    },
  });

  const tickets = listData.rows;

  const { data: counts = { total: 0, ativos: 0, finalizados: 0 } } = useQuery({
    queryKey: ["support_tickets_counts", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), produtoFilter, atendenteFilter, categoriaFilter, subcategoriaFilter, canalFilter, tipoHorarioFilter, serviceTypeFilters.join(","), departmentFilter, tagFilters.join(","), clienteFilterId, selectedUnidadeId, isAdminOrHead, userId, ticketStatuses.map((s) => s.id).join(",")],
    enabled: !!tid,
    queryFn: async () => {
      const fromISO = dateRange.from.toISOString();
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      const toISO = toDate.toISOString();

      const terminalIds = ticketStatuses.filter((s: any) => s.is_terminal).map((s: any) => s.id);

      let taggedTicketIds: string[] | null = null;
      if (tagFilters.length > 0) {
        const { data: taggedIds } = await (supabase.from("ticket_tag_assignments" as any) as any)
          .select("ticket_id").in("tag_id", tagFilters);
        if (!taggedIds || taggedIds.length === 0) {
          return { total: 0, finalizados: 0, ativos: 0 };
        }
        taggedTicketIds = taggedIds.map((t: any) => t.ticket_id);
      }

      const applyFilters = (q: any) => {
        q = q.eq("tenant_id", tid)
          .is("deleted_at", null)
          .gte("aberto_em", fromISO)
          .lte("aberto_em", toISO);
        if (!isAdminOrHead && userId) q = q.eq("responsavel_user_id", userId);
        if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
        if (atendenteFilter !== "all") q = q.eq("responsavel_user_id", atendenteFilter);
        if (categoriaFilter !== "all") q = q.eq("category_id", categoriaFilter);
        if (subcategoriaFilter !== "all") q = q.eq("subcategory_id", subcategoriaFilter);
        if (canalFilter !== "all") q = q.eq("canal_origem", canalFilter);
        if (tipoHorarioFilter !== "all") q = q.eq("tipo_horario", tipoHorarioFilter);
        if (serviceTypeFilters.length > 0) q = q.in("service_type_id", serviceTypeFilters);
        if (departmentFilter !== "all") q = q.eq("department_id", departmentFilter);
        if (clienteFilterId) q = q.eq("cliente_id", clienteFilterId);
        if (selectedUnidadeId) q = q.eq("unidade_base_id", selectedUnidadeId);
        if (taggedTicketIds) q = q.in("id", taggedTicketIds);
        return q;
      };

      const totalQ = applyFilters(
        (supabase.from("support_tickets" as any) as any).select("id", { count: "exact", head: true })
      );
      const { count: countTotal } = await totalQ;

      let countFinalizados = 0;
      if (terminalIds.length > 0) {
        const finQ = applyFilters(
          (supabase.from("support_tickets" as any) as any).select("id", { count: "exact", head: true })
        ).in("status_id", terminalIds);
        const { count } = await finQ;
        countFinalizados = count ?? 0;
      }

      const total = countTotal ?? 0;
      return { total, finalizados: countFinalizados, ativos: total - countFinalizados };
    },
  });

  const filteredTickets = useMemo(() => tickets, [tickets]);

  const ticketMetrics = useMemo(() => {
    const total = filteredTickets.length;
    const terminais = filteredTickets.filter((t: any) => getStatusInfo(t.status_id).isTerminal).length;
    const ativos = total - terminais;
    return { total, terminais, ativos };
  }, [filteredTickets, ticketStatuses]);

  const [exporting, setExporting] = useState(false);

  const fetchAllTicketsForExport = async (): Promise<TicketRow[]> => {
    const fromISO = dateRange.from.toISOString();
    const toDate = new Date(dateRange.to);
    toDate.setHours(23, 59, 59, 999);
    const toISO = toDate.toISOString();

    const terminalIds = ticketStatuses.filter((s: any) => s.is_terminal).map((s: any) => s.id);
    const openIds = ticketStatuses.filter((s: any) => !s.is_terminal).map((s: any) => s.id);

    let taggedTicketIds: string[] | null = null;
    if (tagFilters.length > 0) {
      const { data: taggedIds } = await (supabase.from("ticket_tag_assignments" as any) as any)
        .select("ticket_id").in("tag_id", tagFilters);
      if (!taggedIds || taggedIds.length === 0) return [];
      taggedTicketIds = taggedIds.map((t: any) => t.ticket_id);
    }

    const builder = () => {
      let q = (supabase.from("support_tickets" as any) as any)
        .select(`
          id, ticket_code, assunto, status_id, prioridade, canal_origem, tipo_horario,
          aberto_em, concluido_em, agendado_para, parent_ticket_id,
          horario_inicio, horario_fim, duracao_minutos, responsavel_user_id,
          clientes:cliente_id(nome_fantasia),
          produtos:produto_id(nome),
          service_categories:category_id(nome),
          service_subcategories:subcategory_id(nome),
          service_types:service_type_id(nome),
          ticket_tag_assignments(tag:tag_id(id, name, color))
        `)
        .eq("tenant_id", tid)
        .is("deleted_at", null)
        .gte("aberto_em", fromISO)
        .lte("aberto_em", toISO);

      if (!isAdminOrHead && userId) q = q.eq("responsavel_user_id", userId);
      if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
      if (atendenteFilter !== "all") q = q.eq("responsavel_user_id", atendenteFilter);
      if (categoriaFilter !== "all") q = q.eq("category_id", categoriaFilter);
      if (subcategoriaFilter !== "all") q = q.eq("subcategory_id", subcategoriaFilter);
      if (canalFilter !== "all") q = q.eq("canal_origem", canalFilter);
      if (tipoHorarioFilter !== "all") q = q.eq("tipo_horario", tipoHorarioFilter);
      if (serviceTypeFilters.length > 0) q = q.in("service_type_id", serviceTypeFilters);
      if (departmentFilter !== "all") q = q.eq("department_id", departmentFilter);
      if (clienteFilterId) q = q.eq("cliente_id", clienteFilterId);
      if (selectedUnidadeId) q = q.eq("unidade_base_id", selectedUnidadeId);
      if (taggedTicketIds) q = q.in("id", taggedTicketIds);

      if (ticketStateFilter === "closed" && terminalIds.length > 0) {
        q = q.in("status_id", terminalIds);
      } else if (ticketStateFilter === "open" && openIds.length > 0) {
        q = q.or(`status_id.in.(${openIds.join(",")}),status_id.is.null`);
      }

      const s = search.trim().replace(/,/g, "");
      if (s) {
        q = q.or(`ticket_code.ilike.*${s}*,assunto.ilike.*${s}*`);
      }

      q = q.order("aberto_em", { ascending: false });
      return q;
    };

    return await fetchAllRows<TicketRow>(builder);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllTicketsForExport();
      if (rows.length === 0) {
        toast.info("Nenhum ticket para exportar");
        return;
      }
      await exportTicketsXlsx(rows);
    } catch (e: any) {
      toast.error("Erro ao exportar: " + (e?.message ?? ""));
    } finally {
      setExporting(false);
    }
  };

  const exportTicketsXlsx = async (rows: TicketRow[]) => {
    const XLSX = await import("xlsx");
    const getAgentName = (uid: string | null) => uid ? agentes.find(a => a.user_id === uid)?.nome ?? "" : "";
    const getStatusName = (sid: string | null) => sid ? getStatusInfo(sid).name ?? "" : "";
    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "";
    const fmtDuration = (min: number | null) => {
      if (min == null) return "";
      const h = Math.floor(min / 60);
      const m = min % 60;
      return h > 0 ? `${h}h ${m}min` : `${m}min`;
    };
    const data: Record<string, any>[] = rows.map(t => ({
      "Código": t.ticket_code ?? "",
      "Cliente": t.clientes?.nome_fantasia ?? "",
      "Assunto": t.assunto ?? "",
      "Produto": t.produtos?.nome ?? "",
      "Categoria": t.service_categories?.nome ?? "",
      "Subcategoria": t.service_subcategories?.nome ?? "",
      "Tipo": t.service_types?.nome ?? "",
      "Canal": t.canal_origem ?? "",
      "Tipo Horário": t.tipo_horario === "plantao" ? "Plantão" : "Comercial",
      "Status": getStatusName(t.status_id),
      "Prioridade": t.prioridade ?? "",
      "Responsável": getAgentName(t.responsavel_user_id),
      "Aberto em": fmtDate(t.aberto_em),
      "Concluído em": fmtDate(t.concluido_em),
      "Hr Início Plantão": fmtDate(t.horario_inicio),
      "Hr Fim Plantão": fmtDate(t.horario_fim),
      "Duração (min)": t.duracao_minutos ?? "",
      "Duração Formatada": fmtDuration(t.duracao_minutos),
    }));
    const totalMinutos = rows.reduce((sum, t) => sum + (t.duracao_minutos ?? 0), 0);
    data.push({
      "Código": "", "Cliente": "", "Assunto": "", "Produto": "", "Categoria": "",
      "Subcategoria": "", "Tipo": "", "Canal": "", "Tipo Horário": "", "Status": "",
      "Prioridade": "", "Responsável": `TOTAL (${rows.length} tickets)`,
      "Aberto em": "", "Concluído em": "", "Hr Início Plantão": "", "Hr Fim Plantão": "",
      "Duração (min)": totalMinutos, "Duração Formatada": fmtDuration(totalMinutos),
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tickets");
    const prefix = tipoHorarioFilter === "plantao" ? "plantao" : tipoHorarioFilter === "comercial" ? "comercial" : "tickets";
    XLSX.writeFile(wb, `${prefix}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const Paginador = () => {
    if (!(listData.total > 0)) return null;
    const totalPages = Math.max(1, Math.ceil(listData.total / PAGE_SIZE));
    const x = (currentPage - 1) * PAGE_SIZE + 1;
    const y = Math.min(currentPage * PAGE_SIZE, listData.total);
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-muted-foreground">{x}–{y} de {listData.total}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Anterior</Button>
          <span className="text-sm text-muted-foreground">Página {currentPage} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Próxima</Button>
        </div>
      </div>
    );
  };


  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TicketCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Tickets</h1>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell className="h-4 w-4" />
                {unseenMentions.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-medium animate-pulse">
                    {unseenMentions.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-sm font-medium">Notificações</span>
                {unseenMentions.length > 0 && (
                  <button onClick={handleMarkAllSeen} className="text-[10px] text-muted-foreground hover:text-foreground">
                    Marcar todas como vistas
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {unseenMentions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma notificação</div>
                ) : (
                  unseenMentions.map(m => (
                    <button key={m.id} onClick={() => handleMentionClick(m)}
                      className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {m.support_tickets?.ticket_code ?? "Ticket"} — {m.support_tickets?.assunto ?? "Sem assunto"}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {getMentionerName(m.mentioned_by)} te marcou · {new Date(m.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Novo ticket
          </Button>
        </div>
      </div>

      {/* Setores como pill buttons — drag-and-drop para reordenar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setDepartmentFilter("all")}
          className={`shrink-0 px-3.5 py-1.5 text-xs rounded-full border transition-colors ${
            departmentFilter === "all"
              ? "bg-primary/10 text-primary border-primary/30 font-medium"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Todos
        </button>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDeptDragEnd}>
          <SortableContext items={orderedDepartmentsFromState.map(d => d.id)} strategy={horizontalListSortingStrategy}>
            {orderedDepartmentsFromState.map((dept) => (
              <SortableDeptPill
                key={dept.id}
                dept={dept}
                isActive={departmentFilter === dept.id}
                onClick={() => setDepartmentFilter(dept.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Toolbar: filtros globais + views */}
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

        <Select value={ticketStateFilter} onValueChange={setTicketStateFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="open">Abertos</SelectItem>
            <SelectItem value="closed">Encerrados</SelectItem>
          </SelectContent>
        </Select>
        {ticketsView === "lista" && (
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Mais recentes</SelectItem>
              <SelectItem value="cliente">Cliente (A–Z)</SelectItem>
              <SelectItem value="agenda">Agenda (mais próxima)</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={atendenteFilter} onValueChange={setAtendenteFilter}>
          <SelectTrigger className="h-9 w-[170px] text-sm"><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os agentes</SelectItem>
            {agentes.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-9 gap-1.5 max-w-[220px] ${clienteFilterId ? "border-primary text-primary" : ""}`}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{clienteFilterId ? clienteFilterName : "Cliente"}</span>
              {clienteFilterId && (
                <X
                  className="h-3.5 w-3.5 shrink-0 opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClienteFilterId(null);
                    setClienteFilterName("");
                    setClienteSearchTerm("");
                  }}
                />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[320px] p-2">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Nome, CNPJ, código ou telefone"
                value={clienteSearchTerm}
                onChange={(e) => setClienteSearchTerm(e.target.value)}
                className="h-8 pl-7 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-0.5">
              {clienteSearchLoading && (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center">Buscando...</div>
              )}
              {!clienteSearchLoading && clienteSearchTerm.length < 2 && (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center">Digite ao menos 2 caracteres</div>
              )}
              {!clienteSearchLoading && clienteSearchTerm.length >= 2 && clienteSearchResults.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center">Nenhum cliente encontrado</div>
              )}
              {clienteSearchResults.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClienteFilterId(c.id);
                    setClienteFilterName(c.nome_fantasia || c.razao_social || `#${c.codigo_sequencial}`);
                    setClienteSearchTerm("");
                    setClientePopoverOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors ${clienteFilterId === c.id ? "bg-primary/10 text-primary" : ""}`}
                >
                  <div className="truncate font-medium">
                    {c.codigo_sequencial ? `#${c.codigo_sequencial} ` : ""}{c.nome_fantasia || c.razao_social || "Sem nome"}
                  </div>
                  {c.cnpj && <div className="text-[11px] text-muted-foreground font-mono truncate">{c.cnpj}</div>}
                </button>
              ))}
            </div>
            {clienteFilterId && (
              <button
                type="button"
                onClick={() => {
                  setClienteFilterId(null);
                  setClienteFilterName("");
                  setClienteSearchTerm("");
                  setClientePopoverOpen(false);
                }}
                className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-accent transition-colors"
              >
                Limpar filtro de cliente
              </button>
            )}
          </PopoverContent>
        </Popover>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-9 gap-1.5 ${activeFilterCount > 0 ? "border-primary text-primary" : ""}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
              {activeFilterCount > 0 && (
                <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full">{activeFilterCount}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[460px] p-4">
            {(ticketsView === "lista" || ticketsView === "kanban") ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {filteredStatuses.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Produto</label>
                    <Select value={produtoFilter} onValueChange={setProdutoFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {produtos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                    <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Subcategoria</label>
                    <Select value={subcategoriaFilter} onValueChange={setSubcategoriaFilter} disabled={categoriaFilter === "all"}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={categoriaFilter === "all" ? "Selecione categoria" : "Todas"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {filteredSubcategories.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Canal</label>
                    <Select value={canalFilter} onValueChange={setCanalFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="telefone">Telefone</SelectItem>
                        <SelectItem value="presencial">Presencial</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Tipo horário</label>
                    <Select value={tipoHorarioFilter} onValueChange={setTipoHorarioFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="comercial">Comercial</SelectItem>
                        <SelectItem value="plantao">Plantão</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Tipo serviço</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full justify-between text-sm font-normal">
                          {serviceTypeFilters.length === 0 ? "Todos" : `${serviceTypeFilters.length} selecionado(s)`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-52 p-2">
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {serviceTypes.map(t => (
                            <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm">
                              <Checkbox
                                checked={serviceTypeFilters.includes(t.id)}
                                onCheckedChange={v => setServiceTypeFilters(prev => v ? [...prev, t.id] : prev.filter(id => id !== t.id))}
                              />
                              {t.nome}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t">
                  <label className="text-xs font-medium text-muted-foreground">Tags</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {availableTags.map(tag => {
                      const isActive = tagFilters.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => setTagFilters(prev => isActive ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                          className={`text-[11px] px-2 py-1 rounded-md font-medium transition-all ${isActive ? "ring-1 ring-offset-1 ring-offset-background" : "opacity-60 hover:opacity-100"}`}
                          style={{ background: tag.color + (isActive ? "33" : "15"), color: tag.color }}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                    {availableTags.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma tag cadastrada</p>}
                  </div>
                </div>

                {activeFilterCount > 0 && (
                  <div className="flex justify-end pt-2 border-t">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAdvancedFilters}>Limpar filtros</Button>
                  </div>
                )}
              </div>
            ) : ticketsView === "atendimentos" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Tipo encerramento</label>
                    <Select value={attClosureTypeFilter} onValueChange={setAttClosureTypeFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="inactivity_auto">Inatividade</SelectItem>
                        <SelectItem value="silent">Silencioso</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">CSAT</label>
                    <Select value={attCsatFilter} onValueChange={setAttCsatFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="sent">CSAT enviado</SelectItem>
                        <SelectItem value="not_sent">Sem envio de CSAT</SelectItem>
                        <SelectItem value="answered">CSAT respondido</SelectItem>
                        <SelectItem value="unanswered">CSAT não respondido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Nota CSAT</label>
                    <Select value={attCsatScoreFilter} onValueChange={setAttCsatScoreFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
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
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Ticket</label>
                    <Select value={attTicketFilter} onValueChange={setAttTicketFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="with">Com ticket</SelectItem>
                        <SelectItem value="without">Sem ticket</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Instância</label>
                    <Select value={attInstanceFilter} onValueChange={setAttInstanceFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {whatsappInstances.map((inst: any) => (
                          <SelectItem key={inst.id} value={inst.id}>{inst.display_name || inst.instance_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Sentimento IA</label>
                    <Select value={attSentimentFilter} onValueChange={setAttSentimentFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="positive">😊 Positivo</SelectItem>
                        <SelectItem value="neutral">😐 Neutro</SelectItem>
                        <SelectItem value="negative">😠 Negativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {(attClosureTypeFilter !== "all" || attCsatFilter !== "all" || attCsatScoreFilter !== "all" || attTicketFilter !== "all" || attSentimentFilter !== "all" || attInstanceFilter !== "all") && (
                  <div className="flex justify-end pt-2 border-t">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => {
                      setAttClosureTypeFilter("all");
                      setAttCsatFilter("all");
                      setAttCsatScoreFilter("all");
                      setAttTicketFilter("all");
                      setAttSentimentFilter("all");
                      setAttInstanceFilter("all");
                    }}>Limpar filtros</Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Nenhum filtro avançado disponível para esta view.
              </div>
            )}
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1"
          disabled={exporting || counts.total === 0}
          onClick={handleExport}
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exportando..." : "Exportar"}
        </Button>
        <div className="flex-1" />
        {/* View switcher */}
        <div className="flex items-center border rounded-md overflow-hidden">
          {[
            { id: "lista", label: "Lista", Icon: LayoutList },
            ...(departmentFilter !== "all" ? [{ id: "kanban", label: "Kanban", Icon: LayoutGrid }] : []),
            { id: "atendimentos", label: "Atendimentos - Chats", Icon: Headphones },
            ...(isAdminOrHead ? [{ id: "pendentes", label: "Pendentes", Icon: Clock }] : []),
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setTicketsView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                ticketsView === v.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <v.Icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards contextuais */}
      {(ticketsView === "lista" || ticketsView === "kanban") && (
        <div className={`grid gap-2 ${selectedDeptSlug === "implantacao" ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4"}`}>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-2xl font-semibold font-mono mt-0.5">{counts.total}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Ativos</p>
            <p className="text-2xl font-semibold font-mono mt-0.5 text-blue-400">{counts.ativos}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Finalizados</p>
            <p className="text-2xl font-semibold font-mono mt-0.5 text-green-400">{counts.finalizados}</p>
          </div>
          <button
            onClick={() => setCsatModalOpen(true)}
            className="bg-card border border-primary/40 rounded-lg p-3 text-left hover:border-primary/70 transition-colors"
          >
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">CSAT médio</p>
            <p className="text-2xl font-semibold font-mono mt-0.5 text-yellow-400">
              {csatSummary?.media != null ? csatSummary.media.toLocaleString("pt-BR") : "—"}
              <span className="text-sm font-normal text-muted-foreground"> / {csatScale ?? 5}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {csatSummary?.respostas ?? 0} resposta(s) · clique p/ ver
            </p>
          </button>
          {selectedDeptSlug === "implantacao" && implantacaoMetrics && (
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Tempo médio implantação</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-purple-400">{implantacaoMetrics.avg_days} dias</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{implantacaoMetrics.total_concluidas} concluídas · Min {implantacaoMetrics.min_days}d · Max {implantacaoMetrics.max_days}d</p>
            </div>
          )}
        </div>
      )}

      {/* Chips de filtros ativos */}
      {activeFilterCount > 0 && (ticketsView === "lista" || ticketsView === "kanban") && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground mr-1">Filtros:</span>
          {produtoFilter !== "all" && (
            <button
              onClick={() => setProdutoFilter("all")}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("produto", produtoFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {atendenteFilter !== "all" && (
            <button
              onClick={() => setAtendenteFilter("all")}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("atendente", atendenteFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {categoriaFilter !== "all" && (
            <button
              onClick={() => { setCategoriaFilter("all"); setSubcategoriaFilter("all"); }}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("categoria", categoriaFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {subcategoriaFilter !== "all" && (
            <button
              onClick={() => setSubcategoriaFilter("all")}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("subcategoria", subcategoriaFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {canalFilter !== "all" && (
            <button
              onClick={() => setCanalFilter("all")}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("canal", canalFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {tipoHorarioFilter !== "all" && (
            <button
              onClick={() => setTipoHorarioFilter("all")}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {getFilterLabel("tipoHorario", tipoHorarioFilter)} <X className="h-3 w-3" />
            </button>
          )}
          {serviceTypeFilters.map((stId) => {
            const st = serviceTypes.find((t) => t.id === stId);
            return (
              <button
                key={stId}
                onClick={() => setServiceTypeFilters((prev) => prev.filter((id) => id !== stId))}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {st?.nome ?? stId} <X className="h-3 w-3" />
              </button>
            );
          })}
          {tagFilters.map((tagId) => {
            const tag = availableTags.find((t) => t.id === tagId);
            return tag ? (
              <button
                key={tagId}
                onClick={() => setTagFilters((prev) => prev.filter((id) => id !== tagId))}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{ background: tag.color + "22", color: tag.color }}
              >
                {tag.name} <X className="h-3 w-3" />
              </button>
            ) : null;
          })}
          <button
            onClick={clearAdvancedFilters}
            className="text-[11px] text-muted-foreground hover:text-foreground ml-1 transition-colors"
          >
            Limpar todos
          </button>
        </div>
      )}

      {/* Conteúdo por view */}
      {ticketsView === "lista" && !isLoading && <Paginador />}
      {ticketsView === "lista" && (
        isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">Nenhum ticket encontrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTickets.map((t) => {
              const breadcrumb = [
                t.produtos?.nome,
                t.service_categories?.nome,
                t.service_subcategories?.nome,
              ].filter(Boolean).join(" › ");
              const tipoServico = t.service_types?.nome;

              return (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTicketId(t.id); setDetailOpen(true); }}
                  className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 min-w-[110px]">
                      <p className="font-mono text-sm font-semibold text-primary">{t.ticket_code ?? "—"}</p>
                      {t.parent_ticket_id && (
                        <Badge variant="outline" className="mt-1 text-[10px]">↳ vinculado</Badge>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">
                          {t.clientes?.nome_fantasia ?? "Cliente não vinculado"}
                        </p>
                        {(() => { const si = getStatusInfo(t.status_id); return (
                          <Badge className="text-[10px] border" style={{ background: si.color + "1A", color: si.color, borderColor: si.color + "33" }}>{si.name}</Badge>
                        ); })()}
                        {(() => {
                          const tags = (t.ticket_tag_assignments ?? [])
                            .map(a => a.tag)
                            .filter(Boolean);
                          if (tags.length === 0) return null;
                          return (
                            <div className="flex items-center gap-1 flex-wrap">
                              {tags.map(tag => (
                                <span
                                  key={tag!.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{ background: tag!.color + "22", color: tag!.color }}
                                >
                                  {tag!.name}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {breadcrumb && (
                        <p className="text-xs text-muted-foreground truncate">
                          {breadcrumb}
                          {tipoServico && <span className="text-foreground/70"> · {tipoServico}</span>}
                        </p>
                      )}
                      {t.assunto && (
                        <p className="text-xs text-muted-foreground truncate">{t.assunto}</p>
                      )}
                      {t.agendado_para && (
                        <p className="text-[11px] text-yellow-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Agendado: {formatDate(t.agendado_para)}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <ChannelIcon canal={t.canal_origem} />
                        <span className="text-xs text-muted-foreground">{formatDate(t.aberto_em)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}

      {ticketsView === "lista" && !isLoading && <Paginador />}


      {ticketsView === "kanban" && (
        isLoading ? (
          <div className="flex gap-3 overflow-x-auto">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[60vh] min-w-[260px] w-[260px]" />)}
          </div>
        ) : (
          <TicketsKanbanView
            tickets={filteredTickets}
            columns={filteredStatuses.map(s => ({ id: s.id, name: s.name, color: s.color, position: s.position, is_terminal: s.is_terminal }))}
            onTicketClick={(id) => { setSelectedTicketId(id); setDetailOpen(true); }}
            onStatusChange={handleKanbanStatusChange}
          />
        )
      )}

      {ticketsView === "atendimentos" && (() => {
        const Comp = AttendancesTab as any;
        return <Comp isAdminOrHead={isAdminOrHead} isAdmin={isAdmin} userId={userId} embedded departmentFilter={departmentFilter} agenteFilter={atendenteFilter} dateRangeOverride={dateRange} closureTypeOverride={attClosureTypeFilter} csatFilterOverride={attCsatFilter} csatScoreFilterOverride={attCsatScoreFilter} ticketFilterOverride={attTicketFilter} sentimentFilterOverride={attSentimentFilter} instanceFilterOverride={attInstanceFilter} clienteIdOverride={clienteFilterId} searchOverride={attSearchOverride} />;
      })()}

      {ticketsView === "pendentes" && isAdminOrHead && (() => {
        const Comp = PendingClosuresTab as any;
        return <Comp embedded departmentFilter={departmentFilter} agenteFilter={atendenteFilter} dateRangeOverride={dateRange} />;
      })()}

      <CreateSupportTicketModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDepartmentId={departmentFilter}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
        }}
      />

      <SupportTicketDetailDialog
        ticketId={selectedTicketId}
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelectedTicketId(null); }}
      />

      <CsatReportModal
        open={csatModalOpen}
        onOpenChange={setCsatModalOpen}
        tenantId={tid}
        dateFrom={dateRange.from}
        dateTo={dateRange.to}
        initialDepartmentId={departmentFilter}
        scoreMax={csatScale ?? 5}
        isAdmin={isAdmin}
        onNavigateToAttendance={(code) => {
          setTicketsView("atendimentos");
          setAttSearchOverride(code);
        }}
      />
    </div>
  );
}
