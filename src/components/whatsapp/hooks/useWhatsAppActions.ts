import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

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
  const { effectiveTenantId } = useTenantFilter();

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
    mutationFn: async ({ conversationId, generateSummary, skipCsat, skipClosureMessage }: { conversationId: string; generateSummary: boolean; skipCsat?: boolean; skipClosureMessage?: boolean }) => {
      // Fetch active attendance early so we can scope the summary
      const { data: activeAtt } = await supabase
        .from('support_attendances')
        .select('id, opened_at, assumed_at, attendance_code')
        .eq('conversation_id', conversationId)
        .neq('status', 'closed')
        .limit(1)
        .maybeSingle();

      // Summary generation removed — finalize-attendance handles it

      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ status: 'closed' })
        .eq('id', conversationId);
      if (error) throw error;

      // Close the active support_attendance (already fetched above)
      try {

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

          // Check CSAT config and decide flow
          if (activeAtt.attendance_code) {
              const resolvedTenantId = effectiveTenantId;

              if (resolvedTenantId) {
              // Check if CSAT is enabled
              let csatEnabled = false;
              try {
                const { data: config } = await supabase
                  .from('configuracoes')
                  .select('support_csat_enabled, support_csat_prompt_template, support_csat_score_min, support_csat_score_max')
                  .eq('tenant_id', resolvedTenantId)
                  .maybeSingle();

                if (config?.support_csat_enabled && !skipCsat) {
                  csatEnabled = true;

                  // Get contact name for template
                  const { data: convData } = await supabase
                    .from('whatsapp_conversations')
                    .select('contact:whatsapp_contacts(name)')
                    .eq('id', conversationId)
                    .single();
                  const contactName = (convData as any)?.contact?.name || '';

                  const promptTemplate = config.support_csat_prompt_template ||
                    'Oi {{customer_name}}, para encerrar este atendimento é muito importante entender como foi sua experiência. De 0 a 5, como você avalia este atendimento? (Responda apenas a nota)';
                  const csatPrompt = promptTemplate
                    .replace(/\{\{customer_name\}\}/g, contactName)
                    .replace(/\{\{score_min\}\}/g, String(config.support_csat_score_min ?? 0))
                    .replace(/\{\{score_max\}\}/g, String(config.support_csat_score_max ?? 5));

                  // Create support_csat record
                  await supabase.from('support_csat').insert({
                    tenant_id: resolvedTenantId,
                    attendance_id: activeAtt.id,
                    status: 'pending',
                    asked_at: now.toISOString(),
                  });

                  // Send CSAT prompt to customer (closure message will be sent after CSAT completes)
                  await supabase.functions.invoke('send-whatsapp-message', {
                    body: {
                      conversationId,
                      content: csatPrompt,
                      messageType: 'text',
                      systemMessage: true,
                    },
                  });
                  console.log('[closeConversation] CSAT survey sent — closure message deferred until CSAT completes');
                }
              } catch (csatErr) {
                console.error('[closeConversation] Error sending CSAT survey:', csatErr);
              }

              // Only send closure message immediately if CSAT is NOT enabled
              if (!csatEnabled) {
                try {
                  const closureText = `✅ Atendimento *${activeAtt.attendance_code}* encerrado com sucesso.\n\nObrigado pelo contato! Caso precise de algo mais, é só nos enviar uma nova mensagem. 😊`;
                  await supabase.functions.invoke('send-whatsapp-message', {
                    body: {
                      conversationId,
                      content: closureText,
                      messageType: 'text',
                      systemMessage: true,
                    },
                  });
                  console.log('[closeConversation] Closure message sent (no CSAT)');
                } catch (sendErr) {
                  console.error('[closeConversation] Error sending closure message:', sendErr);
                }
              }
            }
          }

          // --- Fire-and-forget: finalize-attendance (consolidated AI analysis + KB draft) ---
          try {
            supabase.functions.invoke('finalize-attendance', {
              body: { attendanceId: activeAtt.id },
            }).then((res) => {
              if (res.error) console.error('[closeConversation] finalize-attendance error:', res.error);
              else console.log('[closeConversation] finalize-attendance completed:', res.data);
            }).catch((err) => {
              console.error('[closeConversation] finalize-attendance failed:', err);
            });
          } catch (finalizeErr) {
            console.error('[closeConversation] Error invoking finalize-attendance:', finalizeErr);
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
      queryClient.invalidateQueries({ queryKey: ['latest-closed-attendance', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['kb-draft'] });
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
