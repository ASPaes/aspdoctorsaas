import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CSPanel } from '@/components/cs/CSPanel';
import { CSKanban } from '@/components/cs/CSKanban';
import { CSTicketList } from '@/components/cs/CSTicketList';
import { CSDashboard } from '@/components/cs/CSDashboard';
import { CSTicketForm } from '@/components/cs/CSTicketForm';
import { CSTicketDetail } from '@/components/cs/CSTicketDetail';
import type { CSTicket } from '@/components/cs/types';
import { Plus, LayoutDashboard, Kanban, List, BarChart3 } from 'lucide-react';

export default function CustomerSuccess() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<CSTicket | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view');
  const [showDetail, setShowDetail] = useState(false);

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

      <Tabs defaultValue="painel" className="space-y-4">
        <TabsList>
          <TabsTrigger value="painel" className="gap-1.5"><LayoutDashboard className="h-4 w-4" />Painel</TabsTrigger>
          <TabsTrigger value="kanban" className="gap-1.5"><Kanban className="h-4 w-4" />Kanban</TabsTrigger>
          <TabsTrigger value="lista" className="gap-1.5"><List className="h-4 w-4" />Lista</TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5"><BarChart3 className="h-4 w-4" />Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="painel">
          <CSPanel onViewTicket={handleViewTicket} />
        </TabsContent>

        <TabsContent value="kanban">
          <CSKanban onViewTicket={handleViewTicket} onEditTicket={handleEditTicket} />
        </TabsContent>

        <TabsContent value="lista">
          <CSTicketList onViewTicket={handleViewTicket} onEditTicket={handleEditTicket} />
        </TabsContent>

        <TabsContent value="dashboard">
          <CSDashboard onViewTicket={handleViewTicket} />
        </TabsContent>
      </Tabs>

      <CSTicketForm open={showCreateForm} onOpenChange={setShowCreateForm} />
      <CSTicketDetail ticket={selectedTicket} open={showDetail} onOpenChange={setShowDetail} mode={detailMode} />
    </div>
  );
}
