import { useState, useMemo } from 'react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell } from 'recharts';
import { useCSDashboardData, type CSDashboardFilters } from '@/components/cs/hooks/useCSDashboardData';
import { useFuncionariosAtivos } from '@/components/cs/hooks/useCSTickets';
import { CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_INDICACAO_STATUS_LABELS, CS_TICKET_TIPO_LABELS, type CSTicketPrioridade, type CSTicketStatus } from '@/components/cs/types';
import { Clock, AlertTriangle, CheckCircle, Users, Target, DollarSign, BarChart3, List } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CHART_COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
const PRIO_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-muted text-muted-foreground', media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300', urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

function KPICard({ title, value, subtitle, icon, variant = 'default', tvMode = false }: { title: string; value: string | number; subtitle?: string; icon: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger'; tvMode?: boolean }) {
  const bg = { default: 'bg-card', success: 'bg-green-500/5 border-green-500/20', warning: 'bg-orange-500/5 border-orange-500/20', danger: 'bg-red-500/5 border-red-500/20' };
  return (
    <Card className={cn(bg[variant], tvMode ? 'min-h-[120px]' : '')}>
      <CardContent className={cn('pt-4', tvMode && 'pt-6')}>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className={cn('font-medium text-muted-foreground uppercase tracking-wider', tvMode ? 'text-sm' : 'text-xs')}>{title}</p>
            <p className={cn('font-bold', tvMode ? 'text-4xl' : 'text-2xl')}>{value}</p>
            {subtitle && <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>{subtitle}</p>}
          </div>
          <div className={cn('rounded-lg bg-primary/10', tvMode ? 'p-3' : 'p-2')}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface CSTabProps {
  tvMode?: boolean;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
}

export function CSTab({ tvMode = false, periodoInicio, periodoFim }: CSTabProps) {
  const navigate = useNavigate();
  const { data: funcionarios } = useFuncionariosAtivos();
  const [selectedOwner, setSelectedOwner] = useState<string>('__all__');

  const pInicio = periodoInicio || startOfMonth(new Date());
  const pFim = periodoFim || new Date();

  const filters: CSDashboardFilters = useMemo(() => ({
    periodoInicio: pInicio, periodoFim: pFim,
    ownerId: selectedOwner === '__all__' ? undefined : Number(selectedOwner),
  }), [pInicio, pFim, selectedOwner]);

  const { data, isLoading } = useCSDashboardData(filters);

  const evolutionData = useMemo(() => {
    if (!data?.allTickets) return [];
    const months = Array.from({ length: 12 }).map((_, i) => {
      const d = subMonths(new Date(), 11 - i);
      return { month: format(d, 'MMM', { locale: ptBR }), monthFull: format(d, 'MMM yyyy', { locale: ptBR }), yearMonth: format(d, 'yyyy-MM'), value: 0 };
    });
    data.allTickets.forEach(t => {
      if (t.concluido_em) {
        const m = format(new Date(t.concluido_em), 'yyyy-MM');
        const entry = months.find(x => x.yearMonth === m);
        if (entry) entry.value++;
      }
    });
    return months;
  }, [data?.allTickets]);

  if (isLoading) return <div className="grid gap-4 grid-cols-2 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (!data) return null;

  const fmtCur = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;
  const fmtH = (h: number) => h < 24 ? `${h.toFixed(1)}h` : `${Math.floor(h / 24)}d ${(h % 24).toFixed(0)}h`;
  const iconSize = tvMode ? 'h-6 w-6' : 'h-5 w-5';

  const backlogStatusData = Object.entries(data.backlogPorStatus).filter(([s]) => !['concluido', 'cancelado'].includes(s)).map(([s, c]) => ({ name: CS_TICKET_STATUS_LABELS[s as CSTicketStatus], value: c }));
  const backlogPrioData = Object.entries(data.backlogPorPrioridade).map(([p, c], i) => ({ name: CS_TICKET_PRIORIDADE_LABELS[p as CSTicketPrioridade], value: c, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  const pipelineData = Object.entries(data.pipelineIndicacao).map(([s, c], i) => ({ name: CS_INDICACAO_STATUS_LABELS[s as keyof typeof CS_INDICACAO_STATUS_LABELS], value: c, fill: CHART_COLORS[i % CHART_COLORS.length] }));

  return (
    <div className="space-y-6">
      <Card><CardContent className="pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <Select value={selectedOwner} onValueChange={setSelectedOwner}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {funcionarios?.map(f => <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          <div className="pb-0.5">
            <Button variant="outline" size="sm" onClick={() => navigate('/customer-success')}><List className="h-4 w-4 mr-2" />CS Completo</Button>
          </div>
        </div>
      </CardContent></Card>

      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4" />OPERAÇÃO</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <KPICard title="Tickets Abertos" value={data.ticketsAbertos} subtitle="no período" icon={<BarChart3 className={cn(iconSize, 'text-primary')} />} tvMode={tvMode} />
          <KPICard title="Tickets Concluídos" value={data.ticketsFechados} subtitle="no período" icon={<CheckCircle className={cn(iconSize, 'text-green-500')} />} variant="success" tvMode={tvMode} />
          <KPICard title="Vencendo SLA" value={data.vencendoSlaAcao.length + data.vencendoSlaConclusao.length} subtitle="ação + conclusão" icon={<Clock className={cn(iconSize, 'text-orange-500')} />} variant="warning" tvMode={tvMode} />
          <KPICard title="Vencidos SLA" value={data.vencidosSlaAcao.length + data.vencidosSlaConclusao.length} subtitle="ação + conclusão" icon={<AlertTriangle className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode} />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4" />RISCO & RETENÇÃO</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <KPICard title="Clientes em Risco" value={data.clientesEmRisco} icon={<AlertTriangle className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode} />
          <KPICard title="MRR em Risco" value={fmtCur(data.mrrEmRisco)} icon={<DollarSign className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode} />
          <KPICard title="MRR Recuperado" value={fmtCur(data.mrrRecuperado)} subtitle="no período" icon={<DollarSign className={cn(iconSize, 'text-green-500')} />} variant="success" tvMode={tvMode} />
          <KPICard title="% Higiene" value={fmtPct(data.percentHigiene)} icon={<Target className={cn(iconSize, data.percentHigiene >= 80 ? 'text-green-500' : 'text-orange-500')} />} variant={data.percentHigiene >= 80 ? 'success' : 'warning'} tvMode={tvMode} />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><Target className="h-4 w-4" />INDICAÇÕES</h3>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Pipeline de Indicações</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={pipelineData} layout="vertical"><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} /><Bar dataKey="value" radius={[0, 4, 4, 0]}>{pipelineData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Backlog por Status</CardTitle></CardHeader>
          <CardContent><ResponsiveContainer width="100%" height={250}><BarChart data={backlogStatusData} layout="vertical"><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Backlog por Prioridade</CardTitle></CardHeader>
          <CardContent><ResponsiveContainer width="100%" height={250}><BarChart data={backlogPrioData}><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} /><Bar dataKey="value" radius={[4, 4, 0, 0]}>{backlogPrioData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart></ResponsiveContainer></CardContent>
        </Card>
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Evolução: Tickets Concluídos (Últimos 12 Meses)</CardTitle></CardHeader>
        <CardContent><ResponsiveContainer width="100%" height={200}><LineChart data={evolutionData}><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis dataKey="monthFull" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} /><Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }} /></LineChart></ResponsiveContainer></CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-red-500" />Top Prioridades (Urgente/Alta)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Prioridade</TableHead><TableHead>Follow-up</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.topPrioridades.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum ticket urgente ou de alta prioridade 🎉</TableCell></TableRow>
              ) : data.topPrioridades.slice(0, 5).map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.cliente?.nome_fantasia || t.cliente?.razao_social || 'Interno'}</TableCell>
                  <TableCell>{CS_TICKET_TIPO_LABELS[t.tipo]}</TableCell>
                  <TableCell><Badge className={PRIO_COLORS[t.prioridade]}>{CS_TICKET_PRIORIDADE_LABELS[t.prioridade]}</Badge></TableCell>
                  <TableCell>{t.proximo_followup_em ? format(new Date(t.proximo_followup_em), 'dd/MM/yyyy') : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
