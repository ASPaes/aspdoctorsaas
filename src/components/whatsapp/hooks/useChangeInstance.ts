import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ChangeInstanceParams {
  conversationId: string;
  contactId: string;
  targetInstanceId: string;
}

interface ChangeInstanceResult {
  /** The conversation ID on the target instance (may be new or existing) */
  targetConversationId: string;
}

/**
 * With per-instance conversations, "changing instance" means finding/creating
 * a conversation for the same contact on the target instance.
 */
export const useChangeInstance = () => {
  const queryClient = useQueryClient();

  return useMutation<ChangeInstanceResult, Error, ChangeInstanceParams>({
    mutationFn: async ({ contactId, targetInstanceId }: ChangeInstanceParams) => {
      // Look for an existing conversation on the target instance for this contact
      const { data: existing } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('instance_id', targetInstanceId)
        .eq('contact_id', contactId)
        .maybeSingle();

      if (existing) {
        return { targetConversationId: existing.id };
      }

      // Create a new conversation on the target instance
      const { data: newConv, error } = await (supabase
        .from('whatsapp_conversations') as any)
        .insert({
          instance_id: targetInstanceId,
          contact_id: contactId,
          status: 'active',
          unread_count: 0,
        })
        .select('id')
        .single();

      if (error) throw error;
      return { targetConversationId: newConv.id };
    },
    onSuccess: () => {
      toast.success('Instância trocada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (err: Error) => {
      toast.error(`Erro ao trocar instância: ${err.message}`);
    },
  });
};
