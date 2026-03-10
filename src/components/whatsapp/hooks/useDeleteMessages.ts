import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useDeleteMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageIds, conversationId }: { messageIds: string[]; conversationId: string }) => {
      const { data, error } = await supabase.functions.invoke('delete-whatsapp-message', {
        body: { messageIds, conversationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.detail || 'Falha ao apagar mensagens');
      return data;
    },
    onSuccess: (data, variables) => {
      // Update cache: mark deleted messages
      queryClient.setQueryData(
        ['whatsapp', 'messages', variables.conversationId],
        (old: any[] | undefined) => {
          if (!old) return old;
          const deletedSet = new Set(data.deleted || []);
          return old.map((m: any) =>
            deletedSet.has(m.id) ? { ...m, status: 'deleted', content: '' } : m
          );
        }
      );
      const count = data.deleted?.length || 0;
      toast.success(`${count} mensagem${count !== 1 ? 'ns' : ''} apagada${count !== 1 ? 's' : ''}`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Erro ao apagar mensagens');
    },
  });
}
