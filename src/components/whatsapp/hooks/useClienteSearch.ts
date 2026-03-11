import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { escapeLike } from '@/lib/utils';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface ClienteSearchResult {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  telefone_whatsapp: string | null;
  cnpj: string | null;
  codigo_sequencial: number;
}

export function useClienteSearch(searchTerm: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [debouncedTerm, setDebouncedTerm] = useState(searchTerm);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const query = useQuery({
    queryKey: ['clientes-search', debouncedTerm, tid],
    queryFn: async (): Promise<ClienteSearchResult[]> => {
      if (!debouncedTerm || debouncedTerm.length < 2) return [];

      const term = debouncedTerm.trim();
      const isNumeric = /^\d+$/.test(term);

      let q = supabase
        .from('clientes')
        .select('id, razao_social, nome_fantasia, telefone_whatsapp, cnpj, codigo_sequencial')
        .eq('cancelado', false)
        .limit(20);

      if (tid) q = q.eq('tenant_id', tid);

      if (isNumeric && term.length <= 6) {
        // Search by codigo_sequencial or phone (with and without 55 prefix)
        q = q.or(`codigo_sequencial.eq.${term},telefone_whatsapp.ilike.%${escapeLike(term)}%`);
      } else if (isNumeric) {
        // Phone number - search with and without 55 prefix
        const withoutPrefix = term.startsWith('55') ? term.slice(2) : term;
        const withPrefix = term.startsWith('55') ? term : `55${term}`;
        q = q.or(`telefone_whatsapp.ilike.%${escapeLike(withoutPrefix)}%,telefone_whatsapp.ilike.%${escapeLike(withPrefix)}%`);
      } else {
        // Search by name or CNPJ
        const cleanTerm = term.replace(/[.\-\/]/g, '');
        const isCnpjLike = /^\d{3,}$/.test(cleanTerm) && cleanTerm.length >= 3;
        if (isCnpjLike) {
          q = q.or(`razao_social.ilike.%${escapeLike(term)}%,nome_fantasia.ilike.%${escapeLike(term)}%,cnpj.ilike.%${escapeLike(cleanTerm)}%`);
        } else {
          q = q.or(`razao_social.ilike.%${escapeLike(term)}%,nome_fantasia.ilike.%${escapeLike(term)}%`);
        }
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: debouncedTerm.length >= 2,
  });

  return {
    results: query.data || [],
    isLoading: query.isLoading && debouncedTerm.length >= 2,
  };
}
