import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type DeleteMode = 'panel_only' | 'everyone';

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
      // Optimistically update messages in cache
      queryClient.setQueryData(
        ['whatsapp', 'messages', variables.conversationId],
        (old: any[] | undefined) => {
          if (!old) return old;

          if (variables.mode === 'panel_only') {
            const deletedSet = new Set(data.deleted || []);
            return old.map((m: any) =>
              deletedSet.has(m.id)
                ? { ...m, delete_status: 'revoked', delete_scope: 'local', message_type: 'revoked', content: '', media_url: null }
                : m
            );
          }

          // mode === 'everyone'
          const pendingSet = new Set(data.pending || []);
          const failedSet = new Set(data.failed || []);
          return old.map((m: any) => {
            if (pendingSet.has(m.id)) {
              return { ...m, delete_status: 'revoked', delete_scope: 'everyone', message_type: 'revoked', content: '', media_url: null };
            }
            if (failedSet.has(m.id)) {
              return { ...m, delete_status: 'failed', delete_scope: 'everyone' };
            }
            return m;
          });
        }
      );

      // Invalidate conversations list to refresh sidebar preview
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });

      if (variables.mode === 'panel_only') {
        const count = data.deleted?.length || 0;
        toast.success(`${count} mensagem${count !== 1 ? 'ns' : ''} removida${count !== 1 ? 's' : ''} do painel`);
      } else {
        const pendingCount = data.pending?.length || 0;
        const failedCount = data.failed?.length || 0;
        if (pendingCount > 0) {
          toast.success(`${pendingCount} mensagem${pendingCount !== 1 ? 'ns' : ''} apagada${pendingCount !== 1 ? 's' : ''} para todos`);
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
