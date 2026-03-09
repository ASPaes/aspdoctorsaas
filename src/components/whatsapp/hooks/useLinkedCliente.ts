import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LinkedCliente {
  id: string;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  email: string | null;
  data_cadastro: string | null;
  data_ativacao: string | null;
  telefone_whatsapp: string | null;
  area_atuacao: string | null;
  segmento: string | null;
  unidade_base: string | null;
  fornecedor: string | null;
  produto: string | null;
  cidade: string | null;
  estado_sigla: string | null;
  contatos: Array<{
    id: string;
    nome: string;
    fone: string | null;
    email: string | null;
    cargo: string | null;
  }>;
}

export const useLinkedCliente = (contactId: string | null, phoneNumber: string | null) => {
  return useQuery({
    queryKey: ['linked-cliente', contactId, phoneNumber],
    queryFn: async (): Promise<LinkedCliente | null> => {
      if (!contactId && !phoneNumber) return null;

      // 1. Try to find cliente_id from conversation metadata
      let clienteId: string | null = null;

      if (contactId) {
        const { data: conversations } = await supabase
          .from('whatsapp_conversations')
          .select('metadata')
          .eq('contact_id', contactId)
          .not('metadata', 'is', null);

        for (const conv of conversations || []) {
          const meta = typeof conv.metadata === 'string' ? JSON.parse(conv.metadata) : conv.metadata;
          if (meta?.cliente_id) {
            clienteId = meta.cliente_id;
            break;
          }
        }
      }

      // 2. If not found via metadata, try matching by phone number
      if (!clienteId && phoneNumber) {
        const digits = phoneNumber.replace(/\D/g, '');
        if (digits.length >= 10) {
          // Try matching telefone_whatsapp
          const { data: clientes } = await supabase
            .from('clientes')
            .select('id, telefone_whatsapp')
            .eq('cancelado', false);

          for (const c of clientes || []) {
            const cDigits = (c.telefone_whatsapp || '').replace(/\D/g, '');
            if (cDigits && digits.endsWith(cDigits.slice(-10)) && cDigits.slice(-10) === digits.slice(-10)) {
              clienteId = c.id;
              break;
            }
          }
        }
      }

      if (!clienteId) return null;

      // 3. Fetch client with lookups
      const { data: cliente } = await supabase
        .from('clientes')
        .select(`
          id, cnpj, razao_social, nome_fantasia, email,
          data_cadastro, data_ativacao, telefone_whatsapp,
          area_atuacao_id, segmento_id, unidade_base_id,
          fornecedor_id, produto_id, cidade_id, estado_id
        `)
        .eq('id', clienteId)
        .single();

      if (!cliente) return null;

      // 4. Fetch lookups in parallel
      const [areaRes, segRes, unidRes, fornRes, prodRes, cidRes, estRes, contatosRes] = await Promise.all([
        cliente.area_atuacao_id ? supabase.from('areas_atuacao').select('nome').eq('id', cliente.area_atuacao_id).single() : { data: null },
        cliente.segmento_id ? supabase.from('segmentos').select('nome').eq('id', cliente.segmento_id).single() : { data: null },
        cliente.unidade_base_id ? supabase.from('unidades_base').select('nome').eq('id', cliente.unidade_base_id).single() : { data: null },
        cliente.fornecedor_id ? supabase.from('fornecedores').select('nome').eq('id', cliente.fornecedor_id).single() : { data: null },
        cliente.produto_id ? supabase.from('produtos').select('nome').eq('id', cliente.produto_id).single() : { data: null },
        cliente.cidade_id ? supabase.from('cidades').select('nome').eq('id', cliente.cidade_id).single() : { data: null },
        cliente.estado_id ? supabase.from('estados').select('sigla').eq('id', cliente.estado_id).single() : { data: null },
        supabase.from('cliente_contatos').select('id, nome, fone, email, cargo').eq('cliente_id', clienteId),
      ]);

      const dataAtivacao = cliente.data_ativacao || cliente.data_cadastro;

      return {
        id: cliente.id,
        cnpj: cliente.cnpj,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        email: cliente.email,
        data_cadastro: cliente.data_cadastro,
        data_ativacao: dataAtivacao,
        telefone_whatsapp: cliente.telefone_whatsapp,
        area_atuacao: areaRes.data?.nome || null,
        segmento: segRes.data?.nome || null,
        unidade_base: unidRes.data?.nome || null,
        fornecedor: fornRes.data?.nome || null,
        produto: prodRes.data?.nome || null,
        cidade: cidRes.data?.nome || null,
        estado_sigla: estRes.data?.sigla || null,
        contatos: (contatosRes.data || []).map((c: any) => ({
          id: c.id,
          nome: c.nome,
          fone: c.fone,
          email: c.email,
          cargo: c.cargo,
        })),
      };
    },
    enabled: !!(contactId || phoneNumber),
    staleTime: 60000,
  });
};
