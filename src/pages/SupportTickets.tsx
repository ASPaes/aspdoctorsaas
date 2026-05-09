import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCheck, Plus, Search, MessageCircle, Phone, User, Mail, Inbox, Calendar, Clock, Filter, SlidersHorizontal, X, Headphones } from "lucide-react";
import { subDays } from "date-fns";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  agendado: "Agendado",
  em_andamento: "Em andamento",
  aguardando_terceiro: "Aguardando terceiro",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const STATUS_CLASSES: Record<string, string> = {
  aberto: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  agendado: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  em_andamento: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  aguardando_terceiro: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  concluido: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelado: "bg-red-500/10 text-red-400 border-red-500/20 opacity-70",
};


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
  status: string;
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
  const [activeTab, setActiveTab] = useState("tickets");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const queryClient = useQueryClient();

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
    return count;
  }, [produtoFilter, atendenteFilter, categoriaFilter, subcategoriaFilter, canalFilter, serviceTypeFilters]);

  const clearAdvancedFilters = () => {
    setProdutoFilter("all");
    setAtendenteFilter("all");
    setCategoriaFilter("all");
    setSubcategoriaFilter("all");
    setCanalFilter("all");
    setServiceTypeFilters([]);
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
    queryKey: ["support_tickets_list", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), produtoFilter, statusFilter, atendenteFilter, categoriaFilter, canalFilter, subcategoriaFilter, serviceTypeFilters.join(",")],
    enabled: !!tid,
    queryFn: async () => {
      const fromISO = dateRange.from.toISOString();
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      const toISO = toDate.toISOString();

      let q = (supabase.from("support_tickets" as any) as any)
        .select(`
          id, ticket_code, assunto, status, prioridade, canal_origem, tipo_horario,
          aberto_em, concluido_em, agendado_para, parent_ticket_id,
          clientes:cliente_id(nome_fantasia),
          produtos:produto_id(nome),
          service_categories:category_id(nome),
          service_subcategories:subcategory_id(nome),
          service_types:service_type_id(nome)
        `)
        .eq("tenant_id", tid)
        .gte("aberto_em", fromISO)
        .lte("aberto_em", toISO)
        .order("aberto_em", { ascending: false })
        .limit(100);

      if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (atendenteFilter !== "all") q = q.eq("responsavel_user_id", atendenteFilter);
      if (categoriaFilter !== "all") q = q.eq("category_id", categoriaFilter);
      if (canalFilter !== "all") q = q.eq("canal_origem", canalFilter);
      if (subcategoriaFilter !== "all") q = q.eq("subcategory_id", subcategoriaFilter);
      if (serviceTypeFilters.length > 0) q = q.in("service_type_id", serviceTypeFilters);

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
    const abertos = filteredTickets.filter((t: any) => t.status === "aberto").length;
    const concluidos = filteredTickets.filter((t: any) => t.status === "concluido").length;
    const agendados = filteredTickets.filter((t: any) => t.status === "agendado").length;
    const aguardando = filteredTickets.filter((t: any) => t.status === "aguardando_terceiro").length;
    const cancelados = filteredTickets.filter((t: any) => t.status === "cancelado").length;
    return { total, abertos, concluidos, agendados, aguardando, cancelados };
  }, [filteredTickets]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <TicketCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Tickets Suporte</h1>
        </div>
        {activeTab === "tickets" && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Novo ticket
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="tickets" className="gap-2">
            <TicketCheck className="h-4 w-4" />
            Tickets
            <Badge variant="secondary" className="text-xs ml-1">{filteredTickets.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="atendimentos" className="gap-1.5">
            <Headphones className="h-4 w-4" />
            Atendimentos
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pendentes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-2xl font-semibold font-mono mt-0.5">{ticketMetrics.total}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Abertos</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-blue-400">{ticketMetrics.abertos}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Concluídos</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-green-400">{ticketMetrics.concluidos}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Agendados</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-yellow-400">{ticketMetrics.agendados}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Aguardando</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-orange-400">{ticketMetrics.aguardando}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Cancelados</p>
              <p className="text-2xl font-semibold font-mono mt-0.5 text-red-400">{ticketMetrics.cancelados}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou assunto..."
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
                  className={`h-9 gap-1.5 text-sm ${activeFilterCount > 0 ? "border-primary text-primary" : ""}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filtros
                  {activeFilterCount > 0 && (
                    <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full">{activeFilterCount}</Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[460px] p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Produto</label>
                    <Select value={produtoFilter} onValueChange={setProdutoFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os produtos</SelectItem>
                        {produtos.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Atendente</label>
                    <Select value={atendenteFilter} onValueChange={setAtendenteFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {agentes.map((a) => (
                          <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                    <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Subcategoria</label>
                    <Select value={subcategoriaFilter} onValueChange={setSubcategoriaFilter} disabled={categoriaFilter === "all"}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={categoriaFilter === "all" ? "Selecione categoria..." : "Todas"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {filteredSubcategories.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Canal de origem</label>
                    <Select value={canalFilter} onValueChange={setCanalFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
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
                    <label className="text-xs font-medium text-muted-foreground">Tipo de serviço</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full justify-between text-sm font-normal">
                          {serviceTypeFilters.length === 0 ? "Todos" : `${serviceTypeFilters.length} selecionado${serviceTypeFilters.length > 1 ? "s" : ""}`}
                          <Filter className="h-3 w-3 ml-1 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-52 p-2">
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {serviceTypes.map((t) => (
                            <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm">
                              <Checkbox
                                checked={serviceTypeFilters.includes(t.id)}
                                onCheckedChange={(v) => setServiceTypeFilters(prev => v ? [...prev, t.id] : prev.filter(id => id !== t.id))}
                              />
                              {t.nome}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                {activeFilterCount > 0 && (
                  <div className="flex justify-end pt-3 mt-3 border-t">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAdvancedFilters}>
                      Limpar filtros
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground mr-1">Filtros:</span>
              {produtoFilter !== "all" && (
                <button
                  onClick={() => setProdutoFilter("all")}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {getFilterLabel("produto", produtoFilter)}
                  <X className="h-3 w-3" />
                </button>
              )}
              {atendenteFilter !== "all" && (
                <button
                  onClick={() => setAtendenteFilter("all")}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {getFilterLabel("atendente", atendenteFilter)}
                  <X className="h-3 w-3" />
                </button>
              )}
              {categoriaFilter !== "all" && (
                <button
                  onClick={() => { setCategoriaFilter("all"); setSubcategoriaFilter("all"); }}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {getFilterLabel("categoria", categoriaFilter)}
                  <X className="h-3 w-3" />
                </button>
              )}
              {subcategoriaFilter !== "all" && (
                <button
                  onClick={() => setSubcategoriaFilter("all")}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {getFilterLabel("subcategoria", subcategoriaFilter)}
                  <X className="h-3 w-3" />
                </button>
              )}
              {canalFilter !== "all" && (
                <button
                  onClick={() => setCanalFilter("all")}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {getFilterLabel("canal", canalFilter)}
                  <X className="h-3 w-3" />
                </button>
              )}
              {serviceTypeFilters.length > 0 && serviceTypeFilters.map((stId) => {
                const st = serviceTypes.find((t) => t.id === stId);
                return (
                  <button
                    key={stId}
                    onClick={() => setServiceTypeFilters((prev) => prev.filter((id) => id !== stId))}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {st?.nome ?? stId}
                    <X className="h-3 w-3" />
                  </button>
                );
              })}
              <button
                onClick={clearAdvancedFilters}
                className="text-[11px] text-muted-foreground hover:text-foreground ml-1 transition-colors"
              >
                Limpar todos
              </button>
            </div>
          )}

          {isLoading ? (
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
                          <Badge className={`text-[10px] border ${STATUS_CLASSES[t.status] ?? ""}`}>
                            {STATUS_LABELS[t.status] ?? t.status}
                          </Badge>
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
          )}
        </TabsContent>

        <TabsContent value="atendimentos" className="mt-4">
          <AttendancesTab />
        </TabsContent>

        <TabsContent value="pending">
          <PendingClosuresTab />
        </TabsContent>
      </Tabs>

      <CreateSupportTicketModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] });
        }}
      />

      <SupportTicketDetailDialog
        ticketId={selectedTicketId}
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelectedTicketId(null); }}
      />
    </div>
  );
}
