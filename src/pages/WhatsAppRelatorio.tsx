import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useUserDepartment } from "@/hooks/useUserDepartment";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, MessageSquare, Users, Clock, TrendingUp, BarChart3, Send, Inbox, CheckCircle2, Download, SmilePlus, Building2, User, Timer, Zap, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppMetrics, type WhatsAppMetricsFilters } from "@/components/whatsapp/hooks/useWhatsAppMetrics";
import { useAttendanceMetrics, formatSecondsToDisplay } from "@/components/whatsapp/hooks/useAttendanceMetrics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { subDays, startOfDay, endOfDay, format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Tooltip as RechartsTooltip } from "recharts";
import { exportToCSV } from "@/utils/whatsapp/whatsappReportExport";

const COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground))", "hsl(var(--accent))", "hsl(var(--destructive))"];
const SENTIMENT_COLORS: Record<string, string> = { positive: "#22c55e", neutral: "#94a3b8", negative: "#ef4444" };

function MetricCard({
  title, value, icon: Icon, subtitle, trend, sectorValue, unit = ""
}: {
  title: string;
  value: string | number;
  icon: any;
  subtitle?: string;
  trend?: number;
  sectorValue?: number;
  unit?: string;
}) {
  const numericValue = typeof value === "string"
    ? parseFloat(value.replace(/[^0-9.]/g, ""))
    : value;

  const pct = sectorValue && sectorValue > 0
    ? Math.round((numericValue / sectorValue) * 100)
    : null;

  const pctColor = pct === null ? "" :
    pct >= 75 ? "text-green-500" :
    pct >= 40 ? "text-amber-500" :
    "text-red-500";

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
            <p className="text-2xl font-bold mt-1 leading-none">{value}{unit}</p>
            {subtitle && (
              <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>
            )}
            {trend !== undefined && trend !== 0 && (
              <p className={`text-[10px] mt-1 ${trend > 0 ? "text-green-500" : "text-red-500"}`}>
                {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(0)}% vs anterior
              </p>
            )}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/20 shrink-0 ml-2" />
        </div>

        {pct !== null && (
          <div className="mt-3 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Sua participação</span>
              <span className={`text-[11px] font-semibold ${pctColor}`}>{pct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pct >= 75 ? "bg-green-500" :
                  pct >= 40 ? "bg-amber-500" :
                  "bg-red-500"
                }`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Setor: {sectorValue?.toLocaleString("pt-BR")}{unit}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WhatsAppRelatorio() {
  const navigate = useNavigate();
  const { instances } = useWhatsAppInstances();
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const { selectedDepartmentId, selectedDepartment } = useDepartmentFilter();
  const { data: userDepartmentId } = useUserDepartment();
  const [agentFilter, setAgentFilter] = useState<"all" | "me">("me");

  const effectiveDepartmentId = isAdmin
    ? (selectedDepartmentId || undefined)
    : (userDepartmentId || undefined);

  // Para user não-admin: filtra pelo seu próprio user_id (assigned_to usa auth user id)
  const effectiveAgentId = isAdmin
    ? (agentFilter === "me" && user?.id ? user.id : undefined)
    : (user?.id ?? undefined);

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(subDays(new Date(), 30)),
    to: endOfDay(new Date()),
  });
  const [instanceId, setInstanceId] = useState<string | undefined>();

  const filters: WhatsAppMetricsFilters = useMemo(() => ({
    dateRange,
    instanceId: instanceId || null,
    departmentId: effectiveDepartmentId || null,
    agentId: effectiveAgentId || null,
  }), [dateRange, instanceId, effectiveDepartmentId, effectiveAgentId]);

  const { data: metrics, isLoading } = useWhatsAppMetrics(filters);

  const { data: sla, isLoading: slaLoading } = useAttendanceMetrics({
    dateRange: { from: dateRange.from, to: dateRange.to },
    departmentId: effectiveDepartmentId || undefined,
    agentId: effectiveAgentId || undefined,
  });

  const trendTotal = metrics?.previousPeriod?.total
    ? ((metrics.total - metrics.previousPeriod.total) / metrics.previousPeriod.total) * 100
    : 0;

  const handleExport = () => {
    if (!metrics) return;
    try {
      const rows = metrics.dailyTrend.map(d => ({ data: d.date, conversas: d.count }));
      exportToCSV(rows, `relatorio-whatsapp-${format(new Date(), "yyyy-MM-dd")}.csv`);
    } catch {
      const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-whatsapp-${format(new Date(), "yyyy-MM-dd")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/whatsapp")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">Relatório WhatsApp</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!metrics}>
            <Download className="h-4 w-4 mr-1" /> Exportar
          </Button>

          {/* Filtro de visão: só meus dados ou todos (apenas admin) */}
          {isAdmin && (
            <div className="inline-flex items-center h-9 rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setAgentFilter("me")}
                className={`flex items-center gap-1.5 px-3 h-full text-xs font-medium transition-colors ${
                  agentFilter === "me"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Meus dados
              </button>
              <button
                onClick={() => setAgentFilter("all")}
                className={`flex items-center gap-1.5 px-3 h-full text-xs font-medium transition-colors ${
                  agentFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                {selectedDepartment?.name ?? "Todos os setores"}
              </button>
            </div>
          )}

          {/* Filtro de instância: só admin vê */}
          {isAdmin && agentFilter === "all" && (
            <Select value={instanceId || "all"} onValueChange={(v) => setInstanceId(v === "all" ? undefined : v)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas instâncias</SelectItem>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>{inst.display_name || inst.instance_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Badge indicando contexto atual para não-admin */}
          {!isAdmin && (
            <div className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-muted text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {selectedDepartment?.name ?? "Seu setor"}
              <span>·</span>
              <User className="h-3.5 w-3.5" />
              Seus dados
            </div>
          )}

          <DateRangePicker
            label="Período"
            value={{ from: dateRange.from, to: dateRange.to }}
            onChange={(range) => {
              if (range?.from && range?.to) setDateRange({ from: range.from, to: range.to });
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : metrics ? (
        <>
          {/* KPIs Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Total Conversas" value={metrics.total} icon={MessageSquare} trend={trendTotal}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorTotal || undefined : undefined} />
            <MetricCard title="Ativas" value={metrics.active} icon={TrendingUp}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorActive || undefined : undefined} />
            <MetricCard title="Encerradas" value={metrics.closed} icon={CheckCircle2}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorClosed || undefined : undefined} />
            <MetricCard title="Taxa Resolução" value={slaLoading ? "..." : `${(sla?.resolutionRate ?? metrics.resolutionRate).toFixed(1)}%`} icon={BarChart3}
              subtitle={`Setor: ${(sla?.sector.resolutionRate ?? 0).toFixed(1)}%`}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorResolutionRate || undefined : undefined} />
          </div>

          {/* KPIs Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Mensagens Totais" value={metrics.totalMessages} icon={MessageSquare}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorTotalMessages || undefined : undefined} />
            <MetricCard title="Enviadas" value={metrics.sentMessages} icon={Send}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorSentMessages || undefined : undefined} />
            <MetricCard title="Recebidas" value={metrics.receivedMessages} icon={Inbox}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorReceivedMessages || undefined : undefined} />
            <MetricCard title="Contatos Únicos" value={metrics.uniqueContacts} icon={Users}
              sectorValue={effectiveAgentId || !isAdmin ? metrics.sectorUniqueContacts || undefined : undefined} />
          </div>

          {/* SLA Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* TME - Tempo Médio de Espera (fila) */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5" /> TME (Fila)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold leading-none">
                  {slaLoading ? <Skeleton className="h-7 w-20" /> : formatSecondsToDisplay(sla?.avgWaitSeconds ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setor: {formatSecondsToDisplay(sla?.sector.avgWaitSeconds ?? 0)}
                </p>
                {!slaLoading && sla && (
                  <p className={`text-[10px] mt-1 ${(sla.avgWaitSeconds ?? 0) <= 60 ? 'text-green-600' : (sla.avgWaitSeconds ?? 0) <= 180 ? 'text-amber-600' : 'text-red-600'}`}>
                    {(sla.avgWaitSeconds ?? 0) <= 60 ? '✅ Dentro do SLA' : (sla.avgWaitSeconds ?? 0) <= 180 ? '⚠️ Atenção' : '🔴 Acima do SLA'}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* TPR - 1ª Resposta Humana */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> 1ª Resposta
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold leading-none">
                  {slaLoading ? <Skeleton className="h-7 w-20" /> : formatSecondsToDisplay(sla?.avgFirstResponseSeconds ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setor: {formatSecondsToDisplay(sla?.sector.avgFirstResponseSeconds ?? 0)}
                </p>
                {!slaLoading && sla && (
                  <p className={`text-[10px] mt-1 ${(sla.avgFirstResponseSeconds ?? 0) <= 180 ? 'text-green-600' : (sla.avgFirstResponseSeconds ?? 0) <= 600 ? 'text-amber-600' : 'text-red-600'}`}>
                    {(sla.avgFirstResponseSeconds ?? 0) <= 180 ? '✅ Dentro do SLA' : (sla.avgFirstResponseSeconds ?? 0) <= 600 ? '⚠️ Atenção' : '🔴 Acima do SLA'}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* TMA - Tempo Médio de Atendimento */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> TMA (Atendimento)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold leading-none">
                  {slaLoading ? <Skeleton className="h-7 w-20" /> : formatSecondsToDisplay(sla?.avgHandleSeconds ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setor: {formatSecondsToDisplay(sla?.sector.avgHandleSeconds ?? 0)}
                </p>
              </CardContent>
            </Card>

            {/* TMR - Tempo Médio de Resolução */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> TMR (Resolução)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold leading-none">
                  {slaLoading ? <Skeleton className="h-7 w-20" /> : formatSecondsToDisplay(sla?.avgResolutionSeconds ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setor: {formatSecondsToDisplay(sla?.sector.avgResolutionSeconds ?? 0)}
                </p>
              </CardContent>
            </Card>

            {/* FCR - Resolução no 1º Contato */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Trophy className="h-3.5 w-3.5" /> FCR
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold leading-none">
                  {slaLoading ? <Skeleton className="h-7 w-20" /> : `${(sla?.fcrRate ?? 0).toFixed(1)}%`}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setor: {(sla?.sector.fcrRate ?? 0).toFixed(1)}%
                </p>
                {!slaLoading && sla && (
                  <p className={`text-[10px] mt-1 ${(sla.fcrRate ?? 0) >= 70 ? 'text-green-600' : (sla.fcrRate ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {(sla.fcrRate ?? 0) >= 70 ? '✅ Ótimo' : (sla.fcrRate ?? 0) >= 50 ? '⚠️ Regular' : '🔴 Baixo'}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Daily Trend */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Evolução Diária</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={metrics.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status Distribution */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Distribuição por Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={metrics.statusDistribution} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ status, percentage }) => `${status} (${percentage.toFixed(0)}%)`}>
                      {metrics.statusDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Messages Trend */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Mensagens Enviadas vs Recebidas</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={metrics.dailyMessageTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Enviadas" />
                    <Line type="monotone" dataKey="received" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="Recebidas" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Sentiment Distribution */}
            {metrics.sentimentDistribution.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Distribuição de Sentimento</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={metrics.sentimentDistribution} dataKey="count" nameKey="sentiment" cx="50%" cy="50%" outerRadius={80} label={({ sentiment, percentage }) => `${sentiment} (${percentage.toFixed(0)}%)`}>
                        {metrics.sentimentDistribution.map((entry, i) => (
                          <Cell key={i} fill={SENTIMENT_COLORS[entry.sentiment] || COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Hourly Activity */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Atividade por Hora</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={metrics.hourlyActivity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h) => `${h}h`} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Weekday Activity */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Atividade por Dia da Semana</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={metrics.weekdayActivity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="weekday" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Message Types */}
            {metrics.messageTypeDistribution.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Tipos de Mensagem</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={metrics.messageTypeDistribution} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={80} label={({ type, percentage }) => `${type} (${percentage.toFixed(0)}%)`}>
                        {metrics.messageTypeDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Topics */}
            {metrics.topicsDistribution.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Tópicos</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={metrics.topicsDistribution.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="topic" type="category" tick={{ fontSize: 10 }} width={100} />
                      <RechartsTooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Agent Performance Table (SLA-based) */}
          {sla && sla.agentRanking.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="h-4 w-4" />
                  Produtividade por Agente
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agente</TableHead>
                        <TableHead className="text-right">Atend.</TableHead>
                        <TableHead className="text-right">Fechados</TableHead>
                        <TableHead className="text-right">TMR</TableHead>
                        <TableHead className="text-right">1ª Resp.</TableHead>
                        <TableHead className="text-right">FCR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sla.agentRanking.map((agent) => (
                        <TableRow key={agent.agentId}>
                          <TableCell className="font-medium">{agent.agentId?.slice(0, 8) ?? "—"}</TableCell>
                          <TableCell className="text-right">{agent.totalAttendances}</TableCell>
                          <TableCell className="text-right">{agent.closedAttendances}</TableCell>
                          <TableCell className="text-right">{formatSecondsToDisplay(agent.avgResolutionSeconds)}</TableCell>
                          <TableCell className="text-right">{formatSecondsToDisplay(agent.avgFirstResponseSeconds)}</TableCell>
                          <TableCell className="text-right">{agent.fcrRate.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Legacy Agent Performance Table */}
          {metrics.agentPerformance.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Performance por Agente (Conversas)</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 text-xs text-muted-foreground">Agente</th>
                        <th className="text-right p-2 text-xs text-muted-foreground">Conversas</th>
                        <th className="text-right p-2 text-xs text-muted-foreground">Encerradas</th>
                        <th className="text-right p-2 text-xs text-muted-foreground">Tempo Resp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.agentPerformance.map((a) => (
                        <tr key={a.agentId} className="border-b last:border-0">
                          <td className="p-2 font-medium">{a.agentName}</td>
                          <td className="p-2 text-right">{a.totalConversations}</td>
                          <td className="p-2 text-right">{a.closedConversations}</td>
                          <td className="p-2 text-right">{a.avgResponseTimeMinutes.toFixed(0)} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Contacts */}
          {metrics.topContacts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Top Contatos por Volume</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {metrics.topContacts.slice(0, 10).map((c, i) => (
                    <div key={c.contactId} className="flex items-center justify-between p-2 bg-muted rounded-md">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] w-6 h-6 rounded-full flex items-center justify-center">{i + 1}</Badge>
                        <span className="text-sm">{c.contactName}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">{c.messageCount} msgs</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
