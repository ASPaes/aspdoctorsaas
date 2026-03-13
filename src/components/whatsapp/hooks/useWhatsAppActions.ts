import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Helper: optimistically patch a conversation in all sidebar query caches.
 */
function patchConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  patch: Record<string, any>
) {
  queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
    if (!old?.conversations) return old;
    const idx = old.conversations.findIndex((c: any) => c.id === conversationId);
    if (idx === -1) return old;
    const patched = [...old.conversations];
    patched[idx] = { ...patched[idx], ...patch };
    return { ...old, conversations: patched };
  });
}

export const useWhatsAppActions = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const archiveMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'archived' })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onMutate: async (conversationId) => {
      patchConversation(queryClient, conversationId, { status: 'archived' });
    },
    onSuccess: () => {
      toast.success('Conversa arquivada com sucesso');
    },
    onError: () => {
      toast.error('Erro ao arquivar conversa');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async ({ conversationId, generateSummary }: { conversationId: string; generateSummary: boolean }) => {
      if (generateSummary) {
        try {
          await supabase.functions.invoke('generate-conversation-summary', { body: { conversationId } });
        } catch (e) { console.error('Erro ao gerar resumo:', e); }
      }

      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'closed' })
        .eq('id', conversationId);
      if (error) throw error;

      // Close the active support_attendance
      try {
        const { data: activeAtt } = await supabase
          .from('support_attendances')
          .select('id, opened_at, assumed_at, attendance_code')
          .eq('conversation_id', conversationId)
          .neq('status', 'closed')
          .limit(1)
          .maybeSingle();

        if (activeAtt) {
          const now = new Date();
          const openedAt = new Date(activeAtt.opened_at);
          const assumedAt = activeAtt.assumed_at ? new Date(activeAtt.assumed_at) : null;

          const waitSec = assumedAt
            ? Math.round((assumedAt.getTime() - openedAt.getTime()) / 1000)
            : Math.round((now.getTime() - openedAt.getTime()) / 1000);
          const handleSec = assumedAt
            ? Math.round((now.getTime() - assumedAt.getTime()) / 1000)
            : 0;

          await supabase
            .from('support_attendances')
            .update({
              status: 'closed',
              closed_at: now.toISOString(),
              closed_by: user?.id ?? null,
              closed_reason: 'manual',
              wait_seconds: waitSec,
              handle_seconds: handleSec,
              updated_at: now.toISOString(),
            })
            .eq('id', activeAtt.id);

          // Insert system message + send closure to customer via WhatsApp
          if (activeAtt.attendance_code) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('tenant_id')
              .eq('user_id', user?.id)
              .single();

            if (profile?.tenant_id) {
              const msgId = `system_att_closed_${activeAtt.id}`;
              await supabase.from('whatsapp_messages' as any).upsert({
                conversation_id: conversationId,
                remote_jid: '',
                message_id: msgId,
                content: `🔒 Atendimento ${activeAtt.attendance_code} encerrado com sucesso.`,
                message_type: 'system',
                is_from_me: false,
                status: 'sent',
                timestamp: now.toISOString(),
                tenant_id: profile.tenant_id,
                metadata: { system: true, attendance_event: 'closed', attendance_id: activeAtt.id },
              }, {
                onConflict: 'tenant_id,message_id',
                ignoreDuplicates: true,
              });

              // Send closure message to customer via WhatsApp using send-whatsapp-message with correct params
              try {
                const closureText = `✅ Atendimento *${activeAtt.attendance_code}* encerrado com sucesso.\n\nObrigado pelo contato! Caso precise de algo mais, é só nos enviar uma nova mensagem. 😊`;

                await supabase.functions.invoke('send-whatsapp-message', {
                  body: {
                    conversationId,
                    content: closureText,
                    messageType: 'text',
                    systemMessage: true, // Skip attendance creation logic
                  },
                });
                console.log('[closeConversation] Closure message sent to customer');
              } catch (sendErr) {
                console.error('[closeConversation] Error sending closure message to customer:', sendErr);
              }
            }
          }
        }
      } catch (e) {
        console.error('[closeConversation] Error closing attendance:', e);
      }

      return conversationId;
    },
    onMutate: async ({ conversationId }) => {
      // Optimistic: mark closed immediately in sidebar + attendance cache
      patchConversation(queryClient, conversationId, { status: 'closed' });
      queryClient.setQueriesData<Map<string, any>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;
          const entry = oldMap.get(conversationId);
          if (!entry) return oldMap;
          const newMap = new Map(oldMap);
          newMap.set(conversationId, { ...entry, status: "closed", closed_at: new Date().toISOString() });
          return newMap;
        }
      );
    },
    onSuccess: (conversationId) => {
      toast.success('Conversa encerrada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', conversationId] });
    },
    onError: () => {
      toast.error('Erro ao encerrar conversa');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'active' })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onMutate: async (conversationId) => {
      patchConversation(queryClient, conversationId, { status: 'active' });
    },
    onSuccess: () => {
      toast.success('Conversa reaberta com sucesso');
    },
    onError: () => {
      toast.error('Erro ao reabrir conversa');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  const markAsUnreadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ unread_count: 1 })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onMutate: async (conversationId) => {
      patchConversation(queryClient, conversationId, { unread_count: 1 });
    },
    onSuccess: () => {
      toast.success('Conversa marcada como não lida');
    },
    onError: () => {
      toast.error('Erro ao marcar conversa como não lida');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ contactId, data }: { contactId: string; data: { name: string; notes: string | null } }) => {
      const { error } = await supabase
        .from('whatsapp_contacts')
        .update({ name: data.name, notes: data.notes, updated_at: new Date().toISOString() })
        .eq('id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Contato atualizado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: () => { toast.error('Erro ao atualizar contato'); },
  });

  return {
    archiveConversation: archiveMutation.mutate,
    isArchiving: archiveMutation.isPending,
    closeConversation: closeMutation.mutate,
    isClosing: closeMutation.isPending,
    reopenConversation: reopenMutation.mutate,
    isReopening: reopenMutation.isPending,
    markAsUnread: markAsUnreadMutation.mutate,
    isMarkingUnread: markAsUnreadMutation.isPending,
    updateContact: updateContactMutation.mutate,
    isUpdatingContact: updateContactMutation.isPending,
  };
};
