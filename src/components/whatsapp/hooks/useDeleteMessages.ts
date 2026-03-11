import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCallback, useRef } from 'react';

type DeleteMode = 'panel_only' | 'everyone';

const REVOKE_TIMEOUT_MS = 15_000; // 15 seconds

export function useDeleteMessages() {
  const queryClient = useQueryClient();
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Start polling/timeout for pending messages - revert to failed if no confirmation
  const startRevokeTimeout = useCallback((messageId: string, conversationId: string) => {
    // Clear any existing timer
    const existing = pendingTimers.current.get(messageId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingTimers.current.delete(messageId);

      // Check current status in DB
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('delete_status')
        .eq('id', messageId)
        .maybeSingle();

      if (data?.delete_status === 'pending') {
        // Still pending after timeout — mark as failed
        await supabase
          .from('whatsapp_messages')
          .update({
            delete_status: 'failed',
            delete_error: 'Timeout: sem confirmação do WhatsApp em 15s',
          })
          .eq('id', messageId);

        // Update cache
        queryClient.setQueryData(
          ['whatsapp', 'messages', conversationId],
          (old: any[] | undefined) => {
            if (!old) return old;
            return old.map((m: any) =>
              m.id === messageId
                ? { ...m, delete_status: 'failed', delete_error: 'Timeout: sem confirmação do WhatsApp em 15s' }
                : m
            );
          }
        );

        toast.error('Não foi possível apagar no WhatsApp do cliente. A mensagem pode ter expirado.');
      }
    }, REVOKE_TIMEOUT_MS);

    pendingTimers.current.set(messageId, timer);
  }, [queryClient]);

  const mutation = useMutation({
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
              return { ...m, delete_status: 'pending', delete_scope: 'everyone' };
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
          toast.info(`Apagando ${pendingCount} mensagem${pendingCount !== 1 ? 'ns' : ''}… aguardando confirmação do WhatsApp`);
          // Start timeout for each pending message
          for (const msgId of (data.pending || [])) {
            startRevokeTimeout(msgId, variables.conversationId);
          }
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

  return mutation;
}
