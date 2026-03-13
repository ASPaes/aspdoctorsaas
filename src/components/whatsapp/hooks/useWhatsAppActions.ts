import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

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
    },
    onSuccess: () => {
      toast.success('Conversa arquivada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: () => { toast.error('Erro ao arquivar conversa'); },
  });

  const closeMutation = useMutation({
    mutationFn: async ({ conversationId, generateSummary }: { conversationId: string; generateSummary: boolean }) => {
      if (generateSummary) {
        try {
          await supabase.functions.invoke('generate-conversation-summary', { body: { conversationId } });
        } catch (e) { console.error('Erro ao gerar resumo:', e); }
      }

      // 1) Close the whatsapp_conversation (visual)
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'closed' })
        .eq('id', conversationId);
      if (error) throw error;

      // 2) Close the active support_attendance (real attendance closure)
      try {
        const { data: activeAtt } = await supabase
          .from('support_attendances')
          .select('id, opened_at, assumed_at')
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

          const { error: closeErr } = await supabase
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

          if (closeErr) {
            console.error('[closeConversation] Error closing attendance:', closeErr);
          } else {
            console.log(`[closeConversation] ✅ Attendance ${activeAtt.id} closed`);
          }
        }
      } catch (e) {
        console.error('[closeConversation] Error closing attendance:', e);
      }
    },
    onSuccess: (_, { conversationId }) => {
      toast.success('Conversa encerrada com sucesso');
      // Optimistic: patch attendance caches immediately
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
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
    },
    onError: () => { toast.error('Erro ao encerrar conversa'); },
  });

  const reopenMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'active' })
        .eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Conversa reaberta com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: () => { toast.error('Erro ao reabrir conversa'); },
  });

  const markAsUnreadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ unread_count: 1 })
        .eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Conversa marcada como não lida');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: () => { toast.error('Erro ao marcar conversa como não lida'); },
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
