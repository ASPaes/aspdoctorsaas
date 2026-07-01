import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type { DashboardFilters } from '../types';

export interface CarteiraBreakdownRow {
  label: string;
  qtd: number;
  mrr: number;
  custo: number;
  margem_rs: number;
  margem_pct: number;
  ticket: number;
}

export interface CarteiraChurnRow {
  label: string;
  base: number;
  cancelados: number;
  churn_pct: number;
  mrr_perdido: number;
}

function resolvePeriodo(filters: DashboardFilters): { iniStr: string; fimStr: string } {
  if (filters.showAllData) {
    return { iniStr: '2000-01-01', fimStr: format(new Date(), 'yyyy-MM-dd') };
  }
  const ini = filters.periodoInicio || startOfMonth(new Date());
  const fim = filters.periodoFim || endOfMonth(new Date());
  return { iniStr: format(ini, 'yyyy-MM-dd'), fimStr: format(fim, 'yyyy-MM-dd') };
}

export function useCarteiraBreakdown(filters: DashboardFilters, dim: string, uf: string | null = null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { fimStr } = resolvePeriodo(filters);
  return useQuery({
    queryKey: ['carteira-breakdown', tid, fimStr, dim, uf, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid && !!dim,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraBreakdownRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_breakdown', {
        p_tenant: tid, p_dim: dim, p_fim: fimStr, p_uf: uf,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as CarteiraBreakdownRow[];
    },
  });
}

export function useCarteiraChurn(filters: DashboardFilters, nivel: string, uf: string | null = null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);
  return useQuery({
    queryKey: ['carteira-churn', tid, iniStr, fimStr, nivel, uf, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid && !!nivel,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraChurnRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_churn', {
        p_tenant: tid, p_nivel: nivel, p_ini: iniStr, p_fim: fimStr, p_uf: uf,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as CarteiraChurnRow[];
    },
  });
}

export interface CarteiraVariacaoRow {
  uf: string;
  mrr_atual: number;
  mrr_anterior: number;
  delta_abs: number;
  delta_pct: number | null;
  qtd_atual: number;
}

export function useCarteiraVariacao(filters: DashboardFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const fimAtual = filters.showAllData ? new Date() : (filters.periodoFim || endOfMonth(new Date()));
  const inicio = filters.showAllData ? new Date() : (filters.periodoInicio || startOfMonth(new Date()));
  const fimAnterior = filters.showAllData ? subMonths(fimAtual, 1) : subDays(inicio, 1);
  const fimAtualStr = format(fimAtual, 'yyyy-MM-dd');
  const fimAntStr = format(fimAnterior, 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['carteira-variacao', tid, fimAtualStr, fimAntStr, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraVariacaoRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_variacao', {
        p_tenant: tid, p_fim_atual: fimAtualStr, p_fim_anterior: fimAntStr,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as CarteiraVariacaoRow[];
    },
  });
}

export interface ChurnDetalheRow {
  cliente: string;
  segmento: string;
  cidade: string;
  mrr_perdido: number;
  data_cancelamento: string;
  observacao: string | null;
}

export function useChurnDetalheUf(filters: DashboardFilters, uf: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { iniStr, fimStr } = resolvePeriodo(filters);
  return useQuery({
    queryKey: ['churn-detalhe-uf', tid, uf, iniStr, fimStr, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid && !!uf,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ChurnDetalheRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_churn_detalhe_uf', {
        p_tenant: tid, p_uf: uf, p_ini: iniStr, p_fim: fimStr,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as ChurnDetalheRow[];
    },
  });
}

export interface CarteiraClienteCidadeRow {
  cliente: string;
  segmento: string;
  mrr: number;
}

export function useCarteiraClientesCidade(filters: DashboardFilters, uf: string | null, cidade: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { fimStr } = resolvePeriodo(filters);
  return useQuery({
    queryKey: ['carteira-clientes-cidade', tid, uf, cidade, fimStr, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid && !!uf && !!cidade,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraClienteCidadeRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_clientes_cidade', {
        p_tenant: tid, p_uf: uf, p_cidade: cidade, p_fim: fimStr,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as CarteiraClienteCidadeRow[];
    },
  });
}

export interface CarteiraSerieRow {
  ym: string;
  uf: string;
  mrr: number;
  qtd: number;
}

export function useCarteiraSerieUf(filters: DashboardFilters, meses: number) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ['carteira-serie-uf', tid, meses, JSON.stringify(filters.fornecedorIds), filters.unidadeBaseId],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CarteiraSerieRow[]> => {
      const { data, error } = await (supabase.rpc as any)('get_carteira_serie_uf', {
        p_tenant: tid,
        p_meses: meses,
        p_fornecedor: null,
        p_fornecedor_ids: filters.fornecedorIds?.length ? filters.fornecedorIds : null,
        p_unidade: filters.unidadeBaseId ?? null,
      });
      if (error) throw error;
      return (data || []) as CarteiraSerieRow[];
    },
  });
}
