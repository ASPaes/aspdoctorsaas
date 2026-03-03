import { useState, useMemo } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker';
import { CSPanel } from '@/components/cs/CSPanel';
import { CSKanban } from '@/components/cs/CSKanban';
import { CSTicketList } from '@/components/cs/CSTicketList';
import { CSDashboard } from '@/components/cs/CSDashboard';
import { CSTicketForm } from '@/components/cs/CSTicketForm';
import { CSTicketDetail } from '@/components/cs/CSTicketDetail';
import { useFuncionariosAtivos } from '@/components/cs/hooks/useCSTickets';
import {
  CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_TICKET_TIPO_LABELS,
  type CSTicket, type CSTicketStatus, type CSTicketPrioridade, type CSTicketTipo,
} from '@/components/cs/types';
import { Plus, LayoutDashboard, Kanban, List, BarChart3, Search, Filter, X } from 'lucide-react';

export interface CSGlobalFilters {
  search: string;
  status: CSTicketStatus | 'all';
  prioridade: CSTicketPrioridade | 'all';
  tipo: CSTicketTipo | 'all';
  periodo: DateRange;
  ownerId: string;
}

const defaultFilters: CSGlobalFilters = {
  search: '',
  status: 'all',
  prioridade: 'all',
  tipo: 'all',
  periodo: { from: startOfMonth(new Date()), to: endOfMonth(new Date()) },
  ownerId: '__all__',
};

export default function CustomerSuccess() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<CSTicket | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view');
  const [showDetail, setShowDetail] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<CSGlobalFilters>(defaultFilters);

  const { data: funcionarios } = useFuncionariosAtivos();

  const handleViewTicket = (ticket: CSTicket) => {
    setSelectedTicket(ticket);
    setDetailMode('view');
    setShowDetail(true);
  };

  const handleEditTicket = (ticket: CSTicket) => {
    setSelectedTicket(ticket);
    setDetailMode('edit');
    setShowDetail(true);
  };

  const clearFilters = () => setFilters(defaultFilters);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.status !== 'all') count++;
    if (filters.prioridade !== 'all') count++;
    if (filters.tipo !== 'all') count++;
    if (filters.ownerId !== '__all__') count++;
    return count;
  }, [filters]);

  const updateFilter = <K extends keyof CSGlobalFilters>(key: K, value: CSGlobalFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customer Success</h1>
          <p className="text-sm text-muted-foreground">Gerencie tickets, acompanhe indicadores e cuide dos seus clientes</p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Ticket
        </Button>
      </div>

      {/* Global Filter Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por assunto ou descrição..."
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="pl-10"
            />
          </div>
          <DateRangePicker
            label=""
            value={filters.periodo}
            onChange={(v) => updateFilter('periodo', v)}
            className="w-64"
          />
          <div className="flex gap-2">
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-2" />Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2">{activeFilterCount}</Badge>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />Limpar
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 border rounded-lg bg-muted/50">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={filters.status} onValueChange={(v) => updateFilter('status', v as any)}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(CS_TICKET_STATUS_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade</label>
              <Select value={filters.prioridade} onValueChange={(v) => updateFilter('prioridade', v as any)}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={filters.tipo} onValueChange={(v) => updateFilter('tipo', v as any)}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Responsável</label>
              <Select value={filters.ownerId} onValueChange={(v) => updateFilter('ownerId', v)}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {funcionarios?.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="painel" className="space-y-4">
        <TabsList>
          <TabsTrigger value="painel" className="gap-1.5"><LayoutDashboard className="h-4 w-4" />Painel</TabsTrigger>
          <TabsTrigger value="kanban" className="gap-1.5"><Kanban className="h-4 w-4" />Kanban</TabsTrigger>
          <TabsTrigger value="lista" className="gap-1.5"><List className="h-4 w-4" />Lista</TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5"><BarChart3 className="h-4 w-4" />Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="painel">
          <CSPanel onViewTicket={handleViewTicket} filters={filters} />
        </TabsContent>

        <TabsContent value="kanban">
          <CSKanban onViewTicket={handleViewTicket} onEditTicket={handleEditTicket} filters={filters} />
        </TabsContent>

        <TabsContent value="lista">
          <CSTicketList onViewTicket={handleViewTicket} onEditTicket={handleEditTicket} filters={filters} />
        </TabsContent>

        <TabsContent value="dashboard">
          <CSDashboard onViewTicket={handleViewTicket} filters={filters} />
        </TabsContent>
      </Tabs>

      <CSTicketForm open={showCreateForm} onOpenChange={setShowCreateForm} />
      <CSTicketDetail ticket={selectedTicket} open={showDetail} onOpenChange={setShowDetail} mode={detailMode} />
    </div>
  );
}
