import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CreateConversationParams {
  instanceId: string;
  phoneNumber: string;
  contactName: string;
  profilePictureUrl?: string;
  clienteId?: string;
}

export const useCreateConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateConversationParams) => {
      const contactPayload = {
        instance_id: params.instanceId,
        phone_number: params.phoneNumber,
        name: params.contactName,
        profile_picture_url: params.profilePictureUrl,
      };

      const { data: contact, error: contactError } = await (supabase
        .from('whatsapp_contacts') as any)
        .upsert(contactPayload, { onConflict: 'instance_id,phone_number' })
        .select()
        .single();

      if (contactError) throw contactError;

      const { data: existingConv } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('instance_id', params.instanceId)
        .eq('contact_id', contact.id)
        .maybeSingle();

      if (existingConv) {
        // If clienteId provided and not yet linked, update metadata
        if (params.clienteId && !(existingConv.metadata as any)?.cliente_id) {
          await supabase
            .from('whatsapp_conversations')
            .update({ metadata: { ...(existingConv.metadata as any || {}), cliente_id: params.clienteId } })
            .eq('id', existingConv.id);
        }
        return { conversation: existingConv, contact };
      }

      const metadata = params.clienteId ? { cliente_id: params.clienteId } : {};
      const { data: conversation, error: convError } = await (supabase
        .from('whatsapp_conversations') as any)
        .insert({ instance_id: params.instanceId, contact_id: contact.id, status: 'active', unread_count: 0, metadata })
        .select()
        .single();

      if (convError) throw convError;
      return { conversation, contact };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });
};
