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

      const { data: existingContact } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .eq('tenant_id', tid)
        .eq('phone_number', params.phoneNumber)
        .maybeSingle();

      let contact: any;
      if (existingContact) {
        const updates: any = {};
        if (params.contactName && params.contactName !== existingContact.phone_number) {
          updates.name = params.contactName;
        }
        if (params.profilePictureUrl) {
          updates.profile_picture_url = params.profilePictureUrl;
        }
        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('whatsapp_contacts')
            .update(updates)
            .eq('id', existingContact.id)
            .eq('tenant_id', tid);
          if (updateError) throw updateError;
        }
        contact = existingContact;
      } else {
        const { data: newContact, error: contactError } = await (supabase
          .from('whatsapp_contacts') as any)
          .insert({
            tenant_id: tid,
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
        .eq('tenant_id', tid)
        .eq('instance_id', params.instanceId)
        .eq('contact_id', contact.id)
        .maybeSingle();

      if (existingConv) {
        if (params.clienteId && !(existingConv.metadata as any)?.cliente_id) {
          const { error: updateConversationError } = await supabase
            .from('whatsapp_conversations')
            .update({ metadata: { ...((existingConv.metadata as any) || {}), cliente_id: params.clienteId } })
            .eq('id', existingConv.id)
            .eq('tenant_id', tid);
          if (updateConversationError) throw updateConversationError;
        }
        return { conversation: existingConv, contact };
      }

      const metadata = params.clienteId ? { cliente_id: params.clienteId } : {};
      const { data: conversation, error: convError } = await (supabase
        .from('whatsapp_conversations') as any)
        .insert({
          tenant_id: tid,
          instance_id: params.instanceId,
          contact_id: contact.id,
          status: 'active',
          unread_count: 0,
          metadata,
          department_id: params.departmentId || null,
        })
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
