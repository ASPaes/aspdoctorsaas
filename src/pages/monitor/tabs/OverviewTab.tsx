import { useMonitorData } from '../hooks/useMonitorData';
import { ScoreRing } from '../shared/ScoreRing';
import { Sparkline } from '../shared/Sparkline';

interface OverviewTabProps {
  queryDateFrom: string;
  queryDateTo: string;
  selectedTenant: string;
  refreshKey: number;
  onDrillDown?: () => void;
}

export function OverviewTab({ queryDateFrom, queryDateTo, selectedTenant, refreshKey, onDrillDown }: OverviewTabProps) {
  const { tenantMetrics, instances, snapshots, todayMetrics, aiCostMetrics, storageMetrics } = useMonitorData({
    queryDateFrom, queryDateTo, selectedTenant, refreshKey,
  });

  const filtered = selectedTenant === 'all' ? tenantMetrics : tenantMetrics.filter((t: any) => t.tenant_id === selectedTenant);
  const totalMsgs = filtered.reduce((s: number, t: any) => s + (t.messages_sent || 0) + (t.messages_received || 0), 0) + (todayMetrics?.messages_total ?? 0);
  const totalConvs = filtered.reduce((s: number, t: any) => s + (t.conversations_closed || 0), 0);
  const totalOps = filtered.reduce((s: number, t: any) => s + (t.active_operators || 0), 0);
  const totalAI = filtered.reduce((s: number, t: any) => s + ((t.ai_calls_suggest||0)+(t.ai_calls_compose||0)+(t.ai_calls_sentiment||0)+(t.ai_calls_summary||0)+(t.ai_calls_audio||0)), 0) + (todayMetrics?.ai_calls ?? 0);
  const activeTenants = new Set(filtered.filter((t: any) => (t.messages_sent || 0) + (t.messages_received || 0) > 0).map((t: any) => t.tenant_id)).size;
  const connectedInst = instances.filter((i: any) => i.status === 'connected').length;
  const totalInst = instances.length;
  const aiCost = Number(aiCostMetrics?.total_cost_usd ?? 0);
  const storageCost = Number(storageMetrics?.estimated_cost_usd ?? 0);
  const storageGb = Number(storageMetrics?.total_gb ?? 0);
  const storagePct = Number(storageMetrics?.usage_pct ?? 0);
  const latestSnapshot = snapshots[snapshots.length - 1] as any;
  const activeQueries = latestSnapshot?.active_connections ?? 0;
  const slowQueryMs = latestSnapshot?.longest_query_duration_ms ?? 0;
  const score = Math.max(0, Math.min(100, 100 - (totalInst - connectedInst) * 10 - Math.max(0, storagePct - 50)));
  interface Alert {
    severity: 'critical' | 'warning' | 'info';
    icon: string;
    message: string;
  }
  const alerts: Alert[] = [];
  const offlineInst = totalInst - connectedInst;
  if (offlineInst > 0) alerts.push({ severity: 'critical', icon: '●', message: `${offlineInst} ${offlineInst === 1 ? 'instância' : 'instâncias'} WhatsApp offline` });
  if (storagePct > 80) alerts.push({ severity: 'critical', icon: '⚠', message: `Storage em ${storagePct.toFixed(1)}% — próximo do limite` });
  else if (storagePct > 60) alerts.push({ severity: 'warning', icon: '⚠', message: `Storage em ${storagePct.toFixed(1)}% — monitorar` });
  const orphans = Number((storageMetrics as any)?.warnings?.orphans_count ?? 0);
  if (orphans > 0) alerts.push({ severity: 'info', icon: 'ⓘ', message: `${orphans} ${orphans === 1 ? 'arquivo órfão' : 'arquivos órfãos'} no storage` });
  const largeFiles = Number((storageMetrics as any)?.warnings?.large_files_count ?? 0);
  if (largeFiles > 0) alerts.push({ severity: 'info', icon: 'ⓘ', message: `${largeFiles} arquivos grandes (>10MB)` });
  if (slowQueryMs > 5000) alerts.push({ severity: 'warning', icon: '⚠', message: `Query mais lenta em ${(slowQueryMs/1000).toFixed(1)}s` });
  const alertColors = {
    critical: { bg: '#fee2e2', text: '#991b1b' },
    warning: { bg: '#fef3c7', text: '#92400e' },
    info: { bg: '#dbeafe', text: '#1e40af' },
  };
  const sparkValues = snapshots.slice(-20).map((s: any) => s.active_connections || 0);

  const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 4 };
  const kpiCard = (onClick?: () => void): React.CSSProperties => ({
    background: 'var(--color-background-secondary)', borderRadius: 8, padding: 12,
    cursor: onClick ? 'pointer' : 'default', border: '0.5px solid transparent',
    transition: 'border-color 150ms',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, background: 'var(--color-background-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 2 }}>
            Alertas ativos ({alerts.length})
          </div>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: alertColors[a.severity].bg, color: alertColors[a.severity].text, borderRadius: 6, fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>{a.icon}</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
      {alerts.length === 0 && (
        <div style={{ padding: 10, background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>✓</span>
          <span>Tudo funcionando normalmente — nenhum alerta ativo</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr', gap: 12 }}>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={labelStyle}>Saúde da Plataforma</div>
          <ScoreRing score={score} />
        </div>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14 }}>
          <div style={labelStyle}>Atividade agora</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Conversas</span>
            <span style={{ fontWeight: 500 }}>{totalConvs}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Operadores</span>
            <span style={{ fontWeight: 500 }}>{totalOps}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Queries ativas</span>
            <span style={{ fontWeight: 500 }}>{activeQueries}</span>
          </div>
        </div>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 14 }}>
          <div style={labelStyle}>Tendência 24h</div>
          <Sparkline values={sparkValues.length > 0 ? sparkValues : [1, 1]} color="#3b82f6" />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 4 }}>KPIs principais · clique para ver detalhes</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Mensagens</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{totalMsgs.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{(todayMetrics?.messages_total ?? 0).toLocaleString('pt-BR')} hoje</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>IA</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{totalAI.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: '#16a34a' }}>${aiCost.toFixed(2)}</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Storage</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{storageGb.toFixed(2)} GB</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>de 100 GB · {storagePct.toFixed(1)}%</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Banco</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{slowQueryMs > 0 ? `${(slowQueryMs/1000).toFixed(1)}s` : 'OK'}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>query mais lenta</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Tenants</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{activeTenants}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>ativos</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Instâncias</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{connectedInst}/{totalInst}</div>
          <div style={{ fontSize: 10, color: connectedInst < totalInst ? '#dc2626' : 'var(--color-text-secondary)' }}>conectadas</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Conversas</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{totalConvs.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>encerradas</div>
        </div>
        <div style={kpiCard(onDrillDown)} onClick={onDrillDown}>
          <div style={labelStyle}>Custo Total</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>${(aiCost + storageCost).toFixed(2)}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>mês atual</div>
        </div>
      </div>
    </div>
  );
}
