import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-day-picker/dist/style.css';
import { RefreshCw, Wifi, WifiOff, BarChart3 } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { useTenantUsageData } from './hooks/useTenantUsageData';
import { MiniBar } from '@/pages/monitor/shared/MiniBar';
import { HelpTooltip } from '@/pages/monitor/shared/HelpTooltip';
import { parseBRDate, formatBRDate } from '@/pages/monitor/shared/dateUtils';

export default function PainelUso() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'details'>('overview');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: new Date(),
  });

  // Permissão: só admin do tenant ou super admin
  useEffect(() => {
    if (profile && (profile as any).role !== 'admin' && !(profile as any).is_super_admin) {
      navigate('/dashboard', { replace: true });
    }
  }, [profile, navigate]);

  // Nome do tenant (independente do contexto)
  const { data: tenantInfo } = useQuery({
    queryKey: ['painel-uso-tenant-info', effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('nome').eq('id', effectiveTenantId!).maybeSingle();
      return data;
    },
  });

  const queryDateFrom = dateRange.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const queryDateTo = dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : '';
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayIncluded = queryDateTo >= todayStr;

  const { dailyMetrics, instances, todayMetrics, aiCostMetrics, tenantStorage } = useTenantUsageData({
    tenantId: effectiveTenantId || '',
    queryDateFrom,
    queryDateTo,
    refreshKey,
  });

  const aiCalls = (t: any) =>
    (t.ai_calls_suggest || 0) + (t.ai_calls_compose || 0) + (t.ai_calls_sentiment || 0) +
    (t.ai_calls_summary || 0) + (t.ai_calls_audio || 0);

  const totalMsgs = dailyMetrics.reduce((s: number, t: any) => s + (t.messages_sent || 0) + (t.messages_received || 0), 0);
  const totalConvs = dailyMetrics.reduce((s: number, t: any) => s + (t.conversations_closed || 0), 0);
  const totalAI = dailyMetrics.reduce((s: number, t: any) => s + aiCalls(t), 0);
  const totalCost = Number(aiCostMetrics?.total_cost_usd ?? 0);

  const connectedCount = instances.filter((i: any) => i.status === 'connected').length;
  const disconnected = instances.filter((i: any) => i.status !== 'connected');

  const aiByFunction = useMemo(() => [
    { label: 'Sugestões',   key: 'ai_calls_suggest',   color: '#3b82f6' },
    { label: 'Composição',  key: 'ai_calls_compose',   color: '#8b5cf6' },
    { label: 'Sentimento',  key: 'ai_calls_sentiment', color: '#06b6d4' },
    { label: 'Resumo',      key: 'ai_calls_summary',   color: '#10b981' },
    { label: 'Transcrição', key: 'ai_calls_audio',     color: '#f59e0b' },
  ].map(fn => ({
    ...fn,
    total: dailyMetrics.reduce((s: number, t: any) => s + ((t as any)[fn.key] || 0), 0),
  })), [dailyMetrics]);

  const panelStyle: React.CSSProperties = {
    background: 'hsl(var(--card))',
    border: '0.5px solid hsl(var(--border))',
    borderRadius: 12,
    padding: '12px 14px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 500, color: 'hsl(var(--muted-foreground))',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
  };

  const nowLabel = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, background: 'hsl(var(--background))', minHeight: '100vh' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={20} style={{ color: 'hsl(var(--muted-foreground))' }} />
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'hsl(var(--foreground))', margin: 0 }}>Painel de Uso</h1>
            <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', textTransform: 'capitalize' }}>
              {tenantInfo?.nome ? `${tenantInfo.nome} · ` : ''}{nowLabel}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '0.5px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', cursor: 'pointer' }}>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, 'dd/MM/yy')} – ${format(dateRange.to, 'dd/MM/yy')}`
                  : 'Período'}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" style={{ padding: 10, width: 'auto' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130, paddingTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', padding: '4px 12px' }}>Atalhos</div>
                  {([
                    { label: 'Hoje', fn: () => ({ from: new Date(), to: new Date() }) },
                    { label: 'Últimos 7 dias', fn: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
                    { label: 'Este mês', fn: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
                    { label: 'Mês passado', fn: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
                  ] as const).map(({ label, fn }) => (
                    <button key={label} onClick={() => { setDateRange(fn()); setRefreshKey(k => k + 1); setCalendarOpen(false); }}
                      style={{ textAlign: 'left', padding: '6px 12px', fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--foreground))' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                    De
                    <input value={dateRange.from ? formatBRDate(dateRange.from) : ''}
                      onChange={(e) => { const p = parseBRDate(e.target.value); if (p) setDateRange(r => ({ ...r, from: p })); }}
                      style={{ width: 100, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }} />
                    até
                    <input value={dateRange.to ? formatBRDate(dateRange.to) : ''}
                      onChange={(e) => { const p = parseBRDate(e.target.value); if (p) setDateRange(r => ({ ...r, to: p })); }}
                      style={{ width: 100, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }} />
                  </div>
                  <DayPicker mode="range" selected={dateRange as DateRange}
                    onSelect={(range) => { if (range?.from && range?.to) setDateRange({ from: range.from, to: range.to }); }}
                    numberOfMonths={2} locale={ptBR} showOutsideDays
                    disabled={{ after: new Date() }}
                    className="pointer-events-auto"
                    footer={
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '0.5px solid hsl(var(--border))' }}>
                        <button onClick={() => setCalendarOpen(false)}
                          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 7, border: '0.5px solid hsl(var(--border))', background: 'transparent', color: 'hsl(var(--muted-foreground))', cursor: 'pointer' }}>Cancelar</button>
                        <button onClick={() => { setRefreshKey(k => k + 1); setCalendarOpen(false); }}
                          disabled={!dateRange.from || !dateRange.to}
                          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 7, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Aplicar</button>
                      </div>
                    } />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <button onClick={() => setRefreshKey(k => k + 1)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 8, border: '0.5px solid hsl(var(--border))', background: 'transparent', color: 'hsl(var(--muted-foreground))', cursor: 'pointer' }}>
            <RefreshCw size={12} /> Atualizar
          </button>
        </div>
      </div>

      {/* Linha 1: 4 KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* Mensagens */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>mensagens</div>
            <HelpTooltip text="Total de mensagens enviadas + recebidas no período." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'hsl(var(--foreground))', lineHeight: 1 }}>{totalMsgs.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{queryDateFrom} – {queryDateTo}</div>
          {todayIncluded && todayMetrics && (
            <>
              <div style={{ height: 1, background: 'hsl(var(--border))', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                <span>Hoje (live)</span>
                <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                  {((todayMetrics?.messages_sent ?? 0) + (todayMetrics?.messages_received ?? 0)).toLocaleString('pt-BR')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                <span>↑ {todayMetrics?.messages_sent ?? 0} enviadas</span>
                <span>↓ {todayMetrics?.messages_received ?? 0} recebidas</span>
              </div>
            </>
          )}
        </div>

        {/* Conversas */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>conversas encerradas</div>
            <HelpTooltip text="Quantidade de atendimentos finalizados no período." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'hsl(var(--foreground))', lineHeight: 1 }}>{totalConvs.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>no período</div>
        </div>

        {/* IA */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>chamadas IA</div>
            <HelpTooltip text="Total de chamadas a funções de IA (sugestão, composição, sentimento, resumo, transcrição)." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'hsl(var(--foreground))', lineHeight: 1 }}>{totalAI.toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{queryDateFrom} – {queryDateTo}</div>
          {todayIncluded && todayMetrics && (
            <>
              <div style={{ height: 1, background: 'hsl(var(--border))', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                <span>Hoje (live)</span>
                <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>{(todayMetrics?.ai_calls ?? 0).toLocaleString('pt-BR')}</span>
              </div>
            </>
          )}
        </div>

        {/* Instâncias */}
        <div style={{ ...panelStyle, borderColor: disconnected.length > 0 ? '#eab308' : '#22c55e' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>instâncias whatsapp</div>
            <HelpTooltip text="Status das instâncias WhatsApp configuradas." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'hsl(var(--foreground))', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            {disconnected.length > 0 ? <WifiOff size={18} color="#ca8a04" /> : <Wifi size={18} color="#16a34a" />}
            {connectedCount} / {instances.length}
          </div>
          <div style={{ fontSize: 10, color: disconnected.length > 0 ? '#ca8a04' : '#16a34a', margin: '2px 0 0', fontWeight: 500 }}>
            {disconnected.length > 0 ? `${disconnected.length} desconectada${disconnected.length > 1 ? 's' : ''}` : 'todas conectadas'}
          </div>
          {disconnected.slice(0, 2).map((inst: any, i: number) => (
            <div key={i} style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: i === 0 ? 4 : 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              · {inst.instance_name}
            </div>
          ))}
        </div>
      </div>

      {/* Linha 2: 4 painéis */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* Storage */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>storage</div>
            <HelpTooltip text="Espaço utilizado em armazenamento (mídias, áudios, anexos)." />
          </div>
          {tenantStorage ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'hsl(var(--foreground))', lineHeight: 1 }}>
                {Number(tenantStorage.mb) >= 1024 ? `${(Number(tenantStorage.mb)/1024).toFixed(2)} GB` : `${Number(tenantStorage.mb).toFixed(0)} MB`}
              </div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                {Number(tenantStorage.objects).toLocaleString('pt-BR')} arquivos
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Sem arquivos armazenados</div>
          )}
        </div>

        {/* Uso de IA por Função */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>uso de IA por função</div>
            <HelpTooltip text="Distribuição das chamadas IA entre as funções no período." />
          </div>
          {totalAI === 0 ? (
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Sem uso de IA no período.</div>
          ) : aiByFunction.map((fn) => {
            const pct = totalAI > 0 ? Math.round((fn.total / totalAI) * 100) : 0;
            return (
              <div key={fn.key} style={{ display: 'grid', gridTemplateColumns: '85px 1fr 32px 36px', alignItems: 'center', gap: 6, fontSize: 11, marginTop: 4 }}>
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>{fn.label}</span>
                <MiniBar value={pct} max={100} color={fn.color} />
                <span style={{ color: 'hsl(var(--muted-foreground))', textAlign: 'right' }}>{pct}%</span>
                <span style={{ color: 'hsl(var(--foreground))', textAlign: 'right', fontWeight: 500 }}>{fn.total}</span>
              </div>
            );
          })}
        </div>

        {/* Custo IA */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>custo estimado IA (USD)</div>
            <HelpTooltip text="Custo estimado das chamadas de IA no período." />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1, color: totalCost > 0 ? '#16a34a' : 'hsl(var(--foreground))' }}>
            ${totalCost.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            {totalAI.toLocaleString('pt-BR')} chamadas no período
          </div>
          {totalAI > 0 && (
            <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
              Custo médio por chamada: ${(totalCost / totalAI).toFixed(4)}
            </div>
          )}
        </div>

        {/* Lista de instâncias */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={labelStyle}>suas instâncias</div>
            <HelpTooltip text="Lista das suas instâncias WhatsApp e status atual." />
          </div>
          {instances.length === 0 ? (
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Nenhuma instância configurada.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
              {instances.map((inst: any) => {
                const ok = inst.status === 'connected';
                return (
                  <div key={inst.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.instance_name}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: ok ? '#16a34a' : '#dc2626' }}>{ok ? 'ok' : 'OFFLINE'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
