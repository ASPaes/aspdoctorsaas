import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeBRPhone, coreDigits } from '@/lib/phoneBR';

interface LinkedCliente {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  codigo_sequencial: number;
  /** Coluna gerada em clientes: só dígitos. Vai no &cnpj= da janelinha do AcessoFast. */
  cnpj_digits: string | null;
}

export interface ClienteCandidato {
  cliente_id: string;
  codigo_sequencial: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  fornecedor_nome: string | null;
  telefone_whatsapp: string | null;
  cancelado: boolean;
  fonte_match: string;
}

export function useClienteLinkSuggestion(
  conversationId: string,
  phoneNumber: string,
  currentMetadata: Record<string, unknown> | null,
  attendanceId: string | null,
  tenantId: string | null,
) {
  const queryClient = useQueryClient();
  const metadataClienteId = (currentMetadata as any)?.cliente_id as string | undefined;

  // 0) Fonte de verdade: cliente_id do attendance
  const attendanceClienteQuery = useQuery({
    queryKey: ['attendance-cliente', attendanceId],
    queryFn: async (): Promise<string | null> => {
      if (!attendanceId) return null;
      const { data } = await supabase
        .from('support_attendances')
        .select('cliente_id')
        .eq('id', attendanceId)
        .maybeSingle();
      return (data as any)?.cliente_id ?? null;
    },
    enabled: !!attendanceId,
    staleTime: 30_000,
  });

  const linkedClienteId: string | null =
    attendanceClienteQuery.data ?? (attendanceId ? null : (metadataClienteId ?? null));

  // 1) Cliente já vinculado (carrega detalhes leves)
  const linkedQuery = useQuery({
    queryKey: ['cliente-linked', linkedClienteId],
    queryFn: async (): Promise<LinkedCliente | null> => {
      if (!linkedClienteId) return null;
      const { data } = await supabase
        .from('clientes')
        .select('id, razao_social, nome_fantasia, codigo_sequencial, cnpj_digits')
        .eq('id', linkedClienteId)
        .maybeSingle();
      return data;
    },
    enabled: !!linkedClienteId,
    staleTime: 5 * 60 * 1000,
  });

  // 2) Candidatos via RPC (UNION dedup das 2 fontes)
  const candidatesQuery = useQuery({
    queryKey: ['cliente-candidatos-by-phone', tenantId, phoneNumber],
    queryFn: async (): Promise<ClienteCandidato[]> => {
      if (!phoneNumber) return [];
      if (!tenantId) return [];

      const { data, error } = await supabase.rpc('get_clientes_candidatos_by_phone', {
        p_tenant_id: tenantId,
        p_phone: phoneNumber,
      });
      if (error) throw error;
      return (data ?? []) as ClienteCandidato[];
    },
    enabled: !!phoneNumber && !!tenantId,
    staleTime: 60_000,
  });

  const candidates = candidatesQuery.data ?? [];

  const suggestedCliente: LinkedCliente | null =
    !linkedClienteId && candidates.length === 1
      ? {
          id: candidates[0].cliente_id,
          razao_social: candidates[0].razao_social,
          nome_fantasia: candidates[0].nome_fantasia,
          codigo_sequencial: candidates[0].codigo_sequencial ?? 0,
          cnpj_digits: null,
        }
      : null;

  // 3) Mutação link
  const linkMutation = useMutation({
    mutationFn: async (clienteId: string) => {
      // Resolver attendanceId em runtime — elimina race com useRelevantAttendance
      let resolvedAttendanceId = attendanceId;
      if (!resolvedAttendanceId) {
        const { data: active } = await supabase
          .from('support_attendances')
          .select('id')
          .eq('conversation_id', conversationId)
          .neq('status', 'closed')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedAttendanceId = active?.id ?? null;
      }

      if (resolvedAttendanceId) {
        const { error } = await supabase.rpc('set_attendance_cliente', {
          p_attendance_id: resolvedAttendanceId,
          p_cliente_id: clienteId,
        });
        if (error) throw error;
        return;
      }

      // LEGACY (conversa sem atendimento — raro)
      const newMetadata = { ...(currentMetadata || {}), cliente_id: clienteId } as any;
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ metadata: newMetadata })
        .eq('id', conversationId);
      if (error) throw error;

      try {
        const { data: conv } = await supabase
          .from('whatsapp_conversations')
          .select('contact_id')
          .eq('id', conversationId)
          .single();
        if (!conv?.contact_id) return;

        const { data: contact } = await supabase
          .from('whatsapp_contacts')
          .select('phone_number, name')
          .eq('id', conv.contact_id)
          .single();
        if (!contact?.phone_number) return;

        const { data: cliente } = await supabase
          .from('clientes')
          .select('telefone_whatsapp, tenant_id')
          .eq('id', clienteId)
          .single();
        if (!cliente) return;

        const contactDigits = normalizeBRPhone(contact.phone_number);
        const contactCore = coreDigits(contact.phone_number);
        const mainCore = coreDigits(cliente.telefone_whatsapp || '');

        if (contactCore.length >= 10 && contactCore !== mainCore) {
          const { data: existing } = await supabase
            .from('cliente_contatos')
            .select('id')
            .eq('cliente_id', clienteId)
            .eq('fone', contactDigits)
            .maybeSingle();

          if (!existing) {
            await supabase.from('cliente_contatos').insert({
              cliente_id: clienteId,
              tenant_id: cliente.tenant_id,
              nome: contact.name || contactDigits,
              fone: contactDigits,
            });
            toast.info('Contato adicional registrado para este cliente.');
          }
        }
      } catch (e) {
        console.warn('[link-cliente legacy] Erro ao criar contato adicional:', e);
      }
    },
    onSuccess: () => {
      toast.success('Cliente vinculado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-linked'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-candidatos-by-phone'] });
      queryClient.invalidateQueries({ queryKey: ['relevant-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-cliente'] });
    },
    onError: (err: any) => toast.error(`Erro ao vincular cliente: ${err?.message ?? 'desconhecido'}`),
  });

  // 4) Mutação unlink
  const unlinkMutation = useMutation({
    mutationFn: async (removePhoneFromContacts: boolean = false) => {
      const { error } = await supabase.rpc('unlink_cliente_from_conversation', {
        p_conversation_id: conversationId,
        p_remove_phone_from_contacts: removePhoneFromContacts,
      });
      if (error) throw error;
    },
    onSuccess: (_data, removePhoneFromContacts) => {
      toast.success(removePhoneFromContacts ? 'Vínculo e contato removidos' : 'Vínculo removido');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-linked'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-candidatos-by-phone'] });
      queryClient.invalidateQueries({ queryKey: ['relevant-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-cliente'] });
    },
    onError: (err: any) => toast.error(`Erro ao desvincular: ${err?.message ?? 'desconhecido'}`),
  });
  return {
    linkedCliente: linkedQuery.data || null,
    linkedClienteId,
    suggestedCliente: linkedClienteId ? null : suggestedCliente,
    isLinked: !!linkedClienteId,
    linkCliente: (clienteId: string) => linkMutation.mutate(clienteId),
    unlinkCliente: (removePhoneFromContacts: boolean = false) => unlinkMutation.mutate(removePhoneFromContacts),
    isLinking: linkMutation.isPending,
    isUnlinking: unlinkMutation.isPending,
    candidates,
    isAmbiguous: !linkedClienteId && candidates.length >= 2,
    hasNoCandidates: !candidatesQuery.isLoading && candidates.length === 0,
  };
}
