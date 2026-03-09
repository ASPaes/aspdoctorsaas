import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SmartReplySuggestion {
  text: string;
  tone: 'formal' | 'friendly' | 'direct';
}

export interface SmartReplyResponse {
  suggestions: SmartReplySuggestion[];
  context?: { contactName: string; lastMessage: string } | null;
  error?: string;
}

export const useSmartReply = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-replies', conversationId],
    queryFn: async (): Promise<SmartReplyResponse> => {
      if (!conversationId) throw new Error('No conversation selected');
      const { data, error } = await supabase.functions.invoke('suggest-smart-replies', { body: { conversationId } });
      if (error) throw error;
      return data as SmartReplyResponse;
    },
    enabled: !!conversationId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error('No conversation selected');
      const { data, error } = await supabase.functions.invoke('suggest-smart-replies', { body: { conversationId } });
      if (error) throw error;
      return data as SmartReplyResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['smart-replies', conversationId], data);
      toast.success('Novas sugestões geradas!');
    },
    onError: (error: any) => {
      if (error.message?.includes('Rate limit')) toast.error('Muitas requisições. Aguarde um momento.');
      else toast.error('Erro ao gerar novas sugestões.');
    },
  });

  return {
    suggestions: data?.suggestions || [],
    context: data?.context || null,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    refresh: () => refreshMutation.mutate(),
    error: error as Error | null,
    refetch,
  };
};
