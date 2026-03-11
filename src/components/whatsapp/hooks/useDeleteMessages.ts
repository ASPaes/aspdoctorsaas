import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type DeleteMode = 'local' | 'everyone';

export function useDeleteMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageIds,
      conversationId,
      mode,
    }: {
      messageIds: string[];
      conversationId: string;
      mode: DeleteMode;
    }) => {
      const { data, error } = await supabase.functions.invoke('delete-whatsapp-message', {
        body: { messageIds, conversationId, mode },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.detail || 'Falha ao apagar mensagens');
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        ['whatsapp', 'messages', variables.conversationId],
        (old: any[] | undefined) => {
          if (!old) return old;

          if (variables.mode === 'local') {
            const deletedSet = new Set(data.deleted || []);
            return old.map((m: any) =>
              deletedSet.has(m.id)
                ? { ...m, delete_status: 'revoked', delete_scope: 'local' }
                : m
            );
          }

          // mode === 'everyone'
          const pendingSet = new Set(data.pending || []);
          const failedSet = new Set(data.failed || []);
          return old.map((m: any) => {
            if (pendingSet.has(m.id)) {
              return { ...m, delete_status: 'pending', delete_scope: 'everyone' };
            }
            if (failedSet.has(m.id)) {
              return { ...m, delete_status: 'failed', delete_scope: 'everyone' };
            }
            return m;
          });
        }
      );

      if (variables.mode === 'local') {
        const count = data.deleted?.length || 0;
        toast.success(`${count} mensagem${count !== 1 ? 'ns' : ''} excluída${count !== 1 ? 's' : ''} do sistema`);
      } else {
        const pendingCount = data.pending?.length || 0;
        const failedCount = data.failed?.length || 0;
        if (pendingCount > 0) {
          toast.success(`Apagando ${pendingCount} mensagem${pendingCount !== 1 ? 'ns' : ''} para todos…`);
        }
        if (failedCount > 0) {
          toast.error(`${failedCount} mensagem${failedCount !== 1 ? 'ns' : ''} não pôde${failedCount !== 1 ? 'ram' : ''} ser apagada${failedCount !== 1 ? 's' : ''}`);
        }
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Erro ao apagar mensagens');
    },
  });
}
