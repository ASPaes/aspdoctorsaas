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

      return { conversationId, assignedTo };
    },
    onSuccess: (result) => {
      // Optimistic: patch attendance caches so status updates instantly
      queryClient.setQueriesData<Map<string, any>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;
          const entry = oldMap.get(result.conversationId);
          if (!entry) return oldMap;
          const newMap = new Map(oldMap);
          newMap.set(result.conversationId, { ...entry, status: "in_progress", assigned_to: result.assignedTo });
          return newMap;
        }
      );
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      toast({ title: "Conversa transferida", description: "A conversa foi transferida com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro ao transferir", description: "Não foi possível transferir a conversa.", variant: "destructive" });
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
    unassignConversation: unassignConversation.mutate,
    getAssignmentHistory,
    isAssigning: assignConversation.isPending,
    isTransferring: transferConversation.isPending,
  };
};
