import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCheck, Plus, Search, MessageCircle, Phone, User, Mail, Inbox, Calendar, Clock, SlidersHorizontal, X, Headphones, LayoutList, LayoutGrid, Bell } from "lucide-react";
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
import { useTenantFilter } from "@/contexts/TenantFilterContext";
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
  clientes: { nome_fantasia: string } | null;
  produtos: { nome: string } | null;
  service_categories: { nome: string } | null;
  service_subcategories: { nome: string } | null;
  service_types: { nome: string } | null;
  ticket_tag_assignments?: Array<{ tag: { id: string; name: string; color: string } | null }>;
}

export default function SupportTickets() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 30), to: new Date() });
  const [produtoFilter, setProdutoFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [atendenteFilter, setAtendenteFilter] = useState<string>("all");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("all");
  const [canalFilter, setCanalFilter] = useState<string>("all");
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
    if (serviceTypeFilters.length > 0) count++;
    if (tagFilters.length > 0) count++;
    return count;
  }, [produtoFilter, atendenteFilter, categoriaFilter, subcategoriaFilter, canalFilter, serviceTypeFilters, tagFilters]);

  const clearAdvancedFilters = () => {
    setProdutoFilter("all");
    setAtendenteFilter("all");
    setCategoriaFilter("all");
    setSubcategoriaFilter("all");
    setCanalFilter("all");
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
      default: return value;
    }
  };

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support_tickets_list", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), produtoFilter, statusFilter, atendenteFilter, categoriaFilter, canalFilter, subcategoriaFilter, serviceTypeFilters.join(","), tagFilters.join(","), departmentFilter, isAdminOrHead, userId],
    enabled: !!tid,
    queryFn: async () => {
      const fromISO = dateRange.from.toISOString();
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      const toISO = toDate.toISOString();

      let q = (supabase.from("support_tickets" as any) as any)
        .select(`
          id, ticket_code, assunto, status_id, prioridade, canal_origem, tipo_horario,
          aberto_em, concluido_em, agendado_para, parent_ticket_id,
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
        .lte("aberto_em", toISO)
        .order("aberto_em", { ascending: false })
        .limit(100);

      // Agente vê apenas seus tickets
      if (!isAdminOrHead && userId) {
        q = q.eq("responsavel_user_id", userId);
      }

      if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
      if (statusFilter !== "all") q = q.eq("status_id", statusFilter);
      if (atendenteFilter !== "all") q = q.eq("responsavel_user_id", atendenteFilter);
      if (categoriaFilter !== "all") q = q.eq("category_id", categoriaFilter);
      if (canalFilter !== "all") q = q.eq("canal_origem", canalFilter);
      if (subcategoriaFilter !== "all") q = q.eq("subcategory_id", subcategoriaFilter);
      if (serviceTypeFilters.length > 0) q = q.in("service_type_id", serviceTypeFilters);
      if (departmentFilter !== "all") q = q.eq("department_id", departmentFilter);

      if (tagFilters.length > 0) {
        const { data: taggedIds } = await (supabase.from("ticket_tag_assignments" as any) as any)
          .select("ticket_id").in("tag_id", tagFilters);
        if (taggedIds && taggedIds.length > 0) {
          q = q.in("id", taggedIds.map((t: any) => t.ticket_id));
        } else {
          return [];
        }
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
  });

  const filteredTickets = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return tickets;
    return tickets.filter(
      (t) =>
        (t.ticket_code ?? "").toLowerCase().includes(s) ||
        (t.assunto ?? "").toLowerCase().includes(s)
    );
  }, [tickets, search]);

  const ticketMetrics = useMemo(() => {
    const total = filteredTickets.length;
    const terminais = filteredTickets.filter((t: any) => getStatusInfo(t.status_id).isTerminal).length;
    const ativos = total - terminais;
    return { total, terminais, ativos };
  }, [filteredTickets, ticketStatuses]);

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
          {isAdminOrHead && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Novo ticket
            </Button>
          )}
        </div>
      </div>

      {/* Setores como pill buttons */}
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
        {supportDepartments.map((dept) => (
          <button
            key={dept.id}
            onClick={() => setDepartmentFilter(dept.id)}
            className={`shrink-0 px-3.5 py-1.5 text-xs rounded-full border transition-colors ${
              departmentFilter === dept.id
                ? "bg-primary/10 text-primary border-primary/30 font-medium"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {dept.name}
          </button>
        ))}
      </div>

      {/* Toolbar: filtros globais + views */}
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
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
                <p className="text-xs text-muted-foreground">Filtros aplicados diretamente nos atendimentos</p>
                <p className="text-xs text-muted-foreground italic">Os filtros de status e tipo de encerramento estão disponíveis dentro da view de atendimentos.</p>
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Nenhum filtro avançado disponível para esta view.
              </div>
            )}
          </PopoverContent>
        </Popover>
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
            <p className="text-2xl font-semibold font-mono mt-0.5">{ticketMetrics.total}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Ativos</p>
            <p className="text-2xl font-semibold font-mono mt-0.5 text-blue-400">{ticketMetrics.ativos}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Finalizados</p>
            <p className="text-2xl font-semibold font-mono mt-0.5 text-green-400">{ticketMetrics.terminais}</p>
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
        return <Comp isAdminOrHead={isAdminOrHead} userId={userId} embedded departmentFilter={departmentFilter} agenteFilter={atendenteFilter} />;
      })()}

      {ticketsView === "pendentes" && isAdminOrHead && (() => {
        const Comp = PendingClosuresTab as any;
        return <Comp embedded departmentFilter={departmentFilter} agenteFilter={atendenteFilter} />;
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
        departmentId={departmentFilter}
        scoreMax={csatScale ?? 5}
      />
    </div>
  );
}
