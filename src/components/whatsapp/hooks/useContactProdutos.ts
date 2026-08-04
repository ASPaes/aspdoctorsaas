import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { fetchAllRows } from '@/lib/supabasePaginate';

export interface ContactProdutoInput {
  id: string;
  cliente_id?: string | null;
}

/**
 * Produtos ativos do cliente vinculado a cada contato, em lote.
 *
 * Usado pela lista de conversas para mostrar qual software o cliente usa junto
 * ao nome. Recebe os contatos já carregados; quando `cliente_id` não veio junto
 * (caso da busca, que monta o contato a partir da RPC), resolve o vínculo por PK.
 *
 * Retorna Map<contactId, nomes de produtos>.
 */
export function useContactProdutos(contacts: ContactProdutoInput[]) {
  const { effectiveTenantId: tid } = useTenantFilter();

  // Chave estável: ordenada, então reordenação da lista não invalida o cache.
  const pairsKey = useMemo(
    () => contacts.map((c) => `${c.id}:${c.cliente_id ?? ''}`).sort().join(','),
    [contacts]
  );

  return useQuery({
    queryKey: ['whatsapp', 'contact-produtos', pairsKey, tid],
    enabled: pairsKey.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const contactToCliente = new Map<string, string>();
      const semVinculoConhecido: string[] = [];

      for (const pair of pairsKey.split(',')) {
        const [contactId, clienteId] = pair.split(':');
        if (!contactId) continue;
        if (clienteId) contactToCliente.set(contactId, clienteId);
        else semVinculoConhecido.push(contactId);
      }

      if (semVinculoConhecido.length > 0) {
        let q = supabase
          .from('whatsapp_contacts')
          .select('id, cliente_id')
          .in('id', semVinculoConhecido);
        if (tid) q = q.eq('tenant_id', tid);
        const { data } = await q;
        (data ?? []).forEach((r: any) => {
          if (r.cliente_id) contactToCliente.set(r.id, r.cliente_id);
        });
      }

      const clienteIds = [...new Set(contactToCliente.values())];
      if (clienteIds.length === 0) return new Map();

      const rows = await fetchAllRows<any>(() => {
        let q = (supabase.from('cliente_produtos' as any) as any)
          .select('cliente_id, produtos(nome)')
          .in('cliente_id', clienteIds)
          .eq('ativo', true);
        if (tid) q = q.eq('tenant_id', tid);
        return q;
      });

      const porCliente = new Map<string, string[]>();
      for (const r of rows) {
        const nome = (r.produtos?.nome ?? '').trim();
        if (!nome) continue;
        const atuais = porCliente.get(r.cliente_id) ?? [];
        if (!atuais.includes(nome)) atuais.push(nome);
        porCliente.set(r.cliente_id, atuais);
      }
      porCliente.forEach((nomes) => nomes.sort((a, b) => a.localeCompare(b, 'pt-BR')));

      const porContato = new Map<string, string[]>();
      contactToCliente.forEach((clienteId, contactId) => {
        const nomes = porCliente.get(clienteId);
        if (nomes?.length) porContato.set(contactId, nomes);
      });
      return porContato;
    },
  });
}
