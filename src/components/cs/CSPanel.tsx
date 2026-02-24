import { useMemo } from 'react';
import { format, isBefore, addDays, parseISO, startOfToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCSTickets } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS,
  CS_TICKET_PRIORIDADE_LABELS,
  type CSTicket,
  type CSTicketPrioridade,
} from './types';
import { AlertTriangle, Clock, Users, Eye, Building2, User, FileWarning } from 'lucide-react';

interface CSPanelProps {
  onViewTicket: (ticket: CSTicket) => void;
}

const PRIORIDADE_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

function TicketMiniCard({ ticket, onClick }: { ticket: CSTicket; onClick: () => void }) {
  const isOverdue = ticket.proximo_followup_em && isBefore(parseISO(ticket.proximo_followup_em), startOfToday());

  return (
    <button onClick={onClick} className="w-full text-left p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {ticket.cliente_id ? <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <span className="text-sm font-medium truncate">
              {ticket.cliente?.nome_fantasia || ticket.cliente?.razao_social || 'Interno'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{ticket.assunto}</p>
        </div>
        <Badge className={`shrink-0 text-[10px] ${PRIORIDADE_COLORS[ticket.prioridade]}`}>
          {CS_TICKET_PRIORIDADE_LABELS[ticket.prioridade]}
        </Badge>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <span>{CS_TICKET_TIPO_LABELS[ticket.tipo]}</span>
        {ticket.proximo_followup_em && (
          <span className={isOverdue ? 'text-destructive font-medium' : ''}>
            {format(parseISO(ticket.proximo_followup_em), 'dd/MM', { locale: ptBR })}
          </span>
        )}
      </div>
    </button>
  );
}

interface PanelBlockProps {
  title: string;
  icon: React.ReactNode;
  tickets: CSTicket[];
  onViewTicket: (ticket: CSTicket) => void;
  variant?: 'default' | 'danger' | 'warning' | 'info';
  emptyMessage?: string;
}

function PanelBlock({ title, icon, tickets, onViewTicket, variant = 'default', emptyMessage = 'Nenhum ticket' }: PanelBlockProps) {
  const borderColors = {
    default: 'border-l-muted-foreground/30',
    danger: 'border-l-destructive',
    warning: 'border-l-orange-500',
    info: 'border-l-blue-500',
  };

  return (
    <Card className={`border-l-4 ${borderColors[variant]}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-auto">{tickets.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
        {tickets.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">{emptyMessage}</p>
        ) : (
          tickets.slice(0, 5).map((ticket) => (
            <TicketMiniCard key={ticket.id} ticket={ticket} onClick={() => onViewTicket(ticket)} />
          ))
        )}
        {tickets.length > 5 && (
          <p className="text-xs text-center text-muted-foreground pt-2">+{tickets.length - 5} mais</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CSPanel({ onViewTicket }: CSPanelProps) {
  const { data: tickets, isLoading } = useCSTickets({
    status: ['aberto', 'em_andamento', 'aguardando_cliente', 'aguardando_interno', 'em_monitoramento'],
  });

  const in3Days = addDays(startOfToday(), 3);

  const categorizedTickets = useMemo(() => {
    if (!tickets) return { criticos: [], vencendoSla: [], aguardandoCliente: [], emMonitoramento: [], internos: [] };

    return {
      criticos: tickets.filter((t) => (t.prioridade === 'urgente' || t.prioridade === 'alta')),
      vencendoSla: tickets.filter((t) => t.proximo_followup_em && isBefore(parseISO(t.proximo_followup_em), in3Days)),
      aguardandoCliente: tickets.filter((t) => t.status === 'aguardando_cliente'),
      emMonitoramento: tickets.filter((t) => t.status === 'em_monitoramento'),
      internos: tickets.filter((t) => !t.cliente_id),
    };
  }, [tickets, in3Days]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-5 w-32" /></CardHeader><CardContent className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="p-2 rounded-full bg-destructive/10"><AlertTriangle className="h-5 w-5 text-destructive" /></div><div><p className="text-2xl font-bold">{categorizedTickets.criticos.length}</p><p className="text-xs text-muted-foreground">Críticos</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="p-2 rounded-full bg-orange-500/10"><Clock className="h-5 w-5 text-orange-500" /></div><div><p className="text-2xl font-bold">{categorizedTickets.vencendoSla.length}</p><p className="text-xs text-muted-foreground">Vencendo SLA</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="p-2 rounded-full bg-purple-500/10"><Users className="h-5 w-5 text-purple-500" /></div><div><p className="text-2xl font-bold">{categorizedTickets.aguardandoCliente.length}</p><p className="text-xs text-muted-foreground">Aguard. Cliente</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="p-2 rounded-full bg-cyan-500/10"><Eye className="h-5 w-5 text-cyan-500" /></div><div><p className="text-2xl font-bold">{categorizedTickets.emMonitoramento.length}</p><p className="text-xs text-muted-foreground">Monitoramento</p></div></div></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PanelBlock title="Críticos (Urgente/Alta)" icon={<AlertTriangle className="h-4 w-4 text-destructive" />} tickets={categorizedTickets.criticos} onViewTicket={onViewTicket} variant="danger" emptyMessage="Nenhum ticket crítico 🎉" />
        <PanelBlock title="Vencendo Follow-up (3 dias)" icon={<Clock className="h-4 w-4 text-orange-500" />} tickets={categorizedTickets.vencendoSla} onViewTicket={onViewTicket} variant="warning" emptyMessage="Nenhum vencendo" />
        <PanelBlock title="Aguardando Cliente" icon={<Users className="h-4 w-4 text-purple-500" />} tickets={categorizedTickets.aguardandoCliente} onViewTicket={onViewTicket} emptyMessage="Nenhum aguardando" />
        <PanelBlock title="Em Monitoramento" icon={<Eye className="h-4 w-4 text-cyan-500" />} tickets={categorizedTickets.emMonitoramento} onViewTicket={onViewTicket} variant="info" emptyMessage="Nenhum em monitoramento" />
        <PanelBlock title="Tickets Internos" icon={<FileWarning className="h-4 w-4 text-muted-foreground" />} tickets={categorizedTickets.internos} onViewTicket={onViewTicket} emptyMessage="Nenhum ticket interno" />
      </div>
    </div>
  );
}
