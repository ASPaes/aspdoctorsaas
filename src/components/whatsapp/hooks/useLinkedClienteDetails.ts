import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface ClienteDetailsForChat {
  cnpj: string | null;
  email: string | null;
  data_ativacao: string | null;
  contato_aniversario: string | null;
  area_atuacao: string | null;
  segmento: string | null;
  unidade_base: string | null;
  fornecedor: string | null;
  produto: string | null;
  cidade: string | null;
  estado_sigla: string | null;
}

export function useLinkedClienteDetails(clienteId: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq('tenant_id', tid) : q;

  return useQuery({
    queryKey: ['linked-cliente-details', clienteId, tid],
    queryFn: async (): Promise<ClienteDetailsForChat | null> => {
      if (!clienteId) return null;

      const { data: c } = await tf(supabase
        .from('clientes')
        .select(`
          cnpj, email, data_ativacao, data_cadastro, contato_aniversario,
          area_atuacao_id, segmento_id, unidade_base_id,
          fornecedor_id, produto_id, cidade_id, estado_id
        `)
        .eq('id', clienteId)
        .single();

      if (!c) return null;

      const [areaRes, segRes, unidRes, fornRes, prodRes, cidRes, estRes] = await Promise.all([
        c.area_atuacao_id ? supabase.from('areas_atuacao').select('nome').eq('id', c.area_atuacao_id).single() : { data: null },
        c.segmento_id ? supabase.from('segmentos').select('nome').eq('id', c.segmento_id).single() : { data: null },
        c.unidade_base_id ? supabase.from('unidades_base').select('nome').eq('id', c.unidade_base_id).single() : { data: null },
        c.fornecedor_id ? supabase.from('fornecedores').select('nome').eq('id', c.fornecedor_id).single() : { data: null },
        c.produto_id ? supabase.from('produtos').select('nome').eq('id', c.produto_id).single() : { data: null },
        c.cidade_id ? supabase.from('cidades').select('nome').eq('id', c.cidade_id).single() : { data: null },
        c.estado_id ? supabase.from('estados').select('sigla').eq('id', c.estado_id).single() : { data: null },
      ]);

      return {
        cnpj: c.cnpj,
        email: c.email,
        data_ativacao: c.data_ativacao || c.data_cadastro,
        contato_aniversario: c.contato_aniversario,
        area_atuacao: areaRes.data?.nome || null,
        segmento: segRes.data?.nome || null,
        unidade_base: unidRes.data?.nome || null,
        fornecedor: fornRes.data?.nome || null,
        produto: prodRes.data?.nome || null,
        cidade: cidRes.data?.nome || null,
        estado_sigla: estRes.data?.sigla || null,
      };
    },
    enabled: !!clienteId,
    staleTime: 60000,
  });
}
