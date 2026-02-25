import { useState, useMemo } from 'react';
import { format, parseISO, isBefore, startOfToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCSTickets, useUpdateCSTicket, useFuncionariosAtivos } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS,
  type CSTicket, type CSTicketStatus, type CSTicketPrioridade,
} from './types';
import { Building2, User, AlertTriangle, Calendar, MoreVertical, Eye, Edit, ArrowRight, Filter, GripVertical } from 'lucide-react';

interface CSKanbanProps {
  onViewTicket: (ticket: CSTicket) => void;
  onEditTicket: (ticket: CSTicket) => void;
}

const KANBAN_COLUMNS: CSTicketStatus[] = ['aberto', 'em_andamento', 'aguardando_cliente', 'aguardando_interno', 'em_monitoramento', 'concluido'];

const COLUMN_COLORS: Record<CSTicketStatus, string> = {
  aberto: 'border-t-blue-500', em_andamento: 'border-t-yellow-500', aguardando_cliente: 'border-t-purple-500',
  aguardando_interno: 'border-t-orange-500', em_monitoramento: 'border-t-cyan-500', concluido: 'border-t-green-500', cancelado: 'border-t-gray-500',
};

const PRIORIDADE_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const PRIORIDADE_BORDER: Record<CSTicketPrioridade, string> = {
  baixa: 'border-l-slate-400', media: 'border-l-blue-400', alta: 'border-l-orange-500', urgente: 'border-l-red-500',
};

function KanbanCard({ ticket, index, onView, onEdit, onChangeStatus }: { ticket: CSTicket; index: number; onView: () => void; onEdit: () => void; onChangeStatus: (s: CSTicketStatus) => void }) {
  const followupDate = ticket.proximo_followup_em ? parseISO(ticket.proximo_followup_em) : null;
  const isOverdue = followupDate && isBefore(followupDate, startOfToday());

  return (
    <Draggable draggableId={ticket.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} className={`group relative p-3 rounded-lg border border-l-4 ${PRIORIDADE_BORDER[ticket.prioridade]} bg-card transition-shadow ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20' : 'hover:shadow-md'}`}>
          <div {...provided.dragHandleProps} className="absolute top-2 left-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-start justify-between gap-2 mb-2 pl-4" onClick={onView}>
            <div className="flex items-center gap-1.5 min-w-0 cursor-pointer">
              {ticket.cliente_id ? <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="text-sm font-medium truncate">{ticket.cliente?.nome_fantasia || ticket.cliente?.razao_social || 'Interno'}</span>
              {ticket.escalado && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"><MoreVertical className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(); }}><Eye className="h-4 w-4 mr-2" /> Ver detalhes</DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}><Edit className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                {KANBAN_COLUMNS.filter(s => s !== ticket.status && s !== 'concluido').map(status => (
                  <DropdownMenuItem key={status} onClick={(e) => { e.stopPropagation(); onChangeStatus(status); }}><ArrowRight className="h-4 w-4 mr-2" /> {CS_TICKET_STATUS_LABELS[status]}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2 pl-4 cursor-pointer" onClick={onView}>{ticket.assunto}</p>
          <div className="flex items-center justify-between gap-2 pl-4">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{CS_TICKET_TIPO_LABELS[ticket.tipo]}</Badge>
            <Badge className={`text-[10px] px-1.5 py-0 ${PRIORIDADE_COLORS[ticket.prioridade]}`}>{CS_TICKET_PRIORIDADE_LABELS[ticket.prioridade]}</Badge>
          </div>
          {followupDate && (
            <div className={`flex items-center gap-1 mt-2 pl-4 text-[10px] ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              <Calendar className="h-3 w-3" />
              <span>{format(followupDate, 'dd/MM', { locale: ptBR })}</span>
              <span className="mx-1">•</span>
              <span className="truncate">{ticket.owner?.nome || '-'}</span>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

export function CSKanban({ onViewTicket, onEditTicket }: CSKanbanProps) {
  const [ownerFilter, setOwnerFilter] = useState<string>('__all__');
  const [prioridadeFilter, setPrioridadeFilter] = useState<string>('__all__');
  const [showConcluidos, setShowConcluidos] = useState(false);

  const queryClient = useQueryClient();
  const { data: funcionarios } = useFuncionariosAtivos();
  const { data: tickets, isLoading } = useCSTickets();
  const updateTicket = useUpdateCSTicket();

  const filteredTickets = useMemo(() => {
    if (!tickets) return [];
    return tickets.filter(ticket => {
      if (ownerFilter !== '__all__' && String(ticket.owner_id) !== ownerFilter) return false;
      if (prioridadeFilter !== '__all__' && ticket.prioridade !== prioridadeFilter) return false;
      if (!showConcluidos && (ticket.status === 'concluido' || ticket.status === 'cancelado')) return false;
      return true;
    });
  }, [tickets, ownerFilter, prioridadeFilter, showConcluidos]);

  const ticketsByStatus = useMemo(() => {
    const grouped: Record<CSTicketStatus, CSTicket[]> = { aberto: [], em_andamento: [], aguardando_cliente: [], aguardando_interno: [], em_monitoramento: [], concluido: [], cancelado: [] };
    filteredTickets.forEach(ticket => { grouped[ticket.status].push(ticket); });
    return grouped;
  }, [filteredTickets]);

  const handleChangeStatus = async (ticketId: string, newStatus: CSTicketStatus, oldStatus?: CSTicketStatus) => {
    const ticket = tickets?.find(t => t.id === ticketId);
    const previousStatus = oldStatus || ticket?.status;

    // Optimistic update
    queryClient.setQueryData(['cs-tickets', undefined], (old: CSTicket[] | undefined) => {
      if (!old) return old;
      return old.map(t => t.id === ticketId ? { ...t, status: newStatus } : t);
    });

    const updates: Record<string, unknown> = { id: ticketId, status: newStatus };

    if (ticket && !ticket.primeira_acao_em && previousStatus === 'aberto') {
      updates.primeira_acao_em = new Date().toISOString();
    }
    if (newStatus === 'concluido' || newStatus === 'cancelado') {
      updates.concluido_em = new Date().toISOString();
    }

    try {
      await updateTicket.mutateAsync(updates as any);

      // Registrar na timeline
      if (previousStatus && previousStatus !== newStatus) {
        await supabase.from('cs_ticket_updates').insert({
          ticket_id: ticketId,
          tipo: 'mudanca_status' as const,
          conteudo: `Status alterado de "${CS_TICKET_STATUS_LABELS[previousStatus]}" para "${CS_TICKET_STATUS_LABELS[newStatus]}"`,
          privado: false,
        });
      }
    } catch {
      queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.destination.droppableId === result.source.droppableId) return;
    const oldStatus = result.source.droppableId as CSTicketStatus;
    const newStatus = result.destination.droppableId as CSTicketStatus;
    await handleChangeStatus(result.draggableId, newStatus, oldStatus);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((status) => (<div key={status} className="flex-shrink-0 w-72"><Skeleton className="h-8 w-full mb-3" /><div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div></div>))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos owners</SelectItem>
            {funcionarios?.map(f => (<SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={prioridadeFilter} onValueChange={setPrioridadeFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([value, label]) => (<SelectItem key={value} value={value}>{label}</SelectItem>))}
          </SelectContent>
        </Select>
        <Button variant={showConcluidos ? 'secondary' : 'outline'} size="sm" onClick={() => setShowConcluidos(!showConcluidos)}>
          {showConcluidos ? 'Ocultar Concluídos' : 'Mostrar Concluídos'}
        </Button>
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.filter(s => showConcluidos || s !== 'concluido').map((status) => (
            <div key={status} className="flex-shrink-0 w-72">
              <Card className={`border-t-4 ${COLUMN_COLORS[status]}`}>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    {CS_TICKET_STATUS_LABELS[status]}
                    <Badge variant="secondary" className="ml-2">{ticketsByStatus[status].length}</Badge>
                  </CardTitle>
                </CardHeader>
                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <CardContent ref={provided.innerRef} {...provided.droppableProps} className={`px-3 pb-3 space-y-2 max-h-[calc(100vh-300px)] min-h-[100px] overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-muted/50' : ''}`}>
                      {ticketsByStatus[status].length === 0 && !snapshot.isDraggingOver ? (
                        <p className="text-xs text-muted-foreground text-center py-6">Nenhum ticket</p>
                      ) : (
                        ticketsByStatus[status].map((ticket, index) => (
                          <KanbanCard key={ticket.id} ticket={ticket} index={index} onView={() => onViewTicket(ticket)} onEdit={() => onEditTicket(ticket)} onChangeStatus={(newStatus) => handleChangeStatus(ticket.id, newStatus)} />
                        ))
                      )}
                      {provided.placeholder}
                    </CardContent>
                  )}
                </Droppable>
              </Card>
            </div>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
