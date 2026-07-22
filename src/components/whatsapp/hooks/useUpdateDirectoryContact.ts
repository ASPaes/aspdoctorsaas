import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface UpdateDirectoryContactInput {
  contactId: string;
  name: string;
  /** Telefone normalizado (55 + DDD + número) ou null/'' para não alterar (grupo). */
  phone?: string | null;
  notes?: string | null;
  /** null = desvincular do cliente. */
  clienteId?: string | null;
}

/**
 * Atualiza um contato de diretório em whatsapp_contacts (nome, telefone, notas,
 * cliente) via RPC update_wa_directory_contact — valida cross-tenant, checa
 * colisão de telefone e espelha em cliente_contatos ao vincular.
 */
export function useUpdateDirectoryContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateDirectoryContactInput): Promise<void> => {
      const { error } = await (supabase as any).rpc('update_wa_directory_contact', {
        p_contact_id: input.contactId,
        p_name: input.name.trim(),
        p_phone: input.phone || null,
        p_notes: input.notes ?? null,
        p_cliente_id: input.clienteId || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['linked-cliente'] });
      queryClient.invalidateQueries({ queryKey: ['contact-details', input.contactId] });
    },
  });
}
