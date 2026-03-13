import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { escapeLike } from '@/lib/utils';
import { toast } from 'sonner';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import type {
  CSTicket,
  CSTicketTipo,
  CSTicketStatus,
  CSTicketPrioridade,
  CSTicketImpacto,
  CSIndicacaoStatus,
  Funcionario,
} from '../types';

interface CreateTicketData {
  tenant_id?: string;
  cliente_id?: string | null;
  tipo: CSTicketTipo;
  assunto: string;
  descricao_curta: string;
  prioridade: CSTicketPrioridade;
  owner_id: number;
  criado_por_id?: number;
  proxima_acao: string;
  proximo_followup_em: string;
  impacto_categoria?: CSTicketImpacto;
  mrr_em_risco?: number | null;
  prob_churn_percent?: number | null;
  prob_sucesso_percent?: number | null;
  indicacao_nome?: string | null;
  indicacao_contato?: string | null;
  indicacao_cidade?: string | null;
  indicacao_status?: CSIndicacaoStatus | null;
  contato_externo_nome?: string | null;
  oport_valor_previsto_ativacao?: number | null;
  oport_valor_previsto_mrr?: number | null;
  oport_data_prevista?: string | null;
  oport_resultado?: string | null;
}

interface UpdateTicketData {
  id: string;
  tipo?: CSTicketTipo;
  assunto?: string;
  descricao_curta?: string;
  status?: CSTicketStatus;
  prioridade?: CSTicketPrioridade;
  escalado?: boolean;
  owner_id?: number;
  proxima_acao?: string;
  proximo_followup_em?: string;
  impacto_categoria?: CSTicketImpacto;
  mrr_em_risco?: number | null;
  mrr_recuperado?: number | null;
  prob_churn_percent?: number | null;
  prob_sucesso_percent?: number | null;
  primeira_acao_em?: string | null;
  concluido_em?: string | null;
  indicacao_nome?: string | null;
  indicacao_contato?: string | null;
  indicacao_cidade?: string | null;
  indicacao_status?: CSIndicacaoStatus | null;
  contato_externo_nome?: string | null;
  oport_valor_previsto_ativacao?: number | null;
  oport_valor_previsto_mrr?: number | null;
  oport_data_prevista?: string | null;
  oport_resultado?: string | null;
}

interface TicketsFilter {
  status?: CSTicketStatus[];
  prioridade?: CSTicketPrioridade[];
  tipo?: CSTicketTipo[];
  owner_id?: number;
  cliente_id?: string;
  escalado?: boolean;
  search?: string;
}

export function useFuncionariosAtivos() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ['funcionarios-ativos', tid],
    queryFn: async () => {
      let q = supabase
        .from('funcionarios')
        .select('*')
        .eq('ativo', true)
        .order('nome');
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q;
      if (error) throw error;
      return data as Funcionario[];
    },
  });
}

export function useCSTickets(filters?: TicketsFilter) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ['cs-tickets', filters, tid],
    queryFn: async () => {
      let query = supabase
        .from('cs_tickets')
        .select(`
          *,
          cliente:clientes!cs_tickets_cliente_id_fkey (
            id, razao_social, nome_fantasia, mensalidade, cancelado, telefone_whatsapp
          ),
          owner:funcionarios!cs_tickets_owner_id_fkey (
            id, nome, cargo, ativo, email
          ),
          criado_por:funcionarios!cs_tickets_criado_por_id_fkey (
            id, nome, cargo, ativo, email
          )
        `)
        .order('criado_em', { ascending: false });

      if (filters?.status && filters.status.length > 0) {
        query = query.in('status', filters.status);
      }
      if (filters?.prioridade && filters.prioridade.length > 0) {
        query = query.in('prioridade', filters.prioridade);
      }
      if (filters?.tipo && filters.tipo.length > 0) {
        query = query.in('tipo', filters.tipo);
      }
      if (filters?.owner_id) {
        query = query.eq('owner_id', filters.owner_id);
      }
      if (filters?.cliente_id) {
        query = query.eq('cliente_id', filters.cliente_id);
      }
      if (filters?.escalado !== undefined) {
        query = query.eq('escalado', filters.escalado);
      }
      if (filters?.search) {
        const escaped = escapeLike(filters.search);
        query = query.or(`assunto.ilike.%${escaped}%,descricao_curta.ilike.%${escaped}%`);
      }
      if (tid) {
        query = query.eq('tenant_id', tid);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as CSTicket[];
    },
  });
}

export function useCSTicket(ticketId: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ['cs-ticket', ticketId, tid],
    queryFn: async () => {
      if (!ticketId) return null;

      const { data, error } = await supabase
        .from('cs_tickets')
        .select(`
          *,
          cliente:clientes!cs_tickets_cliente_id_fkey (
            id, razao_social, nome_fantasia, mensalidade, cancelado, telefone_whatsapp
          ),
          owner:funcionarios!cs_tickets_owner_id_fkey (
            id, nome, cargo, ativo, email
          ),
          criado_por:funcionarios!cs_tickets_criado_por_id_fkey (
            id, nome, cargo, ativo, email
          )
        `)
        .eq('id', ticketId)
        .single();

      if (error) throw error;
      return data as unknown as CSTicket;
    },
    enabled: !!ticketId,
  });
}

export function useCreateCSTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTicketData) => {
      const { data: result, error } = await supabase
        .from('cs_tickets')
        .insert(data as any)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
      toast.success('Ticket criado com sucesso!');
    },
    onError: (error) => {
      console.error('Error creating ticket:', error);
      toast.error('Erro ao criar ticket');
    },
  });
}

export function useUpdateCSTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateTicketData) => {
      const { data: result, error } = await supabase
        .from('cs_tickets')
        .update(data as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['cs-ticket', variables.id] });
      toast.success('Ticket atualizado!');
    },
    onError: (error) => {
      console.error('Error updating ticket:', error);
      toast.error('Erro ao atualizar ticket');
    },
  });
}

export function useDeleteCSTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase
        .from('cs_tickets')
        .delete()
        .eq('id', ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
      toast.success('Ticket excluído!');
    },
    onError: (error) => {
      console.error('Error deleting ticket:', error);
      toast.error('Erro ao excluir ticket');
    },
  });
}
