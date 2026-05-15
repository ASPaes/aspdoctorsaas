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

  const pauseAutoReplyMutation = useMutation({
    mutationFn: async ({ conversationId, reason }: { conversationId: string; reason?: string }) => {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({
          auto_reply_disabled: true,
          auto_reply_disabled_at: nowIso,
          auto_reply_disabled_by: user?.id ?? null,
          auto_reply_disabled_reason: reason ?? null,
          updated_at: nowIso,
        })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onMutate: async ({ conversationId }) => {
      patchConversation(queryClient, conversationId, {
        auto_reply_disabled: true,
        auto_reply_disabled_at: new Date().toISOString(),
        auto_reply_disabled_by: user?.id ?? null,
      });
    },
    onSuccess: () => {
      toast.success('Auto-respostas interrompidas para esta conversa');
    },
    onError: () => {
      toast.error('Erro ao interromper auto-respostas');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  const resumeAutoReplyMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({
          auto_reply_disabled: false,
          auto_reply_disabled_at: null,
          auto_reply_disabled_by: null,
          auto_reply_disabled_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onMutate: async (conversationId) => {
      patchConversation(queryClient, conversationId, {
        auto_reply_disabled: false,
        auto_reply_disabled_at: null,
        auto_reply_disabled_by: null,
        auto_reply_disabled_reason: null,
      });
    },
    onSuccess: () => {
      toast.success('Auto-respostas reativadas para esta conversa');
    },
    onError: () => {
      toast.error('Erro ao reativar auto-respostas');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  const deleteMessagesByIdsMutation = useMutation({
    mutationFn: async ({ conversationId, messageIds }: { conversationId: string; messageIds: string[] }) => {
      const { data, error } = await supabase.rpc('delete_messages_by_ids' as any, {
        p_message_ids: messageIds,
      });
      if (error) throw error;
      return { ...(data as { success: boolean; messages_deleted: number; requested: number }), conversationId };
    },
    onSuccess: (data) => {
      toast.success(`${data.messages_deleted} mensagem(ns) excluída(s) permanentemente`);
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', data.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: (err: any) => {
      const msg = err?.message || 'Erro ao excluir mensagens';
      if (msg.includes('forbidden')) {
        toast.error('Você não tem permissão para excluir mensagens');
      } else if (msg.includes('too_many')) {
        toast.error('Muitas mensagens selecionadas (máx 5000)');
      } else if (msg.includes('no_ids')) {
        toast.error('Nenhuma mensagem selecionada');
      } else {
        toast.error(msg);
      }
    },
  });

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
        .select(`
          id, opened_at, assumed_at, attendance_code,
          tenant_id, cliente_id, contact_id,
          contact:whatsapp_contacts(phone_number)
        `)
        .eq('conversation_id', conversationId)
        .neq('status', 'closed')
        .limit(1)
        .maybeSingle();

      // Validação rigorosa: bloquear encerramento se há candidatos e cliente_id NULL
      if (activeAtt && !activeAtt.cliente_id) {
        const phoneNumber = (activeAtt.contact as any)?.phone_number as string | undefined;
        if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 10) {
          const { data: candidatos, error: candErr } = await supabase.rpc(
            'get_clientes_candidatos_by_phone',
            { p_tenant_id: activeAtt.tenant_id, p_phone: phoneNumber }
          );
          if (candErr) {
            console.error('[closeConversation] Erro ao buscar candidatos:', candErr);
          } else {
            const count = candidatos?.length ?? 0;
            if (count >= 1) {
              throw new Error(
                count === 1
                  ? 'Vincule o cliente antes de encerrar este atendimento. Encontramos 1 cliente compatível com o telefone do contato.'
                  : `Vincule o cliente antes de encerrar este atendimento. Encontramos ${count} clientes compatíveis com o telefone do contato.`
              );
            }
          }
        }
      }

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

          const closureType = skipClosureMessage
            ? 'silent'
            : skipCsat
            ? 'closure_message_only'
            : 'csat_sent';

          await supabase
            .from('support_attendances')
            .update({
              status: 'closed',
              closed_at: now.toISOString(),
              closed_by: user?.id ?? null,
              closed_reason: 'manual',
              closure_type: closureType,
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
              if (!csatEnabled && !skipClosureMessage) {
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

              // Registrar mensagem interna no chat indicando como foi encerrado
              try {
                const { data: attData } = await supabase
                  .from('support_attendances')
                  .select('tenant_id')
                  .eq('id', activeAtt.id)
                  .single();

                const internalText = skipClosureMessage
                  ? `🔇 Atendimento encerrado sem envio de mensagem ao cliente.`
                  : skipCsat
                  ? `💬 Atendimento encerrado com mensagem de encerramento (sem CSAT).`
                  : `✅ Atendimento encerrado com pesquisa CSAT enviada ao cliente.`;

                await supabase.from('whatsapp_messages').insert({
                  conversation_id: conversationId,
                  tenant_id: attData?.tenant_id,
                  content: internalText,
                  message_type: 'system',
                  is_from_me: true,
                  status: 'sent',
                  timestamp: new Date().toISOString(),
                  message_id: `internal_close_${Date.now()}`,
                  remote_jid: 'internal',
                  metadata: { system: true, attendance_event: 'closed_internal_note' },
                });
              } catch (internalErr) {
                console.error('[closeConversation] Error inserting internal note:', internalErr);
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
    onError: (err: any) => {
      const msg = err?.message || 'Erro ao encerrar conversa';
      toast.error(msg);
      // Rollback otimista: invalidar para refazer fetch do estado real
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
    mutationFn: async ({ contactId, data }: { contactId: string; data: { name: string; notes: string | null; phone_number?: string } }) => {
      const patch: Record<string, any> = {
        name: data.name,
        notes: data.notes,
        updated_at: new Date().toISOString(),
      };
      if (data.phone_number) patch.phone_number = data.phone_number;
      const { error } = await supabase
        .from('whatsapp_contacts')
        .update(patch)
        .eq('id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Contato atualizado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] });
    },
    onError: (err: any) => {
      const msg = err?.message || '';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        toast.error('Já existe um contato com este número');
      } else {
        toast.error('Erro ao atualizar contato');
      }
    },
  });

  const toggleRulesDisabledMutation = useMutation({
    mutationFn: async ({ contactId, rulesDisabled, reason }: { contactId: string; rulesDisabled: boolean; reason?: string }) => {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('whatsapp_contacts')
        .update({
          rules_disabled: rulesDisabled,
          rules_disabled_at: rulesDisabled ? nowIso : null,
          rules_disabled_by: rulesDisabled ? (user?.id ?? null) : null,
          rules_disabled_reason: rulesDisabled ? (reason ?? null) : null,
          updated_at: nowIso,
        } as any)
        .eq('id', contactId);
      if (error) throw error;
      return { contactId, rulesDisabled };
    },
    onMutate: async ({ contactId, rulesDisabled }) => {
      const nowIso = new Date().toISOString();
      // Snapshot para rollback
      const prevConversations = queryClient.getQueriesData({ queryKey: ['whatsapp', 'conversations'] });

      // Patch otimista: atualiza o contato em todas as conversas em cache
      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        return {
          ...old,
          conversations: old.conversations.map((c: any) =>
            c?.contact?.id === contactId
              ? {
                  ...c,
                  contact: {
                    ...c.contact,
                    rules_disabled: rulesDisabled,
                    rules_disabled_at: rulesDisabled ? nowIso : null,
                    rules_disabled_by: rulesDisabled ? (user?.id ?? null) : null,
                  },
                }
              : c
          ),
        };
      });

      return { prevConversations };
    },
    onSuccess: ({ rulesDisabled }) => {
      toast.success(
        rulesDisabled
          ? 'Regras do sistema desativadas para este contato'
          : 'Regras do sistema reativadas para este contato'
      );
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] });
    },
    onError: (_err, _vars, ctx) => {
      // Rollback
      if (ctx?.prevConversations) {
        for (const [key, data] of ctx.prevConversations as any) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error('Erro ao atualizar regras do contato');
    },
  });

  const scheduleAttendanceMutation = useMutation({
    mutationFn: async ({ attendanceId, scheduledUntilIso }: { attendanceId: string; scheduledUntilIso: string }) => {
      const { data, error } = await supabase.rpc('schedule_attendance' as any, {
        p_attendance_id: attendanceId,
        p_scheduled_until: scheduledUntilIso,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Atendimento agendado');
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: (err: any) => {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) {
        toast.error('Apenas Admin/Head ou o atendente atribuído podem agendar.');
      } else if (msg.includes('must_be_in_progress')) {
        toast.error('Apenas atendimentos em andamento podem ser agendados.');
      } else if (msg.includes('exceeds_max_60_days')) {
        toast.error('A data máxima é 60 dias a partir de hoje.');
      } else if (msg.includes('must_be_future')) {
        toast.error('A data precisa ser futura.');
      } else {
        toast.error('Erro ao agendar atendimento.');
      }
    },
  });

  const unscheduleAttendanceMutation = useMutation({
    mutationFn: async (attendanceId: string) => {
      const { data, error } = await supabase.rpc('unschedule_attendance' as any, {
        p_attendance_id: attendanceId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Agendamento removido');
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
    onError: (err: any) => {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) {
        toast.error('Sem permissão para remover este agendamento.');
      } else {
        toast.error('Erro ao remover agendamento.');
      }
    },
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
    pauseAutoReply: pauseAutoReplyMutation.mutate,
    isPausingAutoReply: pauseAutoReplyMutation.isPending,
    resumeAutoReply: resumeAutoReplyMutation.mutate,
    isResumingAutoReply: resumeAutoReplyMutation.isPending,
    deleteMessagesByIds: deleteMessagesByIdsMutation.mutate,
    isDeletingMessages: deleteMessagesByIdsMutation.isPending,
    updateContact: updateContactMutation.mutate,
    isUpdatingContact: updateContactMutation.isPending,
    scheduleAttendance: scheduleAttendanceMutation.mutate,
    isSchedulingAttendance: scheduleAttendanceMutation.isPending,
    unscheduleAttendance: unscheduleAttendanceMutation.mutate,
    isUnschedulingAttendance: unscheduleAttendanceMutation.isPending,
    toggleRulesDisabled: toggleRulesDisabledMutation.mutate,
    isTogglingRulesDisabled: toggleRulesDisabledMutation.isPending,
  };
};
