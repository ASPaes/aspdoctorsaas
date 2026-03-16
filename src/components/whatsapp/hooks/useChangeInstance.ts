import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ChangeInstanceParams {
  conversationId: string;
  targetInstanceId: string;
}

export const useChangeInstance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, targetInstanceId }: ChangeInstanceParams) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ instance_id: targetInstanceId })
        .eq('id', conversationId);

      if (error) throw error;
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