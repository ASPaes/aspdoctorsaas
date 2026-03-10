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
      // Look up existing contact by tenant-scoped phone number
      const { data: existingContact } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .eq('phone_number', params.phoneNumber)
        .maybeSingle();

      let contact: any;
      if (existingContact) {
        // Update name/picture if provided
        const updates: any = {};
        if (params.contactName && params.contactName !== existingContact.phone_number) {
          updates.name = params.contactName;
        }
        if (params.profilePictureUrl) {
          updates.profile_picture_url = params.profilePictureUrl;
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from('whatsapp_contacts').update(updates).eq('id', existingContact.id);
        }
        contact = existingContact;
      } else {
        const { data: newContact, error: contactError } = await (supabase
          .from('whatsapp_contacts') as any)
          .insert({
            phone_number: params.phoneNumber,
            name: params.contactName,
            profile_picture_url: params.profilePictureUrl,
            instance_id: params.instanceId,
          })
          .select()
          .single();
        if (contactError) throw contactError;
        contact = newContact;
      }

      const { data: existingConv } = await supabase
        .from('whatsapp_conversations')
        .select('*')
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
