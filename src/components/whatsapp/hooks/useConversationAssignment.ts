import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useConversationAssignment = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const assignConversation = useMutation({
    mutationFn: async ({ conversationId, assignedTo, reason }: { conversationId: string; assignedTo: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { data: conversation } = await supabase
        .from('whatsapp_conversations')
        .select('assigned_to')
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

      const { error: updateError } = await supabase
        .from('whatsapp_conversations')
        .update({ assigned_to: newAssignee })
        .eq('id', conversationId);
      if (updateError) throw updateError;

      await supabase.from('conversation_assignments').insert({
        conversation_id: conversationId,
        assigned_to: newAssignee,
        assigned_by: user.id,
        reason: reason || null,
      } as any);

      return { conversationId, newAssignee };
    },
    onMutate: async (vars) => {
      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        return {
          ...old,
          conversations: old.conversations.map((c: any) =>
            c.id === vars.conversationId ? { ...c, assigned_to: vars.newAssignee } : c
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
      const { data: dept } = await supabase
        .from('support_departments')
        .select('id, default_instance_id')
        .eq('id', departmentId)
        .single();

      if (!dept) throw new Error('Setor não encontrado');

      // Update conversation: department + instance + unassign
      const convUpdate: Record<string, any> = {
        department_id: departmentId,
        assigned_to: null,
      };
      if (dept.default_instance_id) {
        convUpdate.current_instance_id = dept.default_instance_id;
      }
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
