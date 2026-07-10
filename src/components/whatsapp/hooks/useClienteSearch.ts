import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface ClienteSearchResult {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  telefone_whatsapp: string | null;
  cnpj: string | null;
  codigo_sequencial: number;
  cancelado: boolean;
  data_cancelamento: string | null;
}

export function useClienteSearch(searchTerm: string, includeCancelados: boolean = false) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [debouncedTerm, setDebouncedTerm] = useState(searchTerm);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const query = useQuery({
    queryKey: ['clientes-search', debouncedTerm, tid, includeCancelados],
    queryFn: async (): Promise<ClienteSearchResult[]> => {
      if (!debouncedTerm || debouncedTerm.length < 2) return [];
      if (!tid) return [];

      const { data, error } = await supabase.rpc('search_clientes_for_link' as any, {
        p_tenant_id: tid,
        p_term: debouncedTerm.trim(),
        p_include_cancelados: includeCancelados,
      });

      if (error) throw error;
      return (data ?? []) as ClienteSearchResult[];
    },
    enabled: debouncedTerm.length >= 2 && !!tid,
    staleTime: 30 * 1000, // 30s — busca dinâmica, ainda assim cacheável
  });

  return {
    results: query.data || [],
    isLoading: query.isLoading && debouncedTerm.length >= 2,
  };
}
