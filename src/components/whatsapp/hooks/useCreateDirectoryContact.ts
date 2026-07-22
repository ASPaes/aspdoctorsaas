import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface CreateDirectoryContactInput {
  /** Nome do contato (obrigatório). */
  name: string;
  /** Telefone já normalizado (55 + DDD + número), via normalizeBRPhone. */
  phone: string;
  clienteId?: string | null;
  instanceId?: string | null;
}

export interface CreateDirectoryContactResult {
  contact_id: string;
  already_existed: boolean;
}

/**
 * Cria (ou reaproveita, via dedup) um contato de diretório em whatsapp_contacts,
 * opcionalmente vinculado a um cliente. A RPC create_wa_directory_contact grava
 * de forma atômica em whatsapp_contacts + cliente_contatos e valida cross-tenant.
 */
export function useCreateDirectoryContact() {
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDirectoryContactInput): Promise<CreateDirectoryContactResult> => {
      if (!effectiveTenantId) {
        throw new Error('Selecione um tenant específico para adicionar um contato.');
      }

      const { data, error } = await (supabase as any).rpc('create_wa_directory_contact', {
        p_tenant_id: effectiveTenantId,
        p_name: input.name.trim(),
        p_phone: input.phone,
        p_cliente_id: input.clienteId || null,
        p_instance_id: input.instanceId || null,
      });

      if (error) throw error;

      // RETURNS TABLE(...) chega como array de 1 linha
      const row = Array.isArray(data) ? data[0] : data;
      return row as CreateDirectoryContactResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['linked-cliente'] });
    },
  });
}
