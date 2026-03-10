import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useForwardMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageIds, targetConversationId }: { messageIds: string[]; targetConversationId: string }) => {
      const { data, error } = await supabase.functions.invoke('forward-whatsapp-message', {
        body: { messageIds, targetConversationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.detail || 'Falha ao encaminhar mensagens');
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.targetConversationId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      const count = data.forwarded?.length || 0;
      toast.success(`${count} mensagem${count !== 1 ? 'ns' : ''} encaminhada${count !== 1 ? 's' : ''}`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Erro ao encaminhar mensagens');
    },
  });
}
