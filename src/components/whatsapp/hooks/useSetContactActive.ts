import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SetContactActiveInput {
  contactId: string;
  active: boolean;
  /** Só é guardado ao inativar; reativar limpa. */
  reason?: string | null;
}

/**
 * Liga/desliga um contato do diretório (DEM-0365) via RPC set_wa_contact_active.
 *
 * Inativo some da busca de contatos e não abre conversa nova — a RPC
 * wa_open_or_reuse_conversation recusa com status 'inactive_contact'. Nada é
 * apagado: conversas, mensagens, atendimentos e CSAT ficam onde estão.
 */
export function useSetContactActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetContactActiveInput): Promise<void> => {
      const { error } = await (supabase as any).rpc('set_wa_contact_active', {
        p_contact_id: input.contactId,
        p_active: input.active,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts-search'] });
      queryClient.invalidateQueries({ queryKey: ['contact-details', input.contactId] });
    },
  });
}
