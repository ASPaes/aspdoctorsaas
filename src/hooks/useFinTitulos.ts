import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/supabasePaginate';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

// Fonte única de leitura do financeiro: a tabela fin_titulos, alimentada por um
// conector por origem (Omie hoje; Asaas e FlyERP depois). Nenhuma tela sabe de
// onde o título veio.
//
// Para decidir cobrança, leia sempre `vw_fin_titulos_abertos`: ela devolve só o
// título que a origem confirmou na última leitura boa. Título que a origem parou
// de devolver (excluído no ERP) fica fora, e é por isso que ela existe.

export type FinSituacao =
  | 'a_vencer'
  | 'vence_hoje'
  | 'atrasado'
  | 'pago'
  | 'parcial'
  | 'cancelado'
  | 'desconhecida';

export const FIN_SITUACAO_LABEL: Record<FinSituacao, string> = {
  a_vencer: 'A vencer',
  vence_hoje: 'Vence hoje',
  atrasado: 'Atrasado',
  pago: 'Pago',
  parcial: 'Pago em parte',
  cancelado: 'Cancelado',
  desconhecida: 'Sem confirmação',
};

export interface FinTitulo {
  id: string;
  origem: string;
  origem_id: string;
  cliente_id: string | null;
  cnpj_cpf_digits: string | null;
  numero_documento: string | null;
  parcela: string | null;
  emissao: string | null;
  vencimento: string;
  valor: number;
  situacao: FinSituacao;
  situacao_origem: string | null;
  boleto_gerado: boolean;
  codigo_barras: string | null;
  link_boleto: string | null;
  pix_copia_cola: string | null;
  link_nfse: string | null;
  visto_em: string;
  clientes?: { razao_social: string | null; nome_fantasia: string | null; cnpj: string | null } | null;
}

export interface FinTituloAberto {
  id: string;
  cliente_id: string | null;
  vencimento: string;
  valor: number;
  situacao: FinSituacao;
  dias_atraso: number;
  vencido: boolean;
  boleto_gerado: boolean;
}

export interface FinSyncEstado {
  origem: string;
  ultima_leitura_ok: string | null;
  ultima_tentativa: string | null;
  ultimo_status: string | null;
  ultimo_erro: string | null;
  titulos_lidos: number | null;
}

/** Faixas de atraso do painel. O corte em 60 dias é o que o negócio trata como MRR em risco. */
export const FAIXAS_ATRASO = [
  { chave: '1-15', label: '1 a 15 dias', de: 1, ate: 15 },
  { chave: '16-30', label: '16 a 30 dias', de: 16, ate: 30 },
  { chave: '31-60', label: '31 a 60 dias', de: 31, ate: 60 },
  { chave: '60+', label: 'Mais de 60 dias', de: 61, ate: 99999 },
] as const;

/**
 * Títulos em aberto e confirmados pela origem. É a base do painel.
 * Volume real por tenant é de centenas de linhas, mas vai por fetchAllRows
 * porque o PostgREST corta em 1000 sem avisar.
 */
export function useFinTitulosAbertos() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<FinTituloAberto[]>({
    queryKey: ['fin-titulos-abertos', tid],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<FinTituloAberto>(() => {
        let q = (supabase.from('vw_fin_titulos_abertos' as any) as any).select(
          'id, cliente_id, vencimento, valor, situacao, dias_atraso, vencido, boleto_gerado',
        );
        if (tid) q = q.eq('tenant_id', tid);
        return q.order('vencimento', { ascending: true });
      });
      return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
    },
  });
}

/** Estado de cada conector: é o que diz se dá para confiar nos números da tela. */
export function useFinSyncEstado() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<FinSyncEstado[]>({
    queryKey: ['fin-sync-estado', tid],
    staleTime: 60 * 1000,
    queryFn: async () => {
      let q = (supabase.from('fin_sync_estado' as any) as any).select(
        'origem, ultima_leitura_ok, ultima_tentativa, ultimo_status, ultimo_erro, titulos_lidos',
      );
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as FinSyncEstado[];
    },
  });
}

export interface FiltrosTitulos {
  situacoes: FinSituacao[];
  busca: string;
  venceDe: string | null;
  venceAte: string | null;
  semCliente: boolean;
}

/** Lista de títulos da aba Títulos, com o cliente embutido quando existe vínculo. */
export function useFinTitulos(filtros: FiltrosTitulos) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<FinTitulo[]>({
    queryKey: ['fin-titulos', tid, filtros],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<FinTitulo>(() => {
        let q = (supabase.from('fin_titulos' as any) as any).select(
          'id, origem, origem_id, cliente_id, cnpj_cpf_digits, numero_documento, parcela, emissao, vencimento, valor, situacao, situacao_origem, boleto_gerado, codigo_barras, link_boleto, pix_copia_cola, link_nfse, visto_em, clientes(razao_social, nome_fantasia, cnpj)',
        );
        if (tid) q = q.eq('tenant_id', tid);
        if (filtros.situacoes.length > 0) q = q.in('situacao', filtros.situacoes);
        if (filtros.venceDe) q = q.gte('vencimento', filtros.venceDe);
        if (filtros.venceAte) q = q.lte('vencimento', filtros.venceAte);
        if (filtros.semCliente) q = q.is('cliente_id', null);
        const termo = filtros.busca.trim();
        if (termo) {
          // Busca por documento ou por CNPJ do título. O nome do cliente é
          // filtrado na memória depois, porque filtrar por coluna de tabela
          // embutida anularia o índice de tenant + vencimento.
          const digitos = termo.replace(/\D/g, '');
          q = digitos.length >= 3
            ? q.or(`numero_documento.ilike.%${termo}%,cnpj_cpf_digits.ilike.%${digitos}%`)
            : q.ilike('numero_documento', `%${termo}%`);
        }
        // Do vencimento mais antigo para o mais novo: numa tela de cobrança o
        // que interessa é o que está apodrecendo, não a parcela de 2027.
        return q.order('vencimento', { ascending: true });
      });

      const termo = filtros.busca.trim().toLowerCase();
      const comNumero = rows.map((r) => ({ ...r, valor: Number(r.valor) }));
      if (!termo) return comNumero;

      // Quando a busca tem letras, o nome do cliente também vale como critério.
      const soDigitos = /^\d+$/.test(termo);
      if (soDigitos) return comNumero;
      return comNumero.filter((r) => {
        const nome = `${r.clientes?.nome_fantasia ?? ''} ${r.clientes?.razao_social ?? ''}`.toLowerCase();
        return nome.includes(termo) || (r.numero_documento ?? '').toLowerCase().includes(termo);
      });
    },
  });
}

/** Títulos de um cliente, para a ficha e para a 2ª via no chat. */
export function useFinTitulosDoCliente(clienteId: string | null | undefined) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<FinTitulo[]>({
    queryKey: ['fin-titulos-cliente', tid, clienteId],
    enabled: !!clienteId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      let q = (supabase.from('fin_titulos' as any) as any)
        .select(
          'id, origem, origem_id, cliente_id, numero_documento, parcela, emissao, vencimento, valor, situacao, situacao_origem, boleto_gerado, codigo_barras, link_boleto, pix_copia_cola, link_nfse, visto_em',
        )
        .eq('cliente_id', clienteId);
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q.order('vencimento', { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as FinTitulo[]).map((r) => ({ ...r, valor: Number(r.valor) }));
    },
  });
}
