import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

interface CreateConversationParams {
  instanceId: string;
  phoneNumber: string;
  contactName: string;
  profilePictureUrl?: string;
  clienteId?: string;
  departmentId?: string;
}

export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  return useMutation({
    mutationFn: async (params: CreateConversationParams) => {
      if (!tid) {
        throw new Error('Selecione um tenant antes de criar a conversa');
      }

      const { data, error } = await (supabase.rpc as any)('wa_open_or_reuse_conversation', {
        p_tenant_id: tid,
        p_instance_id: params.instanceId,
        p_phone: params.phoneNumber,
        p_contact_name: params.contactName || null,
        p_cliente_id: params.clienteId || null,
        p_department_id: params.departmentId || null,
      });

      if (error) throw error;

      return {
        // 'inactive_contact': contato inativado no diretório (DEM-0365). Vem sem
        // conversa nova; quando já existia uma, o id vem junto só como informação.
        status: data?.status as 'created' | 'reused' | 'blocked' | 'inactive_contact',
        conversationId: data?.conversation_id as string,
        techName: data?.tech_name as string | undefined,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });
};
