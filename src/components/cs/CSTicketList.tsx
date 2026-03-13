import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCSTickets, useDeleteCSTicket } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS,
  type CSTicketStatus, type CSTicketPrioridade, type CSTicket,
} from './types';
import type { CSGlobalFilters } from '@/pages/CustomerSuccess';
import { MoreHorizontal, Eye, Edit, AlertTriangle, Building2, User, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface CSTicketListProps {
  onViewTicket: (ticket: CSTicket) => void;
  onEditTicket: (ticket: CSTicket) => void;
  filters: CSGlobalFilters;
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

export function CSTicketList({ onViewTicket, onEditTicket, filters }: CSTicketListProps) {
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const deleteTicket = useDeleteCSTicket();

  const { data: tickets, isLoading } = useCSTickets({
    search: filters.search || undefined,
    status: filters.status !== 'all' ? [filters.status] : undefined,
    prioridade: filters.prioridade !== 'all' ? [filters.prioridade] : undefined,
    tipo: filters.tipo !== 'all' ? [filters.tipo] : undefined,
    owner_id: filters.ownerId !== '__all__' ? Number(filters.ownerId) : undefined,
  });

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Cliente / Interno</TableHead>
                <TableHead className="min-w-[180px]">Assunto</TableHead>
                <TableHead className="whitespace-nowrap">Tipo</TableHead>
                <TableHead className="whitespace-nowrap">Prioridade</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Owner</TableHead>
                <TableHead className="whitespace-nowrap">Próx. Follow-up</TableHead>
                <TableHead className="w-12"></TableHead>
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
                    <div className="flex items-center gap-2 min-w-0">
                      {ticket.cliente_id ? (
                        <>
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{ticket.cliente?.nome_fantasia || ticket.cliente?.razao_social || '-'}</span>
                        </>
                      ) : (
                        <>
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground italic">Interno</span>
                        </>
                      )}
                      {ticket.escalado && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                    </div>
                  </TableCell>
                  <TableCell><p className="font-medium truncate max-w-[260px]">{ticket.assunto}</p></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs whitespace-nowrap shrink-0">{CS_TICKET_TIPO_LABELS[ticket.tipo]}</Badge></TableCell>
                  <TableCell><Badge className={`whitespace-nowrap shrink-0 ${PRIORIDADE_COLORS[ticket.prioridade]}`}>{CS_TICKET_PRIORIDADE_LABELS[ticket.prioridade]}</Badge></TableCell>
                  <TableCell><Badge className={`whitespace-nowrap shrink-0 ${STATUS_COLORS[ticket.status]}`}>{CS_TICKET_STATUS_LABELS[ticket.status]}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{ticket.owner?.nome || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{ticket.proximo_followup_em ? format(new Date(ticket.proximo_followup_em), 'dd/MM/yy', { locale: ptBR }) : '-'}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                       <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewTicket(ticket); }}><Eye className="h-4 w-4 mr-2" />Visualizar</DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEditTicket(ticket); }}><Edit className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTicketId(ticket.id); }}><Trash2 className="h-4 w-4 mr-2" />Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog open={!!deleteTicketId} onOpenChange={(open) => !open && setDeleteTicketId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ticket</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir este ticket? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deleteTicketId) { deleteTicket.mutate(deleteTicketId); setDeleteTicketId(null); } }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
