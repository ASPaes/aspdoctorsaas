import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useFuncionariosAtivos } from './hooks/useCSTickets';
import { useCSDashboardData, type CSDashboardFilters } from './hooks/useCSDashboardData';
import { DateRangePicker, DateRange } from '@/components/ui/date-range-picker';
import {
  CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_INDICACAO_STATUS_LABELS, CS_TICKET_TIPO_LABELS,
  type CSTicket, type CSTicketPrioridade,
} from './types';
import { TrendingUp, TrendingDown, Clock, AlertTriangle, CheckCircle, Users, Target, DollarSign, BarChart3, RefreshCw, Building2, User } from 'lucide-react';

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const PRIORIDADE_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

function KPICard({ title, value, subtitle, icon, variant = 'default' }: { title: string; value: string | number; subtitle?: string; icon: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' }) {
  const bgColors = { default: 'bg-card', success: 'bg-green-500/5 border-green-500/20', warning: 'bg-orange-500/5 border-orange-500/20', danger: 'bg-destructive/5 border-destructive/20' };
  return (
    <Card className={bgColors[variant]}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-primary/10">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface CSDashboardProps {
  onViewTicket?: (ticket: CSTicket) => void;
}

type PeriodPreset = 'mes_atual' | 'ultimos_3_meses' | 'ultimos_6_meses' | 'ultimos_12_meses';

export function CSDashboard({ onViewTicket }: CSDashboardProps) {
  const { data: funcionarios } = useFuncionariosAtivos();
  const [selectedOwner, setSelectedOwner] = useState<string>('__all__');
  const [periodo, setPeriodo] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const periodoInicio = periodo.from || startOfMonth(new Date());
  const periodoFim = periodo.to || new Date();

  const filters: CSDashboardFilters = useMemo(() => ({
    periodoInicio, periodoFim,
    ownerId: selectedOwner === '__all__' ? undefined : Number(selectedOwner),
  }), [periodoInicio, periodoFim, selectedOwner]);

  const { data, isLoading } = useCSDashboardData(filters);

  if (isLoading) return <div className="space-y-6"><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div></div>;
  if (!data) return null;

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatPercent = (v: number) => `${v.toFixed(1)}%`;
  const formatHours = (h: number) => h < 24 ? `${h.toFixed(1)}h` : `${Math.floor(h / 24)}d ${(h % 24).toFixed(0)}h`;

  const backlogStatusData = Object.entries(data.backlogPorStatus).filter(([s]) => !['concluido', 'cancelado'].includes(s)).map(([s, c]) => ({ name: CS_TICKET_STATUS_LABELS[s as keyof typeof CS_TICKET_STATUS_LABELS], value: c }));
  const backlogPrioridadeData = Object.entries(data.backlogPorPrioridade).map(([p, c]) => ({ name: CS_TICKET_PRIORIDADE_LABELS[p as CSTicketPrioridade], value: c }));
  const resultadoRiscoData = [{ name: 'Retido', value: data.resultadoRisco.retido, color: '#22c55e' }, { name: 'Não Retido', value: data.resultadoRisco.naoRetido, color: '#ef4444' }, { name: 'Monitoramento', value: data.resultadoRisco.monitoramento, color: '#f59e0b' }];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <DateRangePicker label="Período" value={periodo} onChange={setPeriodo} className="w-64" />
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Responsável</label>
              <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {funcionarios?.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="operacao" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-flex">
          <TabsTrigger value="operacao">Operação</TabsTrigger>
          <TabsTrigger value="retencao">Retenção</TabsTrigger>
          <TabsTrigger value="indicacoes">Indicações</TabsTrigger>
        </TabsList>

        <TabsContent value="operacao" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Tickets Abertos" value={data.ticketsAbertos} subtitle="no período" icon={<BarChart3 className="h-5 w-5 text-primary" />} />
            <KPICard title="Tickets Fechados" value={data.ticketsFechados} subtitle="no período" icon={<CheckCircle className="h-5 w-5 text-green-500" />} variant="success" />
            <KPICard title="Vencidos SLA" value={data.vencidosSlaAcao.length + data.vencidosSlaConclusao.length} subtitle="ação + conclusão" icon={<AlertTriangle className="h-5 w-5 text-destructive" />} variant="danger" />
            <KPICard title="Reaberturas" value={data.reaberturas} icon={<RefreshCw className="h-5 w-5 text-orange-500" />} variant={data.reaberturas > 0 ? 'warning' : 'default'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Tempo 1ª Ação (Média)" value={formatHours(data.tempoAteAcaoMedia)} icon={<Clock className="h-5 w-5 text-primary" />} />
            <KPICard title="Tempo 1ª Ação (Mediana)" value={formatHours(data.tempoAteAcaoMediana)} icon={<Clock className="h-5 w-5 text-primary" />} />
            <KPICard title="Tempo Conclusão (Média)" value={formatHours(data.tempoAteConclusaoMedia)} icon={<Clock className="h-5 w-5 text-primary" />} />
            <KPICard title="% Higiene" value={formatPercent(data.percentHigiene)} subtitle="próxima ação + data" icon={<Target className="h-5 w-5 text-green-500" />} variant={data.percentHigiene >= 80 ? 'success' : data.percentHigiene >= 50 ? 'warning' : 'danger'} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card><CardHeader><CardTitle className="text-base">Backlog por Status</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={250}><BarChart data={backlogStatusData} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="name" type="category" width={120} fontSize={12} /><Tooltip /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Backlog por Prioridade</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={backlogPrioridadeData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>{backlogPrioridadeData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Top Prioridades (Urgente/Alta)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Prioridade</TableHead><TableHead>Follow-up</TableHead><TableHead>Owner</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.topPrioridades.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum ticket urgente ou de alta prioridade 🎉</TableCell></TableRow> :
                    data.topPrioridades.map(t => (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onViewTicket?.(t)}>
                        <TableCell className="font-medium"><div className="flex items-center gap-2">{t.cliente_id ? <><Building2 className="h-4 w-4 text-muted-foreground" />{t.cliente?.nome_fantasia || t.cliente?.razao_social}</> : <><User className="h-4 w-4 text-muted-foreground" /><span className="italic">Interno</span></>}</div></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{CS_TICKET_TIPO_LABELS[t.tipo]}</Badge></TableCell>
                        <TableCell><Badge className={PRIORIDADE_COLORS[t.prioridade]}>{CS_TICKET_PRIORIDADE_LABELS[t.prioridade]}</Badge></TableCell>
                        <TableCell className="text-sm">{t.proximo_followup_em ? format(new Date(t.proximo_followup_em), 'dd/MM/yy', { locale: ptBR }) : '-'}</TableCell>
                        <TableCell>{t.owner?.nome || '-'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="retencao" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Clientes em Risco" value={data.clientesEmRisco} icon={<AlertTriangle className="h-5 w-5 text-destructive" />} variant="danger" />
            <KPICard title="MRR em Risco" value={formatCurrency(data.mrrEmRisco)} icon={<DollarSign className="h-5 w-5 text-destructive" />} variant="danger" />
            <KPICard title="MRR Recuperado" value={formatCurrency(data.mrrRecuperado)} subtitle="no período" icon={<TrendingUp className="h-5 w-5 text-green-500" />} variant="success" />
            <KPICard title="% Com Plano" value={formatPercent(data.percentRiscoComPlano)} subtitle="tickets risco" icon={<Target className="h-5 w-5 text-primary" />} variant={data.percentRiscoComPlano >= 80 ? 'success' : 'warning'} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Resultado dos Riscos</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart><Pie data={resultadoRiscoData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>{resultadoRiscoData.map((entry, i) => <Cell key={i} fill={entry.color} />)}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indicacoes" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(data.pipelineIndicacao).map(([status, count]) => (
              <KPICard key={status} title={CS_INDICACAO_STATUS_LABELS[status as keyof typeof CS_INDICACAO_STATUS_LABELS]} value={count} icon={<Users className="h-5 w-5 text-primary" />} />
            ))}
          </div>
          {data.indicacoesPorOwner.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Indicações por Responsável</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Responsável</TableHead><TableHead>Qtd</TableHead></TableRow></TableHeader>
                  <TableBody>{data.indicacoesPorOwner.map(i => <TableRow key={i.owner_id}><TableCell>{i.nome}</TableCell><TableCell>{i.count}</TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          {/* Lista detalhada de indicações */}
          <Card>
            <CardHeader><CardTitle className="text-base">Lista de Indicações no Período</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome Indicado</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cliente que Indicou</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ticketsIndicacaoDetalhados.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma indicação no período</TableCell></TableRow>
                  ) : (
                    data.ticketsIndicacaoDetalhados.map(t => (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onViewTicket?.(t)}>
                        <TableCell className="font-medium">{t.indicacao_nome || '-'}</TableCell>
                        <TableCell>{t.indicacao_contato || '-'}</TableCell>
                        <TableCell>{t.indicacao_cidade || '-'}</TableCell>
                        <TableCell>{t.indicacao_status ? <Badge variant="outline" className="text-xs">{CS_INDICACAO_STATUS_LABELS[t.indicacao_status]}</Badge> : '-'}</TableCell>
                        <TableCell>{t.cliente?.nome_fantasia || t.cliente?.razao_social || <span className="italic text-muted-foreground">Interno</span>}</TableCell>
                        <TableCell>{t.owner?.nome || '-'}</TableCell>
                        <TableCell className="text-sm">{format(new Date(t.criado_em), 'dd/MM/yy', { locale: ptBR })}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
