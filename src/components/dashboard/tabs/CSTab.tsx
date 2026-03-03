import { useState, useMemo } from 'react';
import { format, subMonths, startOfMonth, endOfMonth, parseISO, isWithinInterval, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, Legend,
} from 'recharts';
import { useCSDashboardData, type CSDashboardFilters } from '@/components/cs/hooks/useCSDashboardData';
import { useFuncionariosAtivos } from '@/components/cs/hooks/useCSTickets';
import {
  CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_INDICACAO_STATUS_LABELS, CS_TICKET_TIPO_LABELS,
  type CSTicketPrioridade, type CSTicketStatus, type CSIndicacaoStatus,
} from '@/components/cs/types';
import { Clock, AlertTriangle, CheckCircle, Users, Target, DollarSign, BarChart3, List, TrendingUp, TrendingDown, ShieldCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/* ── helpers ────────────────────────────────────────────────────── */

function DeltaLine({ current, previous, inverted = false, unit = 'abs', label = 'vs mês anterior' }: {
  current: number; previous: number | null; inverted?: boolean; unit?: 'abs' | 'pct' | 'currency' | 'pp'; label?: string;
}) {
  if (previous === null || previous === undefined) return <span className="text-[11px] text-muted-foreground">— {label}</span>;
  const diff = current - previous;
  if (diff === 0) return <span className="text-[11px] text-muted-foreground">— {label}</span>;
  const improved = inverted ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? '▲' : '▼';
  const color = improved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  let formatted: string;
  if (unit === 'pct') {
    const pct = previous !== 0 ? ((diff / Math.abs(previous)) * 100) : 0;
    formatted = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  } else if (unit === 'pp') {
    formatted = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}pp`;
  } else if (unit === 'currency') {
    formatted = `${diff > 0 ? '+' : ''}${diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  } else {
    formatted = `${diff > 0 ? '+' : ''}${diff}`;
  }
  return <span className={cn('text-[11px] font-medium', color)}>{arrow} {formatted} {label}</span>;
}

function KPICard({ title, value, subtitle, icon, variant = 'default', tvMode = false, delta }: {
  title: string; value: string | number; subtitle?: string; icon: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger'; tvMode?: boolean;
  delta?: React.ReactNode;
}) {
  const bg = { default: 'bg-card', success: 'bg-green-500/5 border-green-500/20', warning: 'bg-orange-500/5 border-orange-500/20', danger: 'bg-red-500/5 border-red-500/20' };
  return (
    <Card className={cn(bg[variant], tvMode ? 'min-h-[120px]' : '')}>
      <CardContent className={cn('pt-4', tvMode && 'pt-6')}>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className={cn('font-medium text-muted-foreground uppercase tracking-wider', tvMode ? 'text-sm' : 'text-xs')}>{title}</p>
            <p className={cn('font-bold', tvMode ? 'text-4xl' : 'text-2xl')}>{value}</p>
            {delta}
            {subtitle && <p className={cn('text-muted-foreground', tvMode ? 'text-sm' : 'text-xs')}>{subtitle}</p>}
          </div>
          <div className={cn('rounded-lg bg-primary/10', tvMode ? 'p-3' : 'p-2')}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── tipo badge colors ──────────────────────────────────────────── */
const TIPO_BADGE: Record<string, string> = {
  risco_churn: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  oportunidade: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  interno_processo: 'bg-muted text-muted-foreground',
  relacionamento_90d: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  adocao_engajamento: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  indicacao: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  clube_comunidade: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
};

const PRIO_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-muted text-muted-foreground',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-500 text-white',
  urgente: 'bg-red-600 text-white',
};

const PRIO_BAR_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: '#22c55e',
  media: '#64748b',
  alta: '#f97316',
  urgente: '#ef4444',
};

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  color: 'hsl(var(--foreground))',
};

/* ── main component ─────────────────────────────────────────────── */

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

  // Previous month filters for delta
  const prevFilters: CSDashboardFilters = useMemo(() => {
    const prevEnd = subMonths(pInicio, 0); // day before period start would be complex, use full prev month
    const prevStart = startOfMonth(subMonths(pInicio, 1));
    const prevEndDate = endOfMonth(subMonths(pInicio, 1));
    return { periodoInicio: prevStart, periodoFim: prevEndDate, ownerId: filters.ownerId };
  }, [pInicio, filters.ownerId]);

  const { data, isLoading } = useCSDashboardData(filters);
  const { data: prevData } = useCSDashboardData(prevFilters);

  /* ── evolution + moving average ── */
  const evolutionData = useMemo(() => {
    if (!data?.allTickets) return [];
    const refDate = pFim;
    const months = Array.from({ length: 12 }).map((_, i) => {
      const d = subMonths(refDate, 11 - i);
      return { month: format(d, 'MMM', { locale: ptBR }), monthFull: format(d, 'MMM yyyy', { locale: ptBR }), yearMonth: format(d, 'yyyy-MM'), value: 0, ma3: 0 };
    });
    data.allTickets.forEach(t => {
      if (t.concluido_em) {
        const m = format(new Date(t.concluido_em), 'yyyy-MM');
        const entry = months.find(x => x.yearMonth === m);
        if (entry) entry.value++;
      }
    });
    // moving average 3m
    months.forEach((m, i) => {
      if (i < 2) { m.ma3 = m.value; return; }
      m.ma3 = Math.round(((months[i - 2].value + months[i - 1].value + m.value) / 3) * 10) / 10;
    });
    return months;
  }, [data?.allTickets, pFim]);

  if (isLoading) return <div className="grid gap-4 grid-cols-2 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (!data) return null;
  const cob = data.cobertura90d ?? { totalAtivos: 0, cobertos: 0, descobertos: 0, percentCoberto: 100, clientesDescobertos: [] };

  const fmtCur = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;
  const iconSize = tvMode ? 'h-6 w-6' : 'h-5 w-5';

  const backlogStatusData = Object.entries(data.backlogPorStatus).filter(([s]) => !['concluido', 'cancelado'].includes(s)).map(([s, c]) => ({ name: CS_TICKET_STATUS_LABELS[s as CSTicketStatus], value: c }));
  const backlogPrioData = Object.entries(data.backlogPorPrioridade).map(([p, c]) => ({ name: CS_TICKET_PRIORIDADE_LABELS[p as CSTicketPrioridade], value: c, fill: PRIO_BAR_COLORS[p as CSTicketPrioridade] }));

  /* ── pipeline indicações: funil + não convertidas ── */
  const funnelStages: CSIndicacaoStatus[] = ['recebida', 'contatada', 'qualificada', 'enviada_ao_comercial', 'fechou'];
  const funnelData = funnelStages.map(s => ({ key: s, name: CS_INDICACAO_STATUS_LABELS[s], value: data.pipelineIndicacao[s] || 0 }));
  const totalRecebida = funnelData[0]?.value || 0;
  const naoConvertidas = [
    { label: 'Não Fechou', value: data.pipelineIndicacao['nao_fechou'] || 0 },
  ];
  const conversaoTotal = totalRecebida > 0 ? ((funnelData[funnelData.length - 1]?.value || 0) / totalRecebida * 100) : 0;
  const funnelColors = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0'];

  const today = new Date();

  return (
    <div className="space-y-6">
      {/* FILTROS */}
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

      {/* ═══ 1) TOP PRIORIDADES ═══ */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 pb-1">
          <div className="flex items-center justify-center rounded-lg bg-red-500/10 p-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-lg">🔴 TOP PRIORIDADES — Ação Imediata</h3>
            <p className="text-sm text-muted-foreground">Tickets Urgentes e Alta prioridade no período</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topPrioridades.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum ticket urgente ou de alta prioridade 🎉</TableCell></TableRow>
                ) : data.topPrioridades.slice(0, 10).map(t => {
                  const followupDate = t.proximo_followup_em ? new Date(t.proximo_followup_em) : null;
                  const isOverdue = followupDate && isBefore(followupDate, today);
                  return (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">{t.cliente?.nome_fantasia || t.cliente?.razao_social || 'Interno'}</TableCell>
                      <TableCell><Badge className={cn('text-xs', TIPO_BADGE[t.tipo] || 'bg-muted text-muted-foreground')}>{CS_TICKET_TIPO_LABELS[t.tipo]}</Badge></TableCell>
                      <TableCell><Badge className={PRIO_COLORS[t.prioridade]}>{CS_TICKET_PRIORIDADE_LABELS[t.prioridade]}</Badge></TableCell>
                      <TableCell>
                        {followupDate ? (
                          <span className={cn('text-sm font-medium', isOverdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                            {format(followupDate, 'dd/MM/yyyy')}
                            {isOverdue && <span className="ml-1 text-[10px]">⚠️</span>}
                          </span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 2) OPERAÇÃO ═══ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4" />OPERAÇÃO</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <KPICard
            title="Tickets Abertos" value={data.ticketsAbertos} subtitle="no período"
            icon={<BarChart3 className={cn(iconSize, 'text-primary')} />} tvMode={tvMode}
            delta={<DeltaLine current={data.ticketsAbertos} previous={prevData?.ticketsAbertos ?? null} inverted unit="abs" />}
          />
          <KPICard
            title="Tickets Concluídos" value={data.ticketsFechados} subtitle="no período"
            icon={<CheckCircle className={cn(iconSize, 'text-green-500')} />} variant="success" tvMode={tvMode}
            delta={<DeltaLine current={data.ticketsFechados} previous={prevData?.ticketsFechados ?? null} unit="abs" />}
          />
          <KPICard title="Vencendo SLA" value={data.vencendoSlaAcao.length + data.vencendoSlaConclusao.length} subtitle="ação + conclusão" icon={<Clock className={cn(iconSize, 'text-orange-500')} />} variant="warning" tvMode={tvMode} />
          <KPICard title="Vencidos SLA" value={data.vencidosSlaAcao.length + data.vencidosSlaConclusao.length} subtitle="ação + conclusão" icon={<AlertTriangle className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode} />
        </div>
      </div>

      {/* ═══ 3) RISCO & RETENÇÃO ═══ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4" />RISCO & RETENÇÃO</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <KPICard
            title="Clientes em Risco" value={data.clientesEmRisco}
            icon={<AlertTriangle className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode}
            delta={<DeltaLine current={data.clientesEmRisco} previous={prevData?.clientesEmRisco ?? null} inverted unit="abs" />}
          />
          <KPICard
            title="MRR em Risco" value={fmtCur(data.mrrEmRisco)}
            icon={<DollarSign className={cn(iconSize, 'text-red-500')} />} variant="danger" tvMode={tvMode}
            delta={<DeltaLine current={data.mrrEmRisco} previous={prevData?.mrrEmRisco ?? null} inverted unit="currency" />}
          />
          <KPICard
            title="MRR Recuperado" value={fmtCur(data.mrrRecuperado)} subtitle="no período"
            icon={<DollarSign className={cn(iconSize, 'text-green-500')} />} variant="success" tvMode={tvMode}
            delta={<DeltaLine current={data.mrrRecuperado} previous={prevData?.mrrRecuperado ?? null} unit="currency" />}
          />
          <KPICard
            title="% Higiene" value={fmtPct(data.percentHigiene)}
            icon={<Target className={cn(iconSize, data.percentHigiene >= 80 ? 'text-green-500' : 'text-orange-500')} />}
            variant={data.percentHigiene >= 80 ? 'success' : 'warning'} tvMode={tvMode}
            delta={<DeltaLine current={data.percentHigiene} previous={prevData?.percentHigiene ?? null} unit="pp" />}
          />
        </div>
      </div>

      {/* ═══ 4) INDICAÇÕES — Funil + Não convertidas ═══ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><Target className="h-4 w-4" />INDICAÇÕES</h3>
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Funil */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Funil de Indicações</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {funnelData.map((stage, i) => {
                  const maxVal = funnelData[0]?.value || 1;
                  const widthPct = Math.max((stage.value / maxVal) * 100, 8);
                  const convRate = i > 0 && funnelData[i - 1].value > 0
                    ? ((stage.value / funnelData[i - 1].value) * 100).toFixed(0)
                    : null;
                  return (
                    <div key={stage.key}>
                      {i > 0 && convRate !== null && (
                        <div className="text-center text-[11px] text-muted-foreground py-0.5">↓ {convRate}%</div>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 text-right shrink-0">{stage.name}</span>
                        <div className="flex-1 relative h-7">
                          <div
                            className="h-full rounded-md flex items-center justify-end pr-2 text-xs font-semibold text-white transition-all"
                            style={{ width: `${widthPct}%`, backgroundColor: funnelColors[i] || funnelColors[4] }}
                          >
                            {stage.value}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="text-center text-sm font-medium text-muted-foreground pt-2 border-t">
                  Conversão total: <span className="text-foreground font-bold">{conversaoTotal.toFixed(1)}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Não convertidas */}
          <div className="space-y-4">
            <Card className="bg-red-500/5 border-red-500/20">
              <CardContent className="pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Não Fechou</p>
                <p className="text-2xl font-bold">{naoConvertidas[0].value}</p>
                <p className="text-xs text-muted-foreground">
                  {totalRecebida > 0 ? `${((naoConvertidas[0].value / totalRecebida) * 100).toFixed(1)}% do total recebido` : '—'}
                </p>
              </CardContent>
            </Card>
            {data.indicacoesPorOwner.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Indicações por Responsável</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-xs">Responsável</TableHead><TableHead className="text-xs text-right">Qtd</TableHead></TableRow></TableHeader>
                    <TableBody>{data.indicacoesPorOwner.map(i => <TableRow key={i.owner_id}><TableCell className="text-sm">{i.nome}</TableCell><TableCell className="text-sm text-right font-medium">{i.count}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 5) BACKLOG ═══ */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Backlog por Status</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={backlogStatusData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Backlog por Prioridade</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={backlogPrioData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 12, fill: 'hsl(var(--foreground))' }}>
                  {backlogPrioData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 6) COBERTURA 90D ═══ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-muted-foreground flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" />COBERTURA DE RELACIONAMENTO 90D</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          <KPICard
            title="Clientes Ativos" value={cob.totalAtivos}
            icon={<Users className={cn(iconSize, 'text-primary')} />} tvMode={tvMode}
          />
          <KPICard
            title="% Cobertura 90D" value={fmtPct(cob.percentCoberto)}
            subtitle={`${cob.cobertos} de ${cob.totalAtivos}`}
            icon={<ShieldCheck className={cn(iconSize, 'text-green-500')} />}
            variant={cob.percentCoberto >= 80 ? 'success' : cob.percentCoberto >= 50 ? 'warning' : 'danger'}
            tvMode={tvMode}
          />
          <KPICard
            title="Descobertos" value={cob.descobertos}
            subtitle="sem contato 90d"
            icon={<AlertTriangle className={cn(iconSize, 'text-red-500')} />}
            variant={cob.descobertos > 0 ? 'danger' : 'success'}
            tvMode={tvMode}
          />
        </div>
        {cob.clientesDescobertos.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Top 10 — Clientes Sem Cobertura</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Mensalidade</TableHead>
                    <TableHead>Último Contato</TableHead>
                    <TableHead>Dias s/ Contato</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cob.clientesDescobertos.slice(0, 10).map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nome_fantasia || c.razao_social || '—'}</TableCell>
                      <TableCell>{c.mensalidade != null ? fmtCur(c.mensalidade) : '—'}</TableCell>
                      <TableCell>{c.ultimoContato ? format(new Date(c.ultimoContato), 'dd/MM/yyyy') : <span className="text-red-600 dark:text-red-400 font-medium">Nunca</span>}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.diasSemContato === null || c.diasSemContato > 180 ? 'border-red-500 text-red-500' : c.diasSemContato > 90 ? 'border-orange-500 text-orange-500' : ''}>
                          {c.diasSemContato != null ? `${c.diasSemContato}d` : '∞'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/clientes/${c.id}`)}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ═══ 7) EVOLUÇÃO TICKETS CONCLUÍDOS ═══ */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Evolução: Tickets Concluídos (12 meses)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={evolutionData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="monthFull" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line name="Tickets Concluídos" type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }} />
              <Line name="Média móvel 3m" type="monotone" dataKey="ma3" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
