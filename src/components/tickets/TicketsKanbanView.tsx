import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Calendar, MessageCircle, Phone, User, Mail } from "lucide-react";

interface TicketRow {
  id: string;
  ticket_code: string | null;
  assunto: string | null;
  status: string;
  prioridade: string | null;
  canal_origem: string | null;
  aberto_em: string | null;
  agendado_para: string | null;
  parent_ticket_id: string | null;
  clientes: { nome_fantasia: string } | null;
  produtos: { nome: string } | null;
  service_categories: { nome: string } | null;
  service_subcategories: { nome: string } | null;
  service_types: { nome: string } | null;
}

interface Props {
  tickets: TicketRow[];
  onTicketClick: (ticketId: string) => void;
  onStatusChange: (ticketId: string, newStatus: string) => void;
}

const COLUMNS = [
  { status: "aberto", label: "Aberto", color: "blue" },
  { status: "em_andamento", label: "Em andamento", color: "purple" },
  { status: "agendado", label: "Agendado", color: "yellow" },
  { status: "aguardando_terceiro", label: "Aguardando", color: "orange" },
  { status: "concluido", label: "Concluído", color: "green" },
] as const;

const COLOR_CLASSES: Record<string, { dot: string; badge: string; ring: string }> = {
  blue: { dot: "bg-blue-400", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20", ring: "ring-blue-400/40" },
  purple: { dot: "bg-purple-400", badge: "bg-purple-500/10 text-purple-400 border-purple-500/20", ring: "ring-purple-400/40" },
  yellow: { dot: "bg-yellow-400", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", ring: "ring-yellow-400/40" },
  orange: { dot: "bg-orange-400", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20", ring: "ring-orange-400/40" },
  green: { dot: "bg-green-400", badge: "bg-green-500/10 text-green-400 border-green-500/20", ring: "ring-green-400/40" },
};

function ChannelIcon({ canal }: { canal: string | null }) {
  const cls = "h-3 w-3 text-muted-foreground";
  switch (canal) {
    case "whatsapp": return <MessageCircle className={cls} />;
    case "telefone": return <Phone className={cls} />;
    case "presencial": return <User className={cls} />;
    case "email": return <Mail className={cls} />;
    default: return null;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function TicketsKanbanView({ tickets, onTicketClick, onStatusChange }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const ticketsByStatus = useMemo(() => {
    const map: Record<string, TicketRow[]> = {};
    COLUMNS.forEach(c => { map[c.status] = []; });
    tickets.forEach(t => {
      if (map[t.status]) map[t.status].push(t);
    });
    return map;
  }, [tickets]);

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-row gap-3 min-h-[60vh] pb-2">
        {COLUMNS.map((col) => {
          const columnTickets = ticketsByStatus[col.status] ?? [];
          const colors = COLOR_CLASSES[col.color];
          const isOver = dragOverColumn === col.status;
          return (
            <div
              key={col.status}
              onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.status); }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(e) => {
                e.preventDefault();
                const ticketId = e.dataTransfer.getData("ticketId");
                const fromStatus = e.dataTransfer.getData("fromStatus");
                if (ticketId && fromStatus !== col.status) {
                  onStatusChange(ticketId, col.status);
                }
                setDragOverColumn(null);
              }}
              className={`flex flex-col min-w-[260px] w-[260px] bg-muted/30 border border-border rounded-lg transition-all ${isOver ? `ring-2 ${colors.ring} bg-muted/60` : ""}`}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                <span className="text-xs font-medium">{col.label}</span>
                <Badge variant="outline" className={`ml-auto text-[10px] ${colors.badge}`}>
                  {columnTickets.length}
                </Badge>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
                {columnTickets.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                    Nenhum ticket
                  </div>
                ) : (
                  columnTickets.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("ticketId", t.id);
                        e.dataTransfer.setData("fromStatus", t.status);
                        setDraggingId(t.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => onTicketClick(t.id)}
                      className={`bg-card border border-border rounded-md p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-all ${draggingId === t.id ? "opacity-40 scale-95" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-mono text-[11px] text-primary font-semibold">
                          {t.ticket_code}
                        </span>
                        {t.canal_origem && <ChannelIcon canal={t.canal_origem} />}
                      </div>
                      <p className="text-xs text-foreground line-clamp-2">
                        {t.assunto ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-1">
                        {t.clientes?.nome_fantasia ?? "Sem cliente"}
                      </p>
                      {(t.service_categories?.nome || t.produtos?.nome) && (
                        <p className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
                          {[t.produtos?.nome, t.service_categories?.nome].filter(Boolean).join(" › ")}
                        </p>
                      )}
                      {t.agendado_para && (
                        <div className="inline-flex items-center gap-1 text-[10px] text-yellow-400 mt-1.5">
                          <Calendar className="h-3 w-3" />
                          {formatDate(t.agendado_para)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { TicketsKanbanView };
