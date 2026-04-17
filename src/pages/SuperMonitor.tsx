import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, Activity, MessageSquare, Bot, Database } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import { format, subDays, startOfMonth, endOfMonth, startOfQuarter, startOfYear, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-day-picker/dist/style.css';

function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={6} />
      <circle
        cx={40}
        cy={40}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
      />
      <text x={40} y={40} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={600} fill="hsl(var(--foreground))">
        {score}
      </text>
      <text x={40} y={56} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">/100</text>
    </svg>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ flex: 1, height: 4, background: 'hsl(var(--muted))', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
    </div>
  );
}

function Sparkline({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: color,
            opacity: 0.6,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { setOpen(false); };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [open]);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          border: '1.5px solid #94a3b8',
          background: open ? '#334155' : '#e2e8f0',
          color: open ? '#f1f5f9' : '#475569',
          fontSize: 10, fontWeight: 700, lineHeight: 1,
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: 0, flexShrink: 0,
        }}
      >?</button>
      {open && (
        <div style={{
          position: 'absolute', top: 22, right: 0, zIndex: 999,
          background: '#1e293b', color: '#e2e8f0',
          border: '1px solid #334155', borderRadius: 10,
          padding: '10px 12px', fontSize: 12, lineHeight: 1.6,
          width: 240, whiteSpace: 'normal',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>{text}</div>
      )}
    </div>
  );
}

export default function SuperMonitor() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; label: string } | null>(null);

  const runDbAction = async (action: string, label: string) => {
    setActionLoading(action);
    setActionResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-db-actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      const isQueued = json.scheduled || json.message?.includes('minuto') || json.message?.includes('queued');
      const displayLabel = isQueued
        ? `${label} — será executado em até 2 minutos automaticamente`
        : json.message || label;
      setActionResult({ ok: json.ok, label: displayLabel });
      if (json.ok) setRefreshKey(k => k + 1);
    } catch (e) {
      setActionResult({ ok: false, label });
    } finally {
      setActionLoading(null);
    }
  };

  const opts = { staleTime: Infinity, refetchOnWindowFocus: false };
  const now = new Date();
  const sp = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  sp.setDate(sp.getDate() - 1);
  const yesterday = sp.toISOString().split('T')[0];
  const queryDateFrom = dateFrom || yesterday;
  const queryDateTo = dateTo || yesterday;
  const since24h = new Date(Date.now() - 86400000).toISOString();

  const { data: tenantMetrics = [] } = useQuery({
    queryKey: ['monitor-tenant-metrics', queryDateFrom, queryDateTo, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('tenant_daily_metrics')
        .select('*, tenants(nome)')
        .gte('metric_date', queryDateFrom)
        .lte('metric_date', queryDateTo)
        .order('metric_date', { ascending: false })
        .order('messages_sent', { ascending: false });
      return data ?? [];
    },
    ...opts,
  });

  const { data: instances = [] } = useQuery({
    queryKey: ['monitor-instances', refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('whatsapp_instances')
        .select('id, instance_name, status, tenant_id, updated_at, tenants(nome)');
      return data ?? [];
    },
    ...opts,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ['monitor-snapshots', refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('db_metrics_snapshots')
        .select('*')
        .gte('captured_at', since24h)
        .order('captured_at', { ascending: true });
      return data ?? [];
    },
    ...opts,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['monitor-alerts', refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('db_health_action_log')
        .select('*')
        .gte('sent_at', since24h)
        .order('sent_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    ...opts,
  });

  const { data: instanceLog = [] } = useQuery({
    queryKey: ['monitor-instance-log', refreshKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_instance_status_log')
        .select('instance_name, tenant_id, captured_at')
        .gte('captured_at', since24h)
        .eq('status', 'disconnected')
        .order('captured_at', { ascending: true });
      if (!data || data.length === 0) return [];
      const { data: tenantsData } = await supabase
        .from('tenants')
        .select('id, nome');
      const tenantMap: Record<string, string> = {};
      (tenantsData || []).forEach((t: any) => { tenantMap[t.id] = t.nome; });
      const grouped: Record<string, any> = {};
      for (const row of data) {
        const key = row.instance_name;
        if (!grouped[key]) {
          grouped[key] = {
            instance_name: row.instance_name,
            tenant_id: row.tenant_id,
            tenant_nome: tenantMap[row.tenant_id] || row.tenant_id,
            occurrences: 0,
            first_seen: row.captured_at,
            last_seen: row.captured_at,
          };
        }
        grouped[key].occurrences++;
        grouped[key].last_seen = row.captured_at;
      }
      return Object.values(grouped).sort((a: any, b: any) => b.occurrences - a.occurrences);
    },
    ...opts,
  });

  const { data: maintenanceData, refetch: refetchMaintenance } = useQuery({
    queryKey: ['monitor-maintenance', refreshKey],
    queryFn: async () => {
      const { data } = await supabase.rpc('exec_db_health_query', {
        query_text: `
          SELECT
            (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'whatsapp_messages') as dead_messages,
            (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'whatsapp_conversations') as dead_conversations,
            (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'support_attendances') as dead_attendances,
            (SELECT count(*) FROM cron.job_run_details) as cron_count,
            (SELECT count(*) FROM public.db_metrics_snapshots WHERE captured_at > now() - interval '24h') as snapshots_today,
            (SELECT max(captured_at) FROM public.db_metrics_snapshots) as last_snapshot,
            (SELECT max(updated_at) FROM public.tenant_daily_metrics) as last_metrics
        `
      });
      return (data as any)?.[0] ?? null;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const { data: todayMetrics } = useQuery({
    queryKey: ['monitor-today', refreshKey, selectedTenant],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_today_metrics' as any, {
        p_tenant_id: selectedTenant !== 'all' ? selectedTenant : null,
      });
      return data as any;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const aiCalls = (t: any) =>
    (t.ai_calls_suggest || 0) +
    (t.ai_calls_compose || 0) +
    (t.ai_calls_sentiment || 0) +
    (t.ai_calls_summary || 0) +
    (t.ai_calls_audio || 0);
  const filteredTenants = selectedTenant === 'all' ? tenantMetrics : tenantMetrics.filter((t: any) => t.tenant_id === selectedTenant);
  const totalMsgs = filteredTenants.reduce(
    (s: number, t: any) => s + (t.messages_sent || 0) + (t.messages_received || 0),
    0,
  );
  const totalAI = filteredTenants.reduce((s: number, t: any) => s + aiCalls(t), 0);
  const filteredInstances = selectedTenant === 'all' ? instances : instances.filter((i: any) => i.tenant_id === selectedTenant);
  const connectedInstances = filteredInstances.filter((i: any) => i.status === 'connected').length;
  const disconnectedInstances = filteredInstances.filter((i: any) => i.status !== 'connected');
  const pendingAlerts = alerts.filter((a: any) => a.status === 'sent' || a.status === 'snoozed').length;

  const latestSnap: any = snapshots[snapshots.length - 1];
  const maxConn = snapshots.length ? Math.max(...snapshots.map((s: any) => s.active_connections || 0)) : 0;
  const peakSnap: any = snapshots.find((s: any) => s.active_connections === maxConn);
  const peakTime = peakSnap
    ? new Date(peakSnap.captured_at).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';
  const connValues = snapshots.map((s: any) => s.active_connections || 0);

  const maxAI = Math.max(...tenantMetrics.map((t: any) => aiCalls(t)), 1);

  const score = Math.max(
    0,
    Math.round(
      100 -
        disconnectedInstances.length * 10 -
        (latestSnap?.top_slow_query_ms > 3000 ? 8 : latestSnap?.top_slow_query_ms > 1000 ? 4 : 0) -
        (latestSnap?.dead_tuples_whatsapp_messages > 2000
          ? 5
          : latestSnap?.dead_tuples_whatsapp_messages > 500
            ? 2
            : 0) -
        pendingAlerts * 2,
    ),
  );
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';

  const checkLabel: Record<string, string> = {
    dead_tuples: 'Dead tuples',
    cron_bloat: 'Log de tarefas',
    query_lenta: 'Query lenta',
    conexoes_ativas: 'Conexões altas',
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      resolved: { label: 'Resolvido', bg: '#dcfce7', color: '#166534' },
      dismissed: { label: 'Ignorado', bg: '#f3f4f6', color: '#6b7280' },
      snoozed: { label: 'Adiado', bg: '#fef9c3', color: '#854d0e' },
      sent: { label: 'Pendente', bg: '#fee2e2', color: '#991b1b' },
    };
    const m = map[s] || map.sent;
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          background: m.bg,
          color: m.color,
        }}
      >
        {m.label}
      </span>
    );
  };

  const panelStyle: React.CSSProperties = {
    background: 'hsl(var(--card))',
    border: '0.5px solid hsl(var(--border))',
    borderRadius: 12,
    padding: '12px 14px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: 'hsl(var(--muted-foreground))',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 8,
  };

  const nowLabel = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: 'hsl(var(--foreground))' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={20} style={{ color: 'hsl(var(--primary))' }} />
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Monitor — DoctorSaaS</h1>
            <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: 0, textTransform: 'capitalize' }}>{nowLabel}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {disconnectedInstances.length > 0 && (
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#fee2e2', color: '#991b1b', fontWeight: 500 }}>
              {disconnectedInstances.length} instância offline
            </span>
          )}
          {pendingAlerts > 0 && (
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', fontWeight: 500 }}>
              {pendingAlerts} alerta pendente
            </span>
          )}
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
            {tenantMetrics.filter((t: any) => (t.messages_sent || 0) > 0).length} tenants ativos
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              background: `${scoreColor}20`,
              color: scoreColor,
              fontWeight: 600,
            }}
          >
            Score {score}/100
          </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { label: 'Hoje', days: 0 },
                  { label: '7d', days: 7 },
                  { label: '30d', days: 30 },
                  { label: '3m', days: 90 },
                  { label: '6m', days: 180 },
                  { label: '12m', days: 365 },
                  { label: 'Tudo', days: -1 },
                ].map(({ label, days }) => {
                  const isActive = (() => {
                    const to = new Date(); to.setDate(to.getDate() - 1);
                    const toStr = to.toISOString().split('T')[0];
                    if (days === 0) return dateFrom === toStr && dateTo === toStr;
                    if (days === -1) return dateFrom === '2020-01-01';
                    const from = new Date(); from.setDate(from.getDate() - days);
                    return dateFrom === from.toISOString().split('T')[0] && dateTo === toStr;
                  })();
                  return (
                    <button
                      key={label}
                      onClick={() => {
                        const to = new Date(); to.setDate(to.getDate() - 1);
                        const toStr = to.toISOString().split('T')[0];
                        if (days === -1) { setDateFrom('2020-01-01'); setDateTo(toStr); }
                        else if (days === 0) { setDateFrom(toStr); setDateTo(toStr); }
                        else {
                          const from = new Date(); from.setDate(from.getDate() - days);
                          setDateFrom(from.toISOString().split('T')[0]);
                          setDateTo(toStr);
                        }
                        setRefreshKey(k => k + 1);
                      }}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                        border: isActive ? '1.5px solid #3b82f6' : '0.5px solid var(--color-border-secondary)',
                        background: isActive ? '#dbeafe' : 'var(--color-background-secondary)',
                        color: isActive ? '#1e40af' : 'var(--color-text-secondary)',
                        fontWeight: isActive ? 500 : 400,
                      }}
                    >{label}</button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setRefreshKey(k => k + 1); }}
                  style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setRefreshKey(k => k + 1); }}
                  style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                />
              </div>
          <select
            value={selectedTenant}
            onChange={e => setSelectedTenant(e.target.value)}
            style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
          >
            <option value="all">Todos os tenants</option>
            {Array.from(new Map(tenantMetrics.map((t: any) => [t.tenant_id, t])).values()).map((t: any) => (
              <option key={t.tenant_id} value={t.tenant_id}>{t.tenants?.nome || t.tenant_id}</option>
            ))}
          </select>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 8,
              border: '0.5px solid hsl(var(--border))',
              background: 'transparent',
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} /> Atualizar
          </button>
        </div>
      </div>

      {/* Linha 1: Score + KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {/* Score */}
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>saúde do sistema</div>
            <HelpTooltip text="Nota de 0 a 100 que resume o estado geral da plataforma. Considera instâncias offline, lentidão, alertas pendentes e uso do banco de dados." />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <ScoreRing score={score} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              { ok: !latestSnap || (latestSnap.top_slow_query_ms || 0) < 1000, label: 'Performance ok' },
              { ok: connectedInstances === filteredInstances.length, label: `${connectedInstances}/${filteredInstances.length} instâncias` },
              { ok: pendingAlerts === 0, label: pendingAlerts === 0 ? 'Sem alertas' : `${pendingAlerts} alertas` },
              { ok: !latestSnap || (latestSnap.dead_tuples_whatsapp_messages || 0) < 500, label: 'Banco limpo' },
              { ok: (latestSnap?.active_connections || 0) < 25, label: 'Conexões ok' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.ok ? '#22c55e' : '#ef4444' }} />
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...panelStyle, borderTop: '2px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>mensagens</div>
            <HelpTooltip text="Total de mensagens enviadas e recebidas por todas as instâncias do WhatsApp. O número grande é o acumulado histórico. 'Hoje' mostra somente o dia atual — atualiza ao clicar em Atualizar." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1 }}>
            {(filteredTenants.reduce((s: number, t: any) => s + (t.messages_sent || 0) + (t.messages_received || 0), 0) + (todayMetrics?.messages_sent ?? 0) + (todayMetrics?.messages_received ?? 0)).toLocaleString('pt-BR')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            total até {todayMetrics?.checked_at ? new Date(todayMetrics.checked_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--'}h
          </div>
          <div style={{ height: '0.5px', background: 'var(--color-border-tertiary)', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Hoje</span>
            <span style={{ fontWeight: 500, color: '#3b82f6' }}>{((todayMetrics?.messages_sent ?? 0) + (todayMetrics?.messages_received ?? 0)).toLocaleString('pt-BR')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>↑ {(todayMetrics?.messages_sent ?? 0)} enviadas</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>↓ {(todayMetrics?.messages_received ?? 0)} recebidas</span>
          </div>
        </div>

        {/* Conversas */}
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>conversas encerradas</div>
            <HelpTooltip text="Quantidade de atendimentos finalizados. 'Abertas' são as que ainda estão em andamento agora." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {filteredTenants.reduce((s: number, t: any) => s + (t.conversations_closed || 0), 0)}
          </div>
          <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0 8px' }}>acumulado histórico</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            <span>Abertas</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {filteredTenants.reduce((s: number, t: any) => s + (t.conversations_opened || 0), 0)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            <span>Operadores</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {filteredTenants.reduce((s: number, t: any) => s + (t.active_operators || 0), 0)}
            </span>
          </div>
        </div>

        <div style={{ ...panelStyle, borderTop: '2px solid #8b5cf6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>chamadas IA</div>
            <HelpTooltip text="Quantas vezes a inteligência artificial foi usada — sugestões de resposta, composição de mensagens, análise de sentimento, resumos e transcrição de áudio." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1 }}>
            {(filteredTenants.reduce((s: number, t: any) => s + aiCalls(t), 0) + (todayMetrics?.ai_calls ?? 0)).toLocaleString('pt-BR')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            total até {todayMetrics?.checked_at ? new Date(todayMetrics.checked_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--'}h
          </div>
          <div style={{ height: '0.5px', background: 'var(--color-border-tertiary)', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Hoje</span>
            <span style={{ fontWeight: 500, color: '#8b5cf6' }}>{(todayMetrics?.ai_calls ?? 0).toLocaleString('pt-BR')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>tenants ativos hoje</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{tenantMetrics.filter((t: any) => aiCalls(t) > 0).length}</span>
          </div>
        </div>

        {/* Instâncias */}
        <div
          style={{
            ...panelStyle,
            borderColor: disconnectedInstances.length > 0 ? '#eab308' : '#22c55e',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>instâncias whatsapp</div>
            <HelpTooltip text="Cada instância é um número de WhatsApp conectado à plataforma. Se uma aparece como OFFLINE, mensagens daquele número não estão sendo entregues." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {disconnectedInstances.length > 0 ? (
              <WifiOff size={14} style={{ color: '#eab308' }} />
            ) : (
              <Wifi size={14} style={{ color: '#22c55e' }} />
            )}
            <span style={{ fontSize: 22, fontWeight: 600 }}>
              {connectedInstances} / {filteredInstances.length}
            </span>
          </div>
          <p
            style={{
              fontSize: 10,
              color: disconnectedInstances.length > 0 ? '#ca8a04' : '#16a34a',
              margin: '2px 0 8px',
              fontWeight: 500,
            }}
          >
            {disconnectedInstances.length > 0 ? `${disconnectedInstances.length} desconectada` : 'todas conectadas'}
          </p>
          {disconnectedInstances.slice(0, 2).map((inst: any, i: number) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: 'hsl(var(--muted-foreground))',
                marginTop: i > 0 ? 2 : 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {inst.instance_name} · {inst.tenants?.nome || ''}
            </div>
          ))}
          {disconnectedInstances.length === 0 && (
            <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: 0 }}>Operação normal</p>
          )}
        </div>
      </div>

      {/* Linha 2: Banco + IA + Tenants */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
        {/* Banco */}
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>banco de dados</div>
            <HelpTooltip text="Saúde técnica do banco. 'Conexões' mostram quantos acessos simultâneos estão acontecendo. 'Query lenta' indica buscas que estão demorando mais que o normal." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
            {[
              { label: 'Pico conexões', value: maxConn ? `${maxConn} · ${peakTime}h` : '—', warn: maxConn >= 30 },
              { label: 'Agora', value: latestSnap?.active_connections ?? '—', warn: false },
              {
                label: 'Query lenta',
                value: latestSnap?.top_slow_query_ms ? `${(latestSnap.top_slow_query_ms / 1000).toFixed(1)}s` : '—',
                warn: (latestSnap?.top_slow_query_ms || 0) > 1000,
              },
            ].map((m, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: m.warn ? '#fef3c7' : 'hsl(var(--muted))',
                }}
              >
                <p style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</p>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 0', color: m.warn ? '#92400e' : 'hsl(var(--foreground))' }}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>
          <div style={{ ...labelStyle, marginBottom: 4 }}>conexões · histórico</div>
          {connValues.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 50 }}>
                {connValues.map((v, i) => {
                  const isPeak = v === maxConn && maxConn > 0;
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: `${Math.max(4, (v / Math.max(maxConn, 1)) * 100)}%`,
                        background: isPeak ? '#ef4444' : '#3b82f6',
                        opacity: isPeak ? 1 : 0.5,
                        borderRadius: 1,
                      }}
                      title={`${v} conexões`}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                <span>início</span>
                {peakTime !== '--' && <span style={{ color: '#ef4444', fontWeight: 600 }}>pico {peakTime}h</span>}
                <span>agora</span>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: 0 }}>Snapshots disponíveis a partir de amanhã</p>
          )}
        </div>

        {/* IA por função */}
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>uso de IA por função</div>
            <HelpTooltip text="Distribuição de como a IA foi usada: sugestões ajudam o atendente a responder, composição cria mensagens automáticas, sentimento analisa o humor do cliente, resumo condensa a conversa e transcrição converte áudios em texto." />
          </div>
          {[
            { label: 'Sugestões', key: 'ai_calls_suggest', color: '#3b82f6' },
            { label: 'Composição', key: 'ai_calls_compose', color: '#8b5cf6' },
            { label: 'Sentimento', key: 'ai_calls_sentiment', color: '#06b6d4' },
            { label: 'Resumo', key: 'ai_calls_summary', color: '#10b981' },
            { label: 'Transcrição', key: 'ai_calls_audio', color: '#f59e0b' },
          ].map((fn) => {
            const total = filteredTenants.reduce((s: number, t: any) => s + ((t as any)[fn.key] || 0), 0);
            return (
              <div key={fn.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', width: 70 }}>{fn.label}</span>
                <MiniBar value={total} max={Math.max(totalAI, 1)} color={fn.color} />
                <span style={{ fontSize: 10, fontWeight: 600, width: 36, textAlign: 'right' }}>{total}</span>
              </div>
            );
          })}
          <div style={{ ...labelStyle, marginTop: 12 }}>por tenant</div>
          {filteredTenants
            .filter((t: any) => aiCalls(t) > 0)
            .map((t: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    color: 'hsl(var(--muted-foreground))',
                    width: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {(t as any).tenants?.nome || t.tenant_id}
                </span>
                <MiniBar value={aiCalls(t)} max={maxAI} color="#8b5cf6" />
                <span style={{ fontSize: 10, fontWeight: 600, width: 36, textAlign: 'right' }}>{aiCalls(t)}</span>
              </div>
            ))}
        </div>

        {/* Tenants + Instâncias */}
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>tenants</div>
            <HelpTooltip text="Cada tenant é uma empresa usando a plataforma. Mostra o volume de mensagens e uso de IA por empresa. 'Sem atividade' significa que a empresa não teve movimentação no período." />
          </div>
          {filteredTenants.map((t: any, i: number) => {
            const active = (t.messages_sent || 0) + (t.messages_received || 0) > 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid hsl(var(--border))' }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: 'hsl(var(--primary) / 0.1)',
                    color: 'hsl(var(--primary))',
                    fontSize: 10,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {((t as any).tenants?.nome || '?').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(t as any).tenants?.nome || t.tenant_id}
                  </p>
                  <p style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
                    {t.whatsapp_instances_connected}/{t.whatsapp_instances_total} instâncias
                  </p>
                </div>
                {active ? (
                  <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 600, margin: 0 }}>
                        {((t.messages_sent || 0) + (t.messages_received || 0)).toLocaleString('pt-BR')}
                      </p>
                      <p style={{ color: 'hsl(var(--muted-foreground))', margin: 0, fontSize: 9 }}>msgs</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 600, margin: 0 }}>{aiCalls(t)}</p>
                      <p style={{ color: 'hsl(var(--muted-foreground))', margin: 0, fontSize: 9 }}>IA</p>
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>sem atividade</span>
                )}
              </div>
            );
          })}
          <div style={{ ...labelStyle, marginTop: 12 }}>instâncias whatsapp</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {instances.map((inst: any, i: number) => {
              const ok = inst.status === 'connected';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: ok ? 'hsl(var(--muted))' : '#fee2e2',
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inst.instance_name}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: ok ? '#16a34a' : '#991b1b' }}>{ok ? 'ok' : 'OFFLINE'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Linha 3: Falhas + Alertas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>falhas e ocorrências</div>
            <HelpTooltip text="Problemas que aconteceram nas últimas 24 horas — instâncias que ficaram offline, erros de conexão ou falhas no sistema. Itens em andamento ainda não foram resolvidos." />
          </div>
          {instanceLog.length === 0 && alerts.filter((a: any) => a.level === 'critical').length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#16a34a', padding: '6px 0' }}>
              <CheckCircle size={12} /> Nenhuma falha registrada nas últimas 24h
            </div>
          )}
          {instanceLog.map((log: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0, marginTop: 4, animation: 'pulse 2s infinite' }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>Instância offline — {log.instance_name}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 500 }}>em andamento</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  Mensagens não entregues. Reconectar o WhatsApp vinculado a esta instância.
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: '#fee2e2', color: '#991b1b' }}>WhatsApp</span>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)' }}>{log.tenant_nome}</span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                    offline desde {log.first_seen ? new Date(log.first_seen).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--'}h
                  </span>
                </div>
              </div>
            </div>
          ))}
          {alerts
            .filter((a: any) => a.level === 'critical')
            .slice(0, 3)
            .map((alert: any, i: number) => (
              <div key={`al-${i}`} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '0.5px solid hsl(var(--border))' }}>
                <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{checkLabel[alert.check_name] || alert.check_name}</p>
                  <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0' }}>{alert.diagnosis}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>
                    {statusBadge(alert.status)}
                    <span>
                      {new Date(alert.sent_at).toLocaleTimeString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}h
                    </span>
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div style={{ ...panelStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>histórico de alertas</div>
            <HelpTooltip text="Alertas enviados via WhatsApp sobre a saúde do banco de dados. Mostra se cada alerta foi resolvido, ignorado ou está pendente." />
          </div>
          {alerts.length === 0 && <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: 0 }}>Nenhum alerta nas últimas 24h</p>}
          {alerts.map((alert: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '0.5px solid hsl(var(--border))' }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: alert.level === 'critical' ? '#ef4444' : '#eab308',
                  flexShrink: 0,
                  marginTop: 6,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 500, margin: 0 }}>{checkLabel[alert.check_name] || alert.check_name}</p>
                <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {alert.diagnosis}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'hsl(var(--muted-foreground))', flexWrap: 'wrap' }}>
                  {statusBadge(alert.status)}
                  {alert.response && <span>via {alert.response}</span>}
                  <span>
                    {new Date(alert.sent_at).toLocaleTimeString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}h
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...panelStyle, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 0 }}>manutenção</div>
          <HelpTooltip text="Tarefas de limpeza e otimização do banco. A barra mostra o nível de acúmulo — verde é saudável, amarelo recomenda atenção, vermelho precisa limpar. Clique em 'Executar agora' quando necessário." />
        </div>
        {actionResult && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: actionResult.ok ? '#dcfce7' : '#fee2e2', color: actionResult.ok ? '#166534' : '#991b1b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{actionResult.ok ? '✅' : '❌'}</span>
            <div>
              <div style={{ fontWeight: 500 }}>{actionResult.ok ? 'Concluído!' : 'Não foi possível executar'}</div>
              <div style={{ opacity: 0.8, marginTop: 1 }}>{actionResult.label}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {(() => {
            const md = maintenanceData as any;
            const deadMsg = md?.dead_messages ?? 0;
            const deadConv = md?.dead_conversations ?? 0;
            const deadAtt = md?.dead_attendances ?? 0;
            const cronCount = parseInt(md?.cron_count ?? '0');
            const snapshotsToday = parseInt(md?.snapshots_today ?? '0');
            const lastSnapshot = md?.last_snapshot ? new Date(md.last_snapshot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--';
            const lastMetrics = md?.last_metrics ? new Date(md.last_metrics).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--';
            const pct = (val: number, max: number) => Math.min(100, Math.round((val / max) * 100));
            const barColor = (p: number) => p >= 70 ? '#ef4444' : p >= 30 ? '#eab308' : '#22c55e';
            const badge = (p: number) => p >= 70 ? { label: 'crítico', bg: '#fee2e2', color: '#991b1b' } : p >= 30 ? { label: 'atenção', bg: '#fef9c3', color: '#854d0e' } : { label: 'ok', bg: '#dcfce7', color: '#166534' };
            const trashOpacity = (p: number) => 0.2 + (p / 100) * 0.8;
            const cardStyle: React.CSSProperties = { background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 12, padding: '14px' };
            const btnStyle = (enabled: boolean): React.CSSProperties => ({
              width: '100%', marginTop: 10, padding: '8px 10px', borderRadius: 8,
              border: '0.5px solid var(--color-border-secondary)',
              background: enabled ? 'var(--color-background-primary)' : 'var(--color-background-secondary)',
              color: enabled ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontSize: 12, cursor: enabled ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: actionLoading !== null ? 0.6 : 1,
            });
            const MainCard = ({ action, label, desc, icon, value, max, lastRun, alwaysEnabled, tooltip, inverted }: any) => {
              const p = pct(value, max);
              const b = inverted
                ? (p >= 80 ? { label: 'ótimo', bg: '#dcfce7', color: '#166534' } : p >= 40 ? { label: 'ok', bg: '#dcfce7', color: '#166534' } : { label: 'incompleto', bg: '#fef9c3', color: '#854d0e' })
                : badge(p);
              const enabled = alwaysEnabled || p >= 30;
              return (
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 1 }}>{desc}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500, background: b.bg, color: b.color }}>{b.label}</span>
                      {tooltip && <HelpTooltip text={tooltip} />}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 24, margin: '6px 0', opacity: typeof value === 'number' ? trashOpacity(p) : 1 }}>{icon}</div>
                  <div style={{ height: 7, background: 'var(--color-border-tertiary)', borderRadius: 4, overflow: 'hidden', margin: '8px 0 4px' }}>
                    <div style={{ height: '100%', width: `${typeof value === 'number' ? p : 100}%`, background: inverted ? '#22c55e' : barColor(typeof value === 'number' ? p : 0), borderRadius: 4, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{typeof value === 'number' ? value.toLocaleString('pt-BR') + ' registros' : value}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>limite {max.toLocaleString('pt-BR')}</span>
                  </div>
                  <div style={{ fontSize: 10, textAlign: 'center', margin: '3px 0 6px', color: inverted ? '#16a34a' : barColor(typeof value === 'number' ? p : 0), fontWeight: 500 }}>
                    {typeof value === 'number'
                      ? inverted
                        ? `${p}% coletado · ${p >= 80 ? 'tudo em dia' : p >= 40 ? 'coletando normalmente' : 'poucos dados ainda'}`
                        : `${p}% · ${p >= 70 ? 'limpar agora!' : p >= 30 ? 'recomendado limpar' : 'saudável'}`
                      : lastRun}
                  </div>
                  <button
                    style={btnStyle(enabled)}
                    disabled={!enabled || actionLoading !== null}
                    onClick={() => enabled && runDbAction(action, label).then(() => refetchMaintenance())}
                  >
                    {actionLoading === action ? '⏳' : enabled ? `${icon} Executar agora` : '✅ Sem necessidade agora'}
                  </button>
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: 5 }}>{lastRun}</div>
                </div>
              );
            };
            return (
              <>
                <MainCard action="vacuum_messages" label="Otimizar chat" desc="Registros obsoletos · whatsapp_messages" icon="🗑️" value={deadMsg} max={2000} lastRun="automático via autovacuum" tooltip="Registros 'fantasma' acumulam no banco quando mensagens são atualizadas ou deletadas. Quando a barra fica vermelha, o sistema começa a ficar mais lento. Clique em Executar para limpar." />
                <MainCard action="vacuum_conversations" label="Otimizar conversas" desc="Registros obsoletos · whatsapp_conversations" icon="🗑️" value={deadConv} max={2000} lastRun="automático via autovacuum" tooltip="Mesmo processo da limpeza do chat, mas para a tabela de conversas. Saudável quando abaixo de 30%." />
                <MainCard action="vacuum_attendances" label="Otimizar atendimentos" desc="Registros obsoletos · support_attendances" icon="🗑️" value={deadAtt} max={2000} lastRun="automático via autovacuum" tooltip="Limpeza da tabela de atendimentos. Normalmente fica baixo pois há menos movimentação." />
                <MainCard action="clean_cron" label="Limpar histórico" desc="Log de tarefas · cron.job_run_details" icon="🗑️" value={cronCount} max={15000} lastRun="limpeza automática: diária às 03h" tooltip="O sistema registra cada tarefa automática executada. Com o tempo esse log cresce. A limpeza é automática toda madrugada, mas você pode forçar agora se necessário." />
                <MainCard action="collect_snapshot" label="Métricas do banco" desc={`${snapshotsToday} snapshots coletados hoje`} icon="📊" value={snapshotsToday} max={288} lastRun={`automático · último: ${lastSnapshot}h`} alwaysEnabled inverted tooltip="Coleta dados do banco a cada 5 minutos para alimentar os gráficos do dashboard. Clique para forçar uma coleta agora e ver os dados mais recentes." />
                <MainCard action="collect_metrics" label="Métricas por tenant" desc="Consolidado diário de uso" icon="🔄" value={4} max={4} lastRun={`automático · última: ${lastMetrics}h`} alwaysEnabled inverted tooltip="Consolida os dados de uso de cada empresa (mensagens, IA, conversas) para o relatório diário. Roda automaticamente às 01h, mas você pode forçar agora." />
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
