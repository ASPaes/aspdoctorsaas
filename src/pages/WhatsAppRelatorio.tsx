import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, MessageSquare, Users, Clock, TrendingUp, BarChart3, Send, Inbox, CheckCircle2, Download, SmilePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppMetrics, type WhatsAppMetricsFilters } from "@/components/whatsapp/hooks/useWhatsAppMetrics";
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

function MetricCard({ title, value, icon: Icon, subtitle, trend }: { title: string; value: string | number; icon: any; subtitle?: string; trend?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/30" />
        </div>
        {trend !== undefined && trend !== 0 && (
          <p className={`text-[10px] mt-1 ${trend > 0 ? "text-green-500" : "text-red-500"}`}>
            {trend > 0 ? "+" : ""}{trend.toFixed(0)}% vs período anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function WhatsAppRelatorio() {
  const navigate = useNavigate();
  const { instances } = useWhatsAppInstances();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(subDays(new Date(), 30)),
    to: endOfDay(new Date()),
  });
  const [instanceId, setInstanceId] = useState<string | undefined>();

  const filters: WhatsAppMetricsFilters = useMemo(() => ({
    dateRange,
    instanceId: instanceId || null,
  }), [dateRange, instanceId]);

  const { data: metrics, isLoading } = useWhatsAppMetrics(filters);

  const trendTotal = metrics?.previousPeriod?.total
    ? ((metrics.total - metrics.previousPeriod.total) / metrics.previousPeriod.total) * 100
    : 0;

  const handleExport = () => {
    if (!metrics) return;
    try {
      whatsappReportExport(metrics as any, dateRange);
    } catch {
      // fallback: export as JSON
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!metrics}>
            <Download className="h-4 w-4 mr-1" /> Exportar
          </Button>
          <Select value={instanceId || "all"} onValueChange={(v) => setInstanceId(v === "all" ? undefined : v)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Instância" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {instances.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>{inst.display_name || inst.instance_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <MetricCard title="Total Conversas" value={metrics.total} icon={MessageSquare} trend={trendTotal} />
            <MetricCard title="Ativas" value={metrics.active} icon={TrendingUp} />
            <MetricCard title="Encerradas" value={metrics.closed} icon={CheckCircle2} />
            <MetricCard title="Taxa Resolução" value={`${metrics.resolutionRate.toFixed(0)}%`} icon={BarChart3} />
          </div>

          {/* KPIs Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Mensagens Totais" value={metrics.totalMessages} icon={MessageSquare} />
            <MetricCard title="Enviadas" value={metrics.sentMessages} icon={Send} />
            <MetricCard title="Recebidas" value={metrics.receivedMessages} icon={Inbox} />
            <MetricCard title="Contatos Únicos" value={metrics.uniqueContacts} icon={Users} />
          </div>

          {/* KPIs Row 3 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Tempo Médio Resposta" value={`${metrics.avgResponseTimeMinutes.toFixed(0)} min`} icon={Clock} />
            <MetricCard title="1ª Resposta" value={`${metrics.avgFirstResponseTimeMinutes.toFixed(0)} min`} icon={Clock} />
            <MetricCard title="Msgs/Conversa" value={metrics.avgMessagesPerConversation.toFixed(1)} icon={BarChart3} />
            <MetricCard title="Engajamento" value={`${metrics.engagementRate.toFixed(0)}%`} icon={SmilePlus} subtitle="Recebidas / Enviadas" />
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

          {/* Agent Performance Table */}
          {metrics.agentPerformance.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Performance por Agente</CardTitle></CardHeader>
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
