import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCSTickets } from './hooks/useCSTickets';
import { CSTicketForm } from './CSTicketForm';
import { CSTicketDetail } from './CSTicketDetail';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS,
  type CSTicket, type CSTicketStatus, type CSTicketPrioridade,
} from './types';
import { Plus, Ticket, AlertTriangle } from 'lucide-react';

interface ClienteTicketsSectionProps {
  clienteId: string;
  clienteNome: string;
}

const STATUS_COLORS: Record<CSTicketStatus, string> = {
  aberto: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  em_andamento: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  aguardando_cliente: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  aguardando_interno: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  em_monitoramento: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
  concluido: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  cancelado: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const PRIORIDADE_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-slate-100 text-slate-800', media: 'bg-blue-100 text-blue-800',
  alta: 'bg-orange-100 text-orange-800', urgente: 'bg-red-100 text-red-800',
};

export function ClienteTicketsSection({ clienteId, clienteNome }: ClienteTicketsSectionProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<CSTicket | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const { data: tickets, isLoading } = useCSTickets({ cliente_id: clienteId });

  const openTickets = tickets?.filter(t => t.status !== 'concluido' && t.status !== 'cancelado') || [];
  const closedTickets = tickets?.filter(t => t.status === 'concluido' || t.status === 'cancelado').slice(0, 3) || [];

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Ticket className="h-4 w-4" />Tickets CS
              {openTickets.length > 0 && <Badge variant="secondary">{openTickets.length} aberto(s)</Badge>}
            </CardTitle>
            <Button size="sm" onClick={() => setShowCreateForm(true)}><Plus className="h-4 w-4 mr-1" />Novo Ticket</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> :
            openTickets.length === 0 && closedTickets.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Nenhum ticket registrado</p> : (
              <>
                {openTickets.map(ticket => (
                  <button key={ticket.id} onClick={() => { setSelectedTicket(ticket); setShowDetail(true); }} className="w-full text-left p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{ticket.assunto}</span>
                        {ticket.escalado && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      </div>
                      <Badge className={`text-xs ${PRIORIDADE_COLORS[ticket.prioridade]}`}>{CS_TICKET_PRIORIDADE_LABELS[ticket.prioridade]}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{CS_TICKET_TIPO_LABELS[ticket.tipo]}</Badge>
                      <Badge className={`text-[10px] ${STATUS_COLORS[ticket.status]}`}>{CS_TICKET_STATUS_LABELS[ticket.status]}</Badge>
                      {ticket.proximo_followup_em && <span className="ml-auto">Follow-up: {format(new Date(ticket.proximo_followup_em), 'dd/MM', { locale: ptBR })}</span>}
                    </div>
                  </button>
                ))}
                {closedTickets.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Últimos concluídos:</p>
                    {closedTickets.map(ticket => (
                      <button key={ticket.id} onClick={() => { setSelectedTicket(ticket); setShowDetail(true); }} className="w-full text-left p-2 text-sm text-muted-foreground hover:bg-accent/30 rounded">
                        {ticket.assunto} • {format(new Date(ticket.concluido_em || ticket.atualizado_em), 'dd/MM/yy', { locale: ptBR })}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
        </CardContent>
      </Card>
      <CSTicketForm open={showCreateForm} onOpenChange={setShowCreateForm} clienteId={clienteId} clienteNome={clienteNome} />
      <CSTicketDetail ticket={selectedTicket} open={showDetail} onOpenChange={setShowDetail} mode="view" />
    </>
  );
}
