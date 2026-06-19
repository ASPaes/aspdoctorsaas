import { useState, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Calendar, MessageCircle, Phone, User, Mail, Lock } from "lucide-react";

interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  position: number;
  is_terminal?: boolean;
}

interface TicketRow {
  id: string;
  ticket_code: string | null;
  assunto: string | null;
  status_id: string | null;
  prioridade: string | null;
  canal_origem: string | null;
  aberto_em: string | null;
  agendado_para: string | null;
  parent_ticket_id: string | null;
  responsavel_user_id: string | null;
  clientes: { nome_fantasia: string } | null;
  produtos: { nome: string } | null;
  service_categories: { nome: string } | null;
  ticket_tag_assignments?: Array<{ tag: { id: string; name: string; color: string } | null }>;
}

interface Props {
  tickets: TicketRow[];
  columns: KanbanColumn[];
  onTicketClick: (ticketId: string) => void;
  onStatusChange: (ticketId: string, newStatusId: string) => void;
  getAgentName?: (uid: string | null) => string;
}

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

function TicketsKanbanView({ tickets, columns, onTicketClick, onStatusChange, getAgentName }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartXRef = useRef(0);
  const panStartScrollLeftRef = useRef(0);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns]
  );

  const ticketsByStatus = useMemo(() => {
    const map: Record<string, TicketRow[]> = {};
    sortedColumns.forEach((c) => { map[c.id] = []; });
    tickets.forEach((t) => {
      if (t.status_id && map[t.status_id]) map[t.status_id].push(t);
    });
    return map;
  }, [tickets, sortedColumns]);

  const stopPanning = () => {
    isPanningRef.current = false;
  };

  return (
    <div
      ref={scrollContainerRef}
      className="overflow-x-auto cursor-grab active:cursor-grabbing select-none"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-ticket-card='true']")) return;
        isPanningRef.current = true;
        panStartXRef.current = e.pageX;
        panStartScrollLeftRef.current = scrollContainerRef.current?.scrollLeft ?? 0;
      }}
      onMouseMove={(e) => {
        if (!isPanningRef.current || !scrollContainerRef.current) return;
        e.preventDefault();
        scrollContainerRef.current.scrollLeft = panStartScrollLeftRef.current - (e.pageX - panStartXRef.current);
      }}
      onMouseUp={stopPanning}
      onMouseLeave={stopPanning}
    >
      <div className="flex flex-row gap-3 min-h-[60vh] pb-2">
        {sortedColumns.map((col) => {
          const columnTickets = ticketsByStatus[col.id] ?? [];
          const isOver = dragOverColumn === col.id;
          return (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.id); }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(e) => {
                e.preventDefault();
                const ticketId = e.dataTransfer.getData("ticketId");
                const fromStatusId = e.dataTransfer.getData("fromStatusId");
                if (ticketId && fromStatusId !== col.id) {
                  onStatusChange(ticketId, col.id);
                }
                setDragOverColumn(null);
              }}
              className={`flex flex-col min-w-[260px] w-[260px] bg-muted/30 border border-border rounded-lg transition-all ${isOver ? "ring-2 bg-muted/60" : ""}`}
              style={isOver ? { boxShadow: `0 0 0 2px ${col.color}66` } : undefined}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: col.color }}
                />
                <span className="text-xs font-medium truncate">{col.name}</span>
                <Badge
                  variant="outline"
                  className="ml-auto text-[10px] border font-semibold"
                  style={{
                    background: col.color,
                    color: getReadableTextColor(col.color),
                    borderColor: col.color,
                  }}
                >
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
                      data-ticket-card="true"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("ticketId", t.id);
                        e.dataTransfer.setData("fromStatusId", t.status_id ?? "");
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
                        {(() => {
                          const col = columns.find(c => c.id === t.status_id);
                          const terminal = col?.is_terminal ?? false;
                          return terminal ? (
                            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                              <Lock className="h-2.5 w-2.5" /> Encerrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/25">
                              <span className="h-1 w-1 rounded-full bg-green-400 animate-pulse" />
                              Aberto
                            </span>
                          );
                        })()}
                      </div>
                      {(() => {
                        const tags = (t.ticket_tag_assignments ?? []).map(a => a.tag).filter(Boolean);
                        if (tags.length === 0) return null;
                        return (
                          <div className="flex items-center gap-1 flex-wrap mb-1">
                            {tags.slice(0, 3).map(tag => (
                              <span key={tag!.id} className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                                style={{ background: tag!.color + "22", color: tag!.color }}>
                                {tag!.name}
                              </span>
                            ))}
                            {tags.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">+{tags.length - 3}</span>
                            )}
                          </div>
                        );
                      })()}
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
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/90 truncate mt-1">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">{getAgentName?.(t.responsavel_user_id) || "Sem responsável"}</span>
                      </div>
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
