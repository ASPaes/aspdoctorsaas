import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeMessage, upsertInfinite, type MsgPages } from './useWhatsAppMessages';

interface EditMessageParams {
  messageId: string;
  conversationId: string;
  newContent: string;
}

export const useEditMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: EditMessageParams) => {
      const { data, error } = await supabase.functions.invoke('edit-whatsapp-message', { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      if (data.success) {
        toast.success('Mensagem editada com sucesso');
        // Patch direto no cache: a query de mensagens é infinita e invalidar
        // refaria TODAS as páginas já carregadas (mesma razão do catch-up do
        // realtime em useWhatsAppMessages).
        if (data.message) {
          queryClient.setQueryData<MsgPages>(
            ['whatsapp', 'messages', variables.conversationId],
            (old) => upsertInfinite(old, normalizeMessage(data.message))
          );
        }
        queryClient.invalidateQueries({ queryKey: ['message-edit-history', variables.messageId] });
      } else {
        toast.error(data.error || 'Erro ao editar mensagem');
      }
    },
    onError: (error: any) => { toast.error(error.message || 'Erro ao editar mensagem'); },
  });
};
