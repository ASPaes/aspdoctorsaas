import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { HelpTooltip } from '../shared/HelpTooltip';

const panelStyle: React.CSSProperties = {
  background: 'var(--color-background-secondary)',
  borderRadius: 8,
  padding: 14,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  marginBottom: 6,
};

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    critical: { bg: '#fee2e2', color: '#991b1b', label: 'CRÍTICO' },
    warning: { bg: '#fef3c7', color: '#92400e', label: 'ATENÇÃO' },
    attention: { bg: '#fef9c3', color: '#854d0e', label: 'OBSERVAR' },
    ok: { bg: '#dcfce7', color: '#166534', label: 'OK' },
  };
  const c = config[severity] || config.ok;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

function StorageProjectionPanel() {
  const { data } = useQuery({
    queryKey: ['monitor-storage-projection'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_storage_projection' as any);
      return data as any;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (!data) return <div style={panelStyle}>Carregando projeção de storage...</div>;

  const history = (data.history as any[]) || [];
  const proj30 = Number(data.projection_30d_gb) * 1024;
  const proj90 = Number(data.projection_90d_gb) * 1024;
  const allValues = [...history.map((h: any) => Number(h.mb)), proj30, proj90];
  const maxVal = Math.max(...allValues, 1);
  const width = 560;
  const height = 80;
  const histX = (i: number) => (i / (history.length + 9)) * width;
  const projX = (d: number) => ((history.length - 1 + d) / (history.length + 9)) * width;
  const yFn = (v: number) => height - (v / maxVal) * (height - 8) - 4;
  const histPath = history.map((h: any, i: number) => `${i === 0 ? 'M' : 'L'} ${histX(i)} ${yFn(Number(h.mb))}`).join(' ');
  const lastMb = history.length > 0 ? Number(history[history.length - 1].mb) : 0;
  const projPath = history.length > 0
    ? `M ${histX(history.length - 1)} ${yFn(lastMb)} L ${projX(3)} ${yFn(proj30)} L ${projX(9)} ${yFn(proj90)}`
    : '';

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Projeção · Storage</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityBadge severity={data.severity} />
          <HelpTooltip text="Projeção baseada em regressão linear dos últimos 30 dias. Mostra quanto storage será consumido em 30, 90 e 365 dias. O ETA estima quando atingirá o limite de 100 GB do plano Pro." />
        </div>
      </div>

      {history.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
            <path d={histPath} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
            {projPath && <path d={projPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,3" />}
            {history.length > 0 && <circle cx={histX(history.length - 1)} cy={yFn(lastMb)} r="3" fill="#3b82f6" />}
            <circle cx={projX(9)} cy={yFn(proj90)} r="3" fill="#f59e0b" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            <span>30 dias atrás</span>
            <span style={{ color: '#3b82f6' }}>● hoje</span>
            <span style={{ color: '#f59e0b' }}>◌ +90 dias</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>+{Number(data.slope_mb_per_day ?? 0).toFixed(1)} MB</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>por dia · média últimos 30 dias</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
        <div style={{ padding: 8, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)' }}>em 30 dias</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{Number(data.projection_30d_gb).toFixed(2)} GB</div>
        </div>
        <div style={{ padding: 8, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)' }}>em 90 dias</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{Number(data.projection_90d_gb).toFixed(2)} GB</div>
        </div>
        <div style={{ padding: 8, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)' }}>em 1 ano</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{Number(data.projection_365d_gb).toFixed(2)} GB</div>
        </div>
      </div>

      {data.days_until_limit && (
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6, marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginBottom: 2 }}>ETA até o limite de 100 GB</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{Number(data.days_until_limit).toLocaleString('pt-BR')} dias</span>
            {data.eta_date && (
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                ({new Date(data.eta_date).toLocaleDateString('pt-BR')})
              </span>
            )}
          </div>
        </div>
      )}

      {data.cost_projection && (
        <>
          <div style={labelStyle}>Custo estimado</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Hoje</span>
            <span style={{ fontWeight: 500 }}>${Number(data.cost_projection.current_monthly_usd).toFixed(2)}/mês</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Em 30 dias</span>
            <span style={{ fontWeight: 500, color: '#f59e0b' }}>${Number(data.cost_projection.projection_30d_monthly_usd).toFixed(2)}/mês</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Em 90 dias</span>
            <span style={{ fontWeight: 500, color: '#f59e0b' }}>${Number(data.cost_projection.projection_90d_monthly_usd).toFixed(2)}/mês</span>
          </div>
        </>
      )}
    </div>
  );
}

export function ProjectionsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StorageProjectionPanel />
      <div style={{ ...panelStyle, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 12, padding: 24 }}>
        Em breve: projeções de Banco de Dados, IA, Mensagens e Crescimento de Tenants
      </div>
    </div>
  );
}
