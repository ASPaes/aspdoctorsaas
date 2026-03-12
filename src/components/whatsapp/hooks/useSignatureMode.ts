import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SignatureMode = 'name' | 'none' | 'ticket';

interface SignatureSettings {
  mode: SignatureMode;
  ticketCode: string | null;
}

export const useSignatureMode = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SignatureSettings>({
    queryKey: ['whatsapp', 'signature', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('sender_signature_mode, sender_ticket_code')
        .eq('id', conversationId!)
        .single();
      if (error) throw error;
      return {
        mode: ((data as any).sender_signature_mode || 'name') as SignatureMode,
        ticketCode: (data as any).sender_ticket_code || null,
      };
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (settings: Partial<SignatureSettings>) => {
      const updateData: Record<string, any> = {};
      if (settings.mode !== undefined) updateData.sender_signature_mode = settings.mode;
      if (settings.ticketCode !== undefined) updateData.sender_ticket_code = settings.ticketCode || null;

      const { error } = await supabase
        .from('whatsapp_conversations')
        .update(updateData)
        .eq('id', conversationId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'signature', conversationId] });
    },
  });

  return {
    mode: data?.mode ?? 'name',
    ticketCode: data?.ticketCode ?? null,
    isLoading,
    update: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
};
