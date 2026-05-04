import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MonitorFilters {
  queryDateFrom: string;
  queryDateTo: string;
  selectedTenant: string;
  refreshKey: number;
}

export function useMonitorData(filters: MonitorFilters) {
  const { queryDateFrom, queryDateTo, selectedTenant, refreshKey } = filters;
  const since24h = new Date(Date.now() - 86400000).toISOString();
  const opts = { staleTime: Infinity, refetchOnWindowFocus: false };

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
      const { data: tenantsData } = await supabase.from('tenants').select('id, nome');
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
    ...opts,
  });

  const { data: todayMetrics } = useQuery({
    queryKey: ['monitor-today', refreshKey, selectedTenant],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_today_metrics' as any, {
        p_tenant_id: selectedTenant !== 'all' ? selectedTenant : null,
      });
      return data as any;
    },
    ...opts,
  });

  const { data: aiCostMetrics } = useQuery({
    queryKey: ['monitor-ai-cost', queryDateFrom, queryDateTo, selectedTenant, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_ai_cost_metrics' as any, {
        p_tenant_id: selectedTenant !== 'all' ? selectedTenant : null,
        p_date_from: queryDateFrom,
        p_date_to: queryDateTo,
      });
      return data as any;
    },
    ...opts,
  });

  const { data: storageMetrics } = useQuery({
    queryKey: ['monitor-storage', refreshKey],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_storage_metrics' as any);
      return data as any;
    },
    ...opts,
  });

  return {
    tenantMetrics,
    instances,
    snapshots,
    alerts,
    instanceLog,
    maintenanceData,
    refetchMaintenance,
    todayMetrics,
    aiCostMetrics,
    storageMetrics,
  };
}
