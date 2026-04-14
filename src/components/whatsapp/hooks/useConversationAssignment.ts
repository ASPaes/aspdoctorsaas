import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { createNotificationForUser } from '@/hooks/useNotifications';

export const useConversationAssignment = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const assignConversation = useMutation({
    mutationFn: async ({ conversationId, assignedTo, reason }: { conversationId: string; assignedTo: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { data: conversation } = await supabase
        .from('whatsapp_conversations')
        .select('assigned_to, tenant_id, department_id, whatsapp_contacts(name)')
        .eq('id', conversationId)
        .single();

      const { error: updateError } = await supabase
        .from('whatsapp_conversations')
        .update({ assigned_to: assignedTo })
        .eq('id', conversationId);
      if (updateError) throw updateError;

      await supabase.from('conversation_assignments').insert({
        conversation_id: conversationId,
        assigned_to: assignedTo,
        assigned_by: user.id,
        reason: reason || null,
      } as any);

      // Also update the active attendance: set assigned_to + status=in_progress
      const { data: activeAtt } = await supabase
        .from('support_attendances')
        .select('id, status')
        .eq('conversation_id', conversationId)
        .in('status', ['waiting', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (activeAtt) {
        await supabase
          .from('support_attendances')
          .update({
            assigned_to: assignedTo,
            status: 'in_progress',
            assumed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeAtt.id);
      }

      // Create notification for the assigned user
      if (conversation?.tenant_id && assignedTo !== user.id) {
        const contactName = (conversation as any).whatsapp_contacts?.name || 'Contato';
        let deptName = '';
        if (conversation.department_id) {
          const { data: dept } = await supabase.from('support_departments').select('name').eq('id', conversation.department_id).maybeSingle();
          deptName = dept?.name || '';
        }
        createNotificationForUser({
          tenantId: conversation.tenant_id,
          recipientUserId: assignedTo,
          type: 'chat_assignment',
          severity: 'info',
          title: 'Novo atendimento atribuído',
          body: [contactName, deptName].filter(Boolean).join(' • '),
          actionUrl: `/whatsapp?conversationId=${conversationId}`,
          metadata: { conversation_id: conversationId, department_id: conversation.department_id, assigned_by: user.id, reason },
          createdBy: user.id,
        });
      }

      return { conversationId, assignedTo };
    },
    onMutate: async (vars) => {
      // Optimistic: patch sidebar + attendance immediately
      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        return {
          ...old,
          conversations: old.conversations.map((c: any) =>
            c.id === vars.conversationId ? { ...c, assigned_to: vars.assignedTo } : c
          ),
        };
      });
      queryClient.setQueriesData<Map<string, any>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;
          const entry = oldMap.get(vars.conversationId);
          if (!entry) return oldMap;
          const newMap = new Map(oldMap);
          newMap.set(vars.conversationId, { ...entry, status: "in_progress", assigned_to: vars.assignedTo });
          return newMap;
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      toast({ title: "Conversa atribuída", description: "A conversa foi atribuída com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro ao atribuir", description: "Não foi possível atribuir a conversa.", variant: "destructive" });
    },
  });

  const transferConversation = useMutation({
    mutationFn: async ({ conversationId, newAssignee, reason }: { conversationId: string; newAssignee: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Get conversation data for notification before transfer
      const { data: convData } = await supabase
        .from('whatsapp_conversations')
        .select('tenant_id, department_id, whatsapp_contacts(name)')
        .eq('id', conversationId)
        .single();

      // Execute transfer via server-side RPC (handles RLS, department change, attendance update)
      const { error: rpcError } = await (supabase.rpc as any)('transfer_conversation_to_agent', {
        p_conversation_id: conversationId,
        p_new_assignee: newAssignee,
        p_reason: reason || null,
      });
      if (rpcError) throw rpcError;

      // Create notification for the new assignee
      if (convData?.tenant_id && newAssignee !== user.id) {
        const contactName = (convData as any).whatsapp_contacts?.name || 'Contato';
        let deptName = '';
        if (convData.department_id) {
          const { data: dept } = await supabase.from('support_departments').select('name').eq('id', convData.department_id).maybeSingle();
          deptName = dept?.name || '';
        }
        createNotificationForUser({
          tenantId: convData.tenant_id,
          recipientUserId: newAssignee,
          type: 'chat_assignment',
          severity: 'info',
          title: 'Atendimento transferido para você',
          body: [contactName, deptName].filter(Boolean).join(' • '),
          actionUrl: `/whatsapp?conversationId=${conversationId}`,
          metadata: { conversation_id: conversationId, department_id: convData.department_id, assigned_by: user.id, reason },
          createdBy: user.id,
        });
      }

      return { conversationId, newAssignee };
    },
    onMutate: async (vars) => {
      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        // Remover a conversa da lista do usuário atual (ela foi transferida)
        return {
          ...old,
          conversations: old.conversations.filter(
            (c: any) => c.id !== vars.conversationId
          ),
        };
      });
      queryClient.setQueriesData<Map<string, any>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;
          const entry = oldMap.get(vars.conversationId);
          if (!entry) return oldMap;
          const newMap = new Map(oldMap);
          newMap.set(vars.conversationId, { ...entry, assigned_to: vars.newAssignee });
          return newMap;
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      toast({ title: "Conversa transferida", description: "A conversa foi transferida com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro ao transferir", description: "Não foi possível transferir a conversa.", variant: "destructive" });
    },
  });

  const transferToDepartment = useMutation({
    mutationFn: async ({ conversationId, departmentId, reason }: { conversationId: string; departmentId: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Get the department's default_instance_id
      // Update conversation: department only (NEVER change instance — sticky)
      const convUpdate: Record<string, any> = {
        department_id: departmentId,
        assigned_to: null,
      };
      const { error: convErr } = await supabase
        .from('whatsapp_conversations')
        .update(convUpdate)
        .eq('id', conversationId);
      if (convErr) throw convErr;

      // Update active attendance
      const { data: activeAtt } = await supabase
        .from('support_attendances')
        .select('id')
        .eq('conversation_id', conversationId)
        .in('status', ['waiting', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (activeAtt) {
        await supabase
          .from('support_attendances')
          .update({
            department_id: departmentId,
            assigned_to: null,
            status: 'waiting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeAtt.id);
      }

      // Log assignment
      await supabase.from('conversation_assignments').insert({
        conversation_id: conversationId,
        assigned_to: null,
        assigned_by: user.id,
        reason: reason ? `[Setor] ${reason}` : '[Transferência de setor]',
      } as any);

      return { conversationId, departmentId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
      toast({ title: "Setor alterado", description: "A conversa foi transferida para o novo setor." });
    },
    onError: () => {
      toast({ title: "Erro ao transferir setor", description: "Não foi possível transferir a conversa.", variant: "destructive" });
    },
  });

  const unassignConversation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ assigned_to: null })
        .eq('id', conversationId);
      if (error) throw error;
      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      toast({ title: "Conversa devolvida", description: "A conversa foi devolvida para a fila." });
    },
    onError: () => {
      toast({ title: "Erro ao devolver", description: "Não foi possível devolver a conversa.", variant: "destructive" });
    },
  });

  const getAssignmentHistory = (conversationId: string) => {
    return useQuery({
      queryKey: ['conversation-assignments', conversationId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('conversation_assignments')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      },
      enabled: !!conversationId,
    });
  };

  return {
    assignConversation: assignConversation.mutate,
    transferConversation: transferConversation.mutate,
    transferToDepartment: transferToDepartment.mutate,
    unassignConversation: unassignConversation.mutate,
    getAssignmentHistory,
    isAssigning: assignConversation.isPending,
    isTransferring: transferConversation.isPending,
    isTransferringDepartment: transferToDepartment.isPending,
  };
};
