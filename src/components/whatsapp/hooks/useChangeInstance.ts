import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ChangeInstanceParams {
  conversationId: string;
  currentContactId: string;
  targetInstanceId: string;
  tenantId: string;
}

export const useChangeInstance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, currentContactId, targetInstanceId, tenantId }: ChangeInstanceParams) => {
      // 1. Get current contact data
      const { data: currentContact, error: contactErr } = await supabase
        .from('whatsapp_contacts')
        .select('phone_number, name, profile_picture_url, tags, is_group, notes')
        .eq('id', currentContactId)
        .single();

      if (contactErr || !currentContact) throw new Error('Contato não encontrado');

      // 2. Find existing contact on target instance
      const { data: existingContact } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .eq('instance_id', targetInstanceId)
        .eq('phone_number', currentContact.phone_number)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      let targetContactId: string;

      if (existingContact) {
        targetContactId = existingContact.id;
      } else {
        // 3. Create new contact on target instance
        const { data: newContact, error: createErr } = await supabase
          .from('whatsapp_contacts')
          .insert({
            instance_id: targetInstanceId,
            tenant_id: tenantId,
            phone_number: currentContact.phone_number,
            name: currentContact.name,
            profile_picture_url: currentContact.profile_picture_url,
            tags: currentContact.tags || [],
            is_group: currentContact.is_group,
            notes: currentContact.notes,
          })
          .select('id')
          .single();

        if (createErr || !newContact) throw new Error('Erro ao criar contato na nova instância');
        targetContactId = newContact.id;
      }

      // 4. Update conversation
      const { error: updateErr } = await supabase
        .from('whatsapp_conversations')
        .update({
          instance_id: targetInstanceId,
          contact_id: targetContactId,
        })
        .eq('id', conversationId);

      if (updateErr) throw updateErr;

      return { targetContactId };
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
