import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
  const lastInvalidatedRef = useRef<number>(0);
  const MIN_INTERVAL_MS = 30_000; // mínimo 30s entre invalidações para economizar tokens

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-replies', conversationId],
    queryFn: async (): Promise<SmartReplyResponse> => {
      if (!conversationId) throw new Error('No conversation selected');
      const { data, error } = await supabase.functions.invoke('suggest-smart-replies', { body: { conversationId } });
      if (error) throw error;
      return data as SmartReplyResponse;
    },
    enabled: !!conversationId,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Escuta mensagens novas do cliente para invalidar sugestões
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`smart-reply-trigger-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const msg = payload.new as any;
        // Só invalida quando chega mensagem do cliente (não do agente)
        if (msg.is_from_me) return;
        const now = Date.now();
        if (now - lastInvalidatedRef.current < MIN_INTERVAL_MS) return;
        lastInvalidatedRef.current = now;
        queryClient.invalidateQueries({ queryKey: ['smart-replies', conversationId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error('No conversation selected');
      const { data, error } = await supabase.functions.invoke('suggest-smart-replies', { body: { conversationId } });
      if (error) throw error;
      return data as SmartReplyResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['smart-replies', conversationId], data);
      lastInvalidatedRef.current = Date.now();
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
