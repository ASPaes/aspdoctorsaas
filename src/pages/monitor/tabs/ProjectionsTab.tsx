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
    no_data: { bg: '#e0e7ff', color: '#3730a3', label: 'SEM HISTÓRICO' },
  };
  const c = config[severity] || config.ok;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

function ProjectionChart({ history, proj30, proj90 }: { history: any[]; proj30: number; proj90: number }) {
  if (history.length === 0) return null;
  const allValues = [...history.map((h: any) => Number(h.mb)), proj30, proj90];
  const maxVal = Math.max(...allValues, 1);
  const width = 560;
  const height = 80;
  const histX = (i: number) => (i / (history.length + 9)) * width;
  const projX = (d: number) => ((history.length - 1 + d) / (history.length + 9)) * width;
  const yFn = (v: number) => height - (v / maxVal) * (height - 8) - 4;
  const histPath = history.map((h: any, i: number) => `${i === 0 ? 'M' : 'L'} ${histX(i)} ${yFn(Number(h.mb))}`).join(' ');
  const lastMb = Number(history[history.length - 1].mb);
  const projPath = `M ${histX(history.length - 1)} ${yFn(lastMb)} L ${projX(3)} ${yFn(proj30)} L ${projX(9)} ${yFn(proj90)}`;

  return (
    <div style={{ marginBottom: 12 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        <path d={histPath} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
        <path d={projPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,3" />
        <circle cx={histX(history.length - 1)} cy={yFn(lastMb)} r="3" fill="#3b82f6" />
        <circle cx={projX(9)} cy={yFn(proj90)} r="3" fill="#f59e0b" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 4 }}>
        <span>30 dias atrás</span>
        <span style={{ color: '#3b82f6' }}>● hoje</span>
        <span style={{ color: '#f59e0b' }}>◌ +90 dias</span>
      </div>
    </div>
  );
}

function AIChart({ history }: { history: any[] }) {
  if (history.length === 0) return null;
  const values = history.map((h: any) => Number(h.cost_usd));
  const maxVal = Math.max(...values, 0.01);
  const width = 560;
  const height = 80;
  const xFn = (i: number) => (i / Math.max(history.length - 1, 1)) * width;
  const yFn = (v: number) => height - (v / maxVal) * (height - 8) - 4;
  const path = history.map((h: any, i: number) => `${i === 0 ? 'M' : 'L'} ${xFn(i)} ${yFn(Number(h.cost_usd))}`).join(' ');

  return (
    <div style={{ marginBottom: 12 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        <path d={path} fill="none" stroke="#8b5cf6" strokeWidth="1.5" />
        {history.map((h: any, i: number) => (
          <circle key={i} cx={xFn(i)} cy={yFn(Number(h.cost_usd))} r="2" fill="#8b5cf6" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 4 }}>
        <span>{history[0]?.date ? new Date(history[0].date).toLocaleDateString('pt-BR') : ''}</span>
        <span>{history[history.length - 1]?.date ? new Date(history[history.length - 1].date).toLocaleDateString('pt-BR') : ''}</span>
      </div>
    </div>
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

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Projeção · Storage</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityBadge severity={data.severity} />
          <HelpTooltip text="Projeção baseada em regressão linear dos últimos 30 dias. Mostra quanto storage será consumido em 30, 90 e 365 dias. O ETA estima quando atingirá o limite de 100 GB do plano Pro." />
        </div>
      </div>

      <ProjectionChart
        history={(data.history as any[]) || []}
        proj30={Number(data.projection_30d_gb) * 1024}
        proj90={Number(data.projection_90d_gb) * 1024}
      />

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

function DatabaseProjectionPanel() {
  const { data } = useQuery({
    queryKey: ['monitor-database-projection'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_database_projection' as any);
      return data as any;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (!data) return <div style={panelStyle}>Carregando projeção de banco...</div>;

  const hasHistory = data.has_history === true;
  const topTables = (data.top_tables as any[]) || [];
  const maxTableSize = topTables.length > 0 ? Math.max(...topTables.map((t: any) => Number(t.size_mb))) : 1;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Projeção · Banco de Dados</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityBadge severity={data.severity} />
          <HelpTooltip text="Tamanho total do banco PostgreSQL e sua projeção de crescimento. O limite do plano Pro é 8 GB. A coleta é feita a cada 5 minutos via pg_cron — a projeção precisa de alguns dias de histórico para ser confiável." />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 500 }}>
          {Number(data.current_gb) >= 1 ? `${Number(data.current_gb).toFixed(2)} GB` : `${Number(data.current_mb).toFixed(0)} MB`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          / {data.limit_gb} GB ({Number(data.usage_pct).toFixed(2)}%)
        </span>
      </div>

      <div style={{ height: 6, background: 'var(--color-border-tertiary)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          width: `${Math.min(Number(data.usage_pct), 100)}%`,
          height: '100%',
          background: Number(data.usage_pct) > 80 ? '#dc2626' : Number(data.usage_pct) > 60 ? '#f59e0b' : '#16a34a',
          borderRadius: 3,
        }} />
      </div>

      {hasHistory ? (
        <>
          <ProjectionChart
            history={(data.history as any[]) || []}
            proj30={Number(data.projection_30d_gb) * 1024}
            proj90={Number(data.projection_90d_gb) * 1024}
          />

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 500 }}>+{Number(data.slope_mb_per_day ?? 0).toFixed(2)} MB</span>
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>por dia · média últimos {data.history_days} dias</span>
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
              <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginBottom: 2 }}>ETA até o limite de 8 GB</div>
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
        </>
      ) : (
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6, marginBottom: 10, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Coletando histórico. A projeção ficará disponível após alguns dias de coletas automáticas.
        </div>
      )}

      {topTables.length > 0 && (
        <>
          <div style={labelStyle}>Top 10 tabelas por tamanho</div>
          {topTables.map((t: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {t.name}
              </span>
              <div style={{ flex: 1, height: 4, background: 'var(--color-border-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(Number(t.size_mb) / maxTableSize) * 100}%`, height: '100%', background: '#8b5cf6', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 70, textAlign: 'right', flexShrink: 0 }}>
                {Number(t.rows).toLocaleString('pt-BR')} rows
              </span>
              <span style={{ fontSize: 10, fontWeight: 500, width: 56, textAlign: 'right', flexShrink: 0 }}>
                {Number(t.size_mb) >= 1024 ? `${(Number(t.size_mb)/1024).toFixed(1)}GB` : `${Number(t.size_mb).toFixed(1)}MB`}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AIProjectionPanel() {
  const { data } = useQuery({
    queryKey: ['monitor-ai-projection'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_ai_projection' as any);
      return data as any;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (!data) return <div style={panelStyle}>Carregando projeção de IA...</div>;

  const hasHistory = data.has_history === true;
  const byFunction = (data.by_function as any[]) || [];
  const byTenant = (data.by_tenant as any[]) || [];
  const mtdPct = Number(data.days_in_month) > 0 ? (Number(data.days_elapsed_mtd) / Number(data.days_in_month)) * 100 : 0;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Projeção · Custo de IA</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityBadge severity={data.severity} />
          <HelpTooltip text="Projeção de custo mensal de IA baseada na média diária dos últimos 7 dias. Severidade: OBSERVAR acima de $100/mês, ATENÇÃO acima de $200, CRÍTICO acima de $500." />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Mês até hoje</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>${Number(data.current_mtd_cost_usd).toFixed(2)}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            dia {data.days_elapsed_mtd} de {data.days_in_month}
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Projeção fim do mês</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#f59e0b' }}>${Number(data.projected_monthly_usd).toFixed(2)}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            +${(Number(data.projected_monthly_usd) - Number(data.current_mtd_cost_usd)).toFixed(2)} restante
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Projeção mês seguinte</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#f59e0b' }}>${Number(data.next_month_projection_usd).toFixed(2)}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            ${Number(data.avg_daily_usd).toFixed(2)}/dia × 30
          </div>
        </div>
      </div>

      <div style={{ height: 4, background: 'var(--color-border-tertiary)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          width: `${Math.min(mtdPct, 100)}%`,
          height: '100%',
          background: '#8b5cf6',
          borderRadius: 2,
        }} />
      </div>

      {hasHistory && <AIChart history={(data.history as any[]) || []} />}

      {!hasHistory && (
        <div style={{ padding: 10, background: 'var(--color-background-primary)', borderRadius: 6, marginBottom: 10, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Coletando histórico. São necessários pelo menos 3 dias de dados.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>${Number(data.last_30d_total_usd).toFixed(2)}</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
          nos últimos 30 dias · {Number(data.last_30d_calls).toLocaleString('pt-BR')} chamadas
        </span>
      </div>

      {byFunction.length > 0 && (
        <>
          <div style={labelStyle}>Por função (30 dias)</div>
          {byFunction.map((f: any, i: number) => {
            const maxCost = Math.max(...byFunction.map((x: any) => Number(x.cost_usd_30d)), 0.01);
            const functionLabels: Record<string, string> = {
              'suggest-smart-replies': 'Sugestões',
              'compose-whatsapp-message': 'Composição',
              'analyze-whatsapp-sentiment': 'Sentimento',
              'generate-conversation-summary': 'Resumo',
              'transcribe-whatsapp-audio': 'Transcrição',
            };
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {functionLabels[f.function_name] || f.function_name}
                </span>
                <div style={{ flex: 1, height: 4, background: 'var(--color-border-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(Number(f.cost_usd_30d) / maxCost) * 100}%`, height: '100%', background: '#8b5cf6', borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 70, textAlign: 'right', flexShrink: 0 }}>
                  {Number(f.calls_30d).toLocaleString('pt-BR')}
                </span>
                <span style={{ fontSize: 10, fontWeight: 500, width: 56, textAlign: 'right', flexShrink: 0, color: '#16a34a' }}>
                  ${Number(f.cost_usd_30d).toFixed(2)}
                </span>
              </div>
            );
          })}
        </>
      )}

      {byTenant.length > 0 && (
        <>
          <div style={{ ...labelStyle, marginTop: 10 }}>Por tenant (30 dias)</div>
          {byTenant.map((t: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {t.tenant_nome || t.tenant_id}
              </span>
              <div style={{ flex: 1, height: 4, background: 'var(--color-border-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Number(t.pct)}%`, height: '100%', background: '#8b5cf6', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 36, textAlign: 'right', flexShrink: 0 }}>
                {Number(t.pct).toFixed(0)}%
              </span>
              <span style={{ fontSize: 10, fontWeight: 500, width: 56, textAlign: 'right', flexShrink: 0, color: '#16a34a' }}>
                ${Number(t.cost_usd_30d).toFixed(2)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function ProjectionsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StorageProjectionPanel />
      <DatabaseProjectionPanel />
      <AIProjectionPanel />
      <div style={{ ...panelStyle, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 12, padding: 24 }}>
        Em breve: projeções de Mensagens e Crescimento de Tenants
      </div>
    </div>
  );
}
