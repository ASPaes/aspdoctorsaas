import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeBRPhone, coreDigits } from '@/lib/phoneBR';

interface LinkedCliente {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  codigo_sequencial: number;
}

export function useClienteLinkSuggestion(
  conversationId: string,
  phoneNumber: string,
  currentMetadata: Record<string, unknown> | null
) {
  const queryClient = useQueryClient();
  const linkedClienteId = (currentMetadata as any)?.cliente_id as string | undefined;

  // If already linked, fetch the linked cliente
  const linkedQuery = useQuery({
    queryKey: ['cliente-linked', linkedClienteId],
    queryFn: async (): Promise<LinkedCliente | null> => {
      if (!linkedClienteId) return null;
      const { data } = await supabase
        .from('clientes')
        .select('id, razao_social, nome_fantasia, codigo_sequencial')
        .eq('id', linkedClienteId)
        .maybeSingle();
      return data;
    },
    enabled: !!linkedClienteId,
  });

  // Suggest a match by phone number
  const suggestionQuery = useQuery({
    queryKey: ['cliente-suggestion', phoneNumber],
    queryFn: async (): Promise<LinkedCliente | null> => {
      if (!phoneNumber) return null;
      const digits = phoneNumber.replace(/\D/g, '');
      if (digits.length < 10) return null;

      // Get current user's tenant via RLS
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile?.tenant_id) return null;

      // Try exact match on digits within same tenant
      const { data } = await supabase
        .from('clientes')
        .select('id, razao_social, nome_fantasia, codigo_sequencial, telefone_whatsapp')
        .eq('cancelado', false)
        .eq('tenant_id', profile.tenant_id)
        .not('telefone_whatsapp', 'is', null)
        .limit(50);

      if (!data) return null;

      // Normalize and compare
      const match = data.find((c) => {
        const cDigits = (c.telefone_whatsapp || '').replace(/\D/g, '');
        if (!cDigits) return false;
        // Compare last 10-11 digits to handle country code variations
        const dCore = digits.replace(/^55/, '');
        const cCore = cDigits.replace(/^55/, '');
        return dCore.length >= 10 && dCore === cCore;
      });

      return match ? { id: match.id, razao_social: match.razao_social, nome_fantasia: match.nome_fantasia, codigo_sequencial: match.codigo_sequencial } : null;
    },
    enabled: !linkedClienteId && !!phoneNumber,
  });

  const linkMutation = useMutation({
    mutationFn: async (clienteId: string) => {
      const newMetadata = { ...(currentMetadata || {}), cliente_id: clienteId } as any;
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ metadata: newMetadata })
        .eq('id', conversationId);
      if (error) throw error;

      // --- Auto-create cliente_contatos if phone differs from principal ---
      try {
        // 1) Get contact_id from conversation
        const { data: conv } = await supabase
          .from('whatsapp_conversations')
          .select('contact_id')
          .eq('id', conversationId)
          .single();
        if (!conv?.contact_id) return;

        // 2) Get contact phone + name
        const { data: contact } = await supabase
          .from('whatsapp_contacts')
          .select('phone_number, name')
          .eq('id', conv.contact_id)
          .single();
        if (!contact?.phone_number) return;

        // 3) Get cliente principal phone + tenant
        const { data: cliente } = await supabase
          .from('clientes')
          .select('telefone_whatsapp, tenant_id')
          .eq('id', clienteId)
          .single();
        if (!cliente) return;

        const contactDigits = normalizeBRPhone(contact.phone_number);
        const mainDigits = normalizeBRPhone(cliente.telefone_whatsapp || '');
        const contactCore = coreDigits(contact.phone_number);
        const mainCore = coreDigits(cliente.telefone_whatsapp || '');

        // Only create if different and valid
        if (contactCore.length >= 10 && contactCore !== mainCore) {
          // Check for existing
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
        console.warn('[link-cliente] Erro ao criar contato adicional:', e);
      }
    },
    onSuccess: () => {
      toast.success('Cliente vinculado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-linked'] });
    },
    onError: () => toast.error('Erro ao vincular cliente'),
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const newMetadata = { ...(currentMetadata || {}) } as any;
      delete newMetadata.cliente_id;
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ metadata: newMetadata })
        .eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Vínculo removido');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-linked'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-suggestion'] });
    },
    onError: () => toast.error('Erro ao desvincular'),
  });

  return {
    linkedCliente: linkedQuery.data || null,
    suggestedCliente: linkedClienteId ? null : (suggestionQuery.data || null),
    isLinked: !!linkedClienteId,
    linkCliente: (clienteId: string) => linkMutation.mutate(clienteId),
    unlinkCliente: () => unlinkMutation.mutate(),
    isLinking: linkMutation.isPending,
    isUnlinking: unlinkMutation.isPending,
  };
}
