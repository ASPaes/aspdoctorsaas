import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { escapeLike } from '@/lib/utils';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface ContactSearchResult {
  id: string;
  name: string | null;
  phone_number: string;
  profile_picture_url: string | null;
  instance_id: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
}

/**
 * Busca no diretório de contatos (whatsapp_contacts) por nome ou telefone.
 * Grupos ficam de fora: o jid de grupo não abre conversa nova.
 * Os índices trgm de name/phone_number cobrem o ilike '%termo%'.
 */
export function useContactSearch(searchTerm: string, limit = 20) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [debouncedTerm, setDebouncedTerm] = useState(searchTerm);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const term = debouncedTerm.trim();

  const query = useQuery({
    queryKey: ['whatsapp-contacts-search', term, tid, limit],
    queryFn: async (): Promise<ContactSearchResult[]> => {
      if (term.length < 2 || !tid) return [];

      // Telefone digitado com máscara ("(51) 98888-0001") tem que casar com o
      // phone_number, que é só dígito.
      const digits = term.replace(/\D/g, '');
      const byName = `name.ilike.%${escapeLike(term)}%`;
      const byPhone = digits.length >= 3 ? `,phone_number.ilike.%${escapeLike(digits)}%` : '';

      const { data, error } = await supabase
        .from('whatsapp_contacts')
        .select('id, name, phone_number, profile_picture_url, instance_id, cliente_id, clientes(nome_fantasia, razao_social)')
        .eq('tenant_id', tid)
        .eq('is_group', false)
        .or(`${byName}${byPhone}`)
        .order('name', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return (data ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        phone_number: c.phone_number,
        profile_picture_url: c.profile_picture_url,
        instance_id: c.instance_id,
        cliente_id: c.cliente_id,
        cliente_nome: c.clientes?.nome_fantasia || c.clientes?.razao_social || null,
      }));
    },
    enabled: term.length >= 2 && !!tid,
    staleTime: 30 * 1000,
  });

  return {
    results: query.data || [],
    isLoading: query.isLoading && term.length >= 2,
  };
}
