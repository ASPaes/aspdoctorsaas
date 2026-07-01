import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type { DashboardFilters } from '../types';

export interface VendasBreakdownRow {
  label: string;
  qtd: number;
  new_mrr: number;
  custo: number;
  margem_rs: number;
  margem_pct: number;
  ticket: number;
}

export interface VendasSerieRow {
  mes: string;
  qtd: number;
  new_mrr: number;
  ticket: number;
}

export interface VendasProdutoRow {
  label: string;
  qtd: number;
  new_mrr: number;
  margem_rs: number;
  margem_pct: number;
}

function resolvePeriodo(filters: DashboardFilters): { iniStr: string; fimStr: string } {
  if (filters.showAllData) {
    return {
      iniStr: '2000-01-01',
      fimStr: format(new Date(), 'yyyy-MM-dd'),
    };
  }
  const ini = filters.periodoInicio || startOfMonth(new Date());
  const fim = filters.periodoFim || endOfMonth(new Date());
  return {
    iniStr: format(ini, 'yyyy-MM-dd'),
    fimStr: format(fim, 'yyyy-MM-dd'),
  };
}

export function useVendasExplorer(filters: DashboardFilters, dim: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);
  const forn = filters.fornecedorId ?? null;
  const fornIds = filters.fornecedorIds ?? [];
  const unid = filters.unidadeBaseId ?? null;

  return useQuery({
    queryKey: ['vendas-breakdown', tid, iniStr, fimStr, dim, JSON.stringify(fornIds), unid],
    enabled: !!tid && !!dim,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VendasBreakdownRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_vendas_breakdown', {
        p_tenant: tid,
        p_ini: iniStr,
        p_fim: fimStr,
        p_dim: dim,
        p_fornecedor_id: null,
        p_fornecedor_ids: fornIds.length ? fornIds : null,
        p_unidade_base_id: unid,
      });
      if (error) throw error;
      return (data || []) as VendasBreakdownRow[];
    },
  });
}

export function useVendasSerie(filters: DashboardFilters, meses = 12) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const forn = filters.fornecedorId ?? null;
  const unid = filters.unidadeBaseId ?? null;

  return useQuery({
    queryKey: ['vendas-serie', tid, meses, forn, unid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VendasSerieRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_vendas_serie_mensal', {
        p_tenant: tid,
        p_meses: meses,
        p_fornecedor_id: forn,
        p_unidade_base_id: unid,
      });
      if (error) throw error;
      return (data || []) as VendasSerieRow[];
    },
  });
}

export interface VendasTicketStats {
  n: number;
  media: number;
  mediana: number;
  p25: number;
  p75: number;
  minimo: number;
  maximo: number;
}

export function useVendasTicketStats(filters: DashboardFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);
  const forn = filters.fornecedorId ?? null;
  const unid = filters.unidadeBaseId ?? null;

  return useQuery({
    queryKey: ['vendas-ticket-stats', tid, iniStr, fimStr, forn, unid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VendasTicketStats | null> => {
      const { data, error } = await (supabase.rpc as any)('get_vendas_ticket_stats', {
        p_tenant: tid,
        p_ini: iniStr,
        p_fim: fimStr,
        p_fornecedor_id: forn,
        p_unidade_base_id: unid,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as VendasTicketStats | null;
    },
  });
}

export function useVendasProdutos(filters: DashboardFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);
  const forn = filters.fornecedorId ?? null;
  const unid = filters.unidadeBaseId ?? null;

  return useQuery({
    queryKey: ['vendas-produtos', tid, iniStr, fimStr, forn, unid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VendasProdutoRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_vendas_produtos', {
        p_tenant: tid,
        p_ini: iniStr,
        p_fim: fimStr,
        p_fornecedor_id: forn,
        p_unidade_base_id: unid,
      });
      if (error) throw error;
      return (data || []) as VendasProdutoRow[];
    },
  });
}
