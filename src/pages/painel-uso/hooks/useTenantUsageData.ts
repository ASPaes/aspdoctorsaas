import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TenantUsageFilters {
  tenantId: string;
  queryDateFrom: string;
  queryDateTo: string;
  refreshKey: number;
}

export function useTenantUsageData(filters: TenantUsageFilters) {
  const { tenantId, queryDateFrom, queryDateTo, refreshKey } = filters;
  const opts = { staleTime: 60_000, refetchOnWindowFocus: false };
  const enabled = !!tenantId;

  // 1. tenant_daily_metrics no período, excluindo hoje (hoje vem da RPC live).
  // Mesma lógica do SuperMonitor para evitar duplicação com todayMetrics.
  const { data: dailyMetrics = [] } = useQuery({
    queryKey: ['tenant-usage-daily', tenantId, queryDateFrom, queryDateTo, refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_daily_metrics')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('metric_date', queryDateFrom)
        .lte('metric_date', queryDateTo)
        .order('metric_date', { ascending: false });
      return data ?? [];
    },
  });

  // 2. Instâncias do tenant
  const { data: instances = [] } = useQuery({
    queryKey: ['tenant-usage-instances', tenantId, refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, status, updated_at')
        .eq('tenant_id', tenantId)
        .order('instance_name', { ascending: true });
      return data ?? [];
    },
  });

  // 3. Métricas ao vivo do dia (mensagens enviadas/recebidas, IA hoje)
  const { data: todayMetrics } = useQuery({
    queryKey: ['tenant-usage-today', tenantId, refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_today_metrics' as any, {
        p_tenant_id: tenantId,
      });
      return data as any;
    },
  });

  // 4. Custo de IA no período (com breakdown por função e total USD)
  const { data: aiCostMetrics } = useQuery({
    queryKey: ['tenant-usage-ai-cost', tenantId, queryDateFrom, queryDateTo, refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_ai_cost_metrics' as any, {
        p_tenant_id: tenantId,
        p_date_from: queryDateFrom,
        p_date_to: queryDateTo,
      });
      return data as any;
    },
  });

  // 5. Storage agregado (vamos extrair só a entrada deste tenant)
  const { data: storageMetrics } = useQuery({
    queryKey: ['tenant-usage-storage', refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_storage_metrics' as any);
      return data as any;
    },
  });

  // 6. Breakdown de mensagens por instância e por setor (RPC dedicada)
  const { data: messagesBreakdown } = useQuery({
    queryKey: ['tenant-usage-msg-breakdown', tenantId, queryDateFrom, queryDateTo, refreshKey],
    enabled,
    ...opts,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_tenant_messages_breakdown' as any, {
        p_tenant_id: tenantId,
        p_from: queryDateFrom,
        p_to: queryDateTo,
      });
      return data as any;
    },
  });

  const tenantStorage = (storageMetrics?.by_tenant as any[] | undefined)
    ?.find((t: any) => t.tenant_id === tenantId) ?? null;

  return {
    dailyMetrics,
    instances,
    todayMetrics,
    aiCostMetrics,
    tenantStorage,
    messagesBreakdown,
  };
}
