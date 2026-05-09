import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCheck, Plus, Search, MessageCircle, Phone, User, Mail, Inbox, Calendar, Clock } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PendingClosuresTab } from "@/components/tickets/PendingClosuresTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const PERIOD_DAYS: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
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
  const [period, setPeriod] = useState<string>("30");
  const [produtoFilter, setProdutoFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [atendenteFilter, setAtendenteFilter] = useState<string>("all"); // TODO: implementar filtro por atendente
  const [search, setSearch] = useState<string>("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("tickets");
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

  const cutoffDate = useMemo(() => {
    const days = PERIOD_DAYS[period];
    if (days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [period]);

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

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support_tickets_list", tid, cutoffDate, produtoFilter, statusFilter],
    enabled: !!tid,
    queryFn: async () => {
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
        .order("aberto_em", { ascending: false })
        .limit(100);

      if (cutoffDate) q = q.gte("aberto_em", cutoffDate);
      if (produtoFilter !== "all") q = q.eq("produto_id", Number(produtoFilter));
      if (statusFilter !== "all") q = q.eq("status", statusFilter);

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
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pendentes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="all">Tudo</SelectItem>
              </SelectContent>
            </Select>

            <Select value={produtoFilter} onValueChange={setProdutoFilter}>
              <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Produto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={atendenteFilter} onValueChange={setAtendenteFilter} disabled>
              <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Atendente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os atendentes</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou assunto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 text-sm"
              />
            </div>
          </div>

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
