import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCSTickets } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS,
  type CSTicketStatus, type CSTicketPrioridade, type CSTicketTipo, type CSTicket,
} from './types';
import { Search, MoreHorizontal, Eye, Edit, Filter, X, AlertTriangle, Building2, User } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface CSTicketListProps {
  onViewTicket: (ticket: CSTicket) => void;
  onEditTicket: (ticket: CSTicket) => void;
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
  baixa: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export function CSTicketList({ onViewTicket, onEditTicket }: CSTicketListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CSTicketStatus | 'all'>('all');
  const [prioridadeFilter, setPrioridadeFilter] = useState<CSTicketPrioridade | 'all'>('all');
  const [tipoFilter, setTipoFilter] = useState<CSTicketTipo | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const { data: tickets, isLoading } = useCSTickets({
    search: search || undefined,
    status: statusFilter !== 'all' ? [statusFilter] : undefined,
    prioridade: prioridadeFilter !== 'all' ? [prioridadeFilter] : undefined,
    tipo: tipoFilter !== 'all' ? [tipoFilter] : undefined,
  });

  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setPrioridadeFilter('all'); setTipoFilter('all'); };
  const hasActiveFilters = search || statusFilter !== 'all' || prioridadeFilter !== 'all' || tipoFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por assunto ou descrição..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Button variant={showFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4 mr-2" />Filtros
          {hasActiveFilters && <Badge variant="secondary" className="ml-2">{[search, statusFilter !== 'all', prioridadeFilter !== 'all', tipoFilter !== 'all'].filter(Boolean).length}</Badge>}
        </Button>
        {hasActiveFilters && <Button variant="ghost" onClick={clearFilters}><X className="h-4 w-4 mr-2" />Limpar</Button>}
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/50">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos</SelectItem>{Object.entries(CS_TICKET_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Prioridade</label>
            <Select value={prioridadeFilter} onValueChange={(v) => setPrioridadeFilter(v as any)}>
              <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas</SelectItem>{Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo</label>
            <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as any)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos</SelectItem>{Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Cliente / Interno</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Próx. Follow-up</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>)}</TableRow>
            )) : tickets?.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Nenhum ticket encontrado</TableCell></TableRow>
            ) : tickets?.map((ticket) => (
              <TableRow key={ticket.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onViewTicket(ticket)}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {ticket.cliente_id ? (<><Building2 className="h-4 w-4 text-muted-foreground" /><span className="font-medium truncate max-w-[150px]">{ticket.cliente?.nome_fantasia || ticket.cliente?.razao_social || '-'}</span></>) : (<><User className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground italic">Interno</span></>)}
                    {ticket.escalado && <AlertTriangle className="h-4 w-4 text-destructive" />}
                  </div>
                </TableCell>
                <TableCell className="max-w-xs truncate font-medium">{ticket.assunto}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{CS_TICKET_TIPO_LABELS[ticket.tipo]}</Badge></TableCell>
                <TableCell><Badge className={PRIORIDADE_COLORS[ticket.prioridade]}>{CS_TICKET_PRIORIDADE_LABELS[ticket.prioridade]}</Badge></TableCell>
                <TableCell><Badge className={STATUS_COLORS[ticket.status]}>{CS_TICKET_STATUS_LABELS[ticket.status]}</Badge></TableCell>
                <TableCell>{ticket.owner?.nome || '-'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{ticket.proximo_followup_em ? format(new Date(ticket.proximo_followup_em), 'dd/MM/yy', { locale: ptBR }) : '-'}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewTicket(ticket); }}><Eye className="h-4 w-4 mr-2" />Visualizar</DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEditTicket(ticket); }}><Edit className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
