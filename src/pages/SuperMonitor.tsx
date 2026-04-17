import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, Activity, MessageSquare, Bot, Database } from 'lucide-react';

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

export default function SuperMonitor() {
  const [refreshKey, setRefreshKey] = useState(0);
  const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false };
  const now = new Date();
  const sp = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  sp.setDate(sp.getDate() - 1);
  const yesterday = sp.toISOString().split('T')[0];
  const since24h = new Date(Date.now() - 86400000).toISOString();

  const { data: tenantMetrics = [] } = useQuery({
    queryKey: ['monitor-tenant-metrics', yesterday, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('tenant_daily_metrics')
        .select('*, tenants(nome)')
        .gte('metric_date', yesterday)
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
      const { data } = await (supabase as any)
        .from('whatsapp_instance_status_log')
        .select('*, tenants(nome)')
        .gte('captured_at', since24h)
        .eq('status', 'disconnected')
        .order('captured_at', { ascending: false })
        .limit(10);
      return data ?? [];
    },
    ...opts,
  });

  const aiCalls = (t: any) =>
    (t.ai_calls_suggest || 0) +
    (t.ai_calls_compose || 0) +
    (t.ai_calls_sentiment || 0) +
    (t.ai_calls_summary || 0) +
    (t.ai_calls_audio || 0);
  const totalMsgs = tenantMetrics.reduce(
    (s: number, t: any) => s + (t.messages_sent || 0) + (t.messages_received || 0),
    0,
  );
  const totalAI = tenantMetrics.reduce((s: number, t: any) => s + aiCalls(t), 0);
  const connectedInstances = instances.filter((i: any) => i.status === 'connected').length;
  const disconnectedInstances = instances.filter((i: any) => i.status !== 'connected');
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

  const now = new Date().toLocaleString('pt-BR', {
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
            <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: 0, textTransform: 'capitalize' }}>{now}</p>
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
        <div style={panelStyle}>
          <div style={labelStyle}>saúde do sistema</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <ScoreRing score={score} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              { ok: !latestSnap || (latestSnap.top_slow_query_ms || 0) < 1000, label: 'Performance ok' },
              { ok: connectedInstances === instances.length, label: `${connectedInstances}/${instances.length} instâncias` },
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

        {/* Mensagens */}
        <div style={panelStyle}>
          <div style={labelStyle}>mensagens ontem</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageSquare size={14} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: 22, fontWeight: 600 }}>{totalMsgs.toLocaleString('pt-BR')}</span>
          </div>
          <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0 8px' }}>todas as instâncias</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            <span>Enviadas</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {tenantMetrics.reduce((s: number, t: any) => s + (t.messages_sent || 0), 0).toLocaleString('pt-BR')}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            <span>Recebidas</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {tenantMetrics.reduce((s: number, t: any) => s + (t.messages_received || 0), 0).toLocaleString('pt-BR')}
            </span>
          </div>
        </div>

        {/* Conversas */}
        <div style={panelStyle}>
          <div style={labelStyle}>conversas ontem</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {tenantMetrics.reduce((s: number, t: any) => s + (t.conversations_closed || 0), 0)}
          </div>
          <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0 8px' }}>encerradas</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            <span>Abertas</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {tenantMetrics.reduce((s: number, t: any) => s + (t.conversations_opened || 0), 0)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            <span>Operadores</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {tenantMetrics.reduce((s: number, t: any) => s + (t.active_operators || 0), 0)}
            </span>
          </div>
        </div>

        {/* IA */}
        <div style={panelStyle}>
          <div style={labelStyle}>chamadas IA ontem</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bot size={14} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 22, fontWeight: 600 }}>{totalAI.toLocaleString('pt-BR')}</span>
          </div>
          <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0 8px' }}>todas as funções</p>
          {tenantMetrics.slice(0, 2).map((t: any, i: number) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
                color: 'hsl(var(--muted-foreground))',
                marginTop: i > 0 ? 3 : 0,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {(t as any).tenants?.nome || t.tenant_id}
              </span>
              <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>{aiCalls(t)}</span>
            </div>
          ))}
        </div>

        {/* Instâncias */}
        <div
          style={{
            ...panelStyle,
            borderColor: disconnectedInstances.length > 0 ? '#eab308' : '#22c55e',
          }}
        >
          <div style={labelStyle}>instâncias whatsapp</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {disconnectedInstances.length > 0 ? (
              <WifiOff size={14} style={{ color: '#eab308' }} />
            ) : (
              <Wifi size={14} style={{ color: '#22c55e' }} />
            )}
            <span style={{ fontSize: 22, fontWeight: 600 }}>
              {connectedInstances} / {instances.length}
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
        <div style={panelStyle}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database size={11} /> banco de dados · snapshots do dia
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
        <div style={panelStyle}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bot size={11} /> uso de IA por função · ontem
          </div>
          {[
            { label: 'Sugestões', key: 'ai_calls_suggest', color: '#3b82f6' },
            { label: 'Composição', key: 'ai_calls_compose', color: '#8b5cf6' },
            { label: 'Sentimento', key: 'ai_calls_sentiment', color: '#06b6d4' },
            { label: 'Resumo', key: 'ai_calls_summary', color: '#10b981' },
            { label: 'Transcrição', key: 'ai_calls_audio', color: '#f59e0b' },
          ].map((fn) => {
            const total = tenantMetrics.reduce((s: number, t: any) => s + ((t as any)[fn.key] || 0), 0);
            return (
              <div key={fn.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', width: 70 }}>{fn.label}</span>
                <MiniBar value={total} max={Math.max(totalAI, 1)} color={fn.color} />
                <span style={{ fontSize: 10, fontWeight: 600, width: 36, textAlign: 'right' }}>{total}</span>
              </div>
            );
          })}
          <div style={{ ...labelStyle, marginTop: 12 }}>por tenant</div>
          {tenantMetrics
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
        <div style={panelStyle}>
          <div style={labelStyle}>tenants · ontem</div>
          {tenantMetrics.map((t: any, i: number) => {
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
        <div style={panelStyle}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={11} /> falhas e ocorrências · últimas 24h
          </div>
          {instanceLog.length === 0 && alerts.filter((a: any) => a.level === 'critical').length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#16a34a', padding: '6px 0' }}>
              <CheckCircle size={12} /> Nenhuma falha registrada nas últimas 24h
            </div>
          )}
          {instanceLog.map((log: any, i: number) => (
            <div key={`il-${i}`} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '0.5px solid hsl(var(--border))' }}>
              <WifiOff size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Instância desconectada — {log.instance_name}</p>
                <p style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', margin: '2px 0' }}>
                  Mensagens não entregues durante o período. Reconectar no painel.
                </p>
                <div style={{ display: 'flex', gap: 6, fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>
                  <span style={{ padding: '1px 5px', borderRadius: 3, background: 'hsl(var(--muted))' }}>WhatsApp</span>
                  <span>{log.tenants?.nome || log.tenant_id}</span>
                  <span>
                    {new Date(log.captured_at).toLocaleTimeString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}h
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

        <div style={panelStyle}>
          <div style={labelStyle}>histórico de alertas · últimas 24h</div>
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
    </div>
  );
}
