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

const isSmartReplyResponse = (value: unknown): value is SmartReplyResponse => {
  if (!value || typeof value !== 'object') return false;

  const maybeResponse = value as { suggestions?: unknown };
  return Array.isArray(maybeResponse.suggestions);
};

const isConversationNotFoundError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { message?: string; context?: { status?: number; statusText?: string } };
  return (
    maybeError.context?.status === 404 ||
    maybeError.message?.includes('Conversation not found') ||
    maybeError.message?.includes('404') ||
    false
  );
};

const getFallbackResponse = (): SmartReplyResponse => ({
  suggestions: [],
  context: null,
  error: 'conversation_not_found',
});

const extractFallbackFromError = (error: unknown): SmartReplyResponse | null => {
  if (!error || typeof error !== 'object') return null;

  const maybeError = error as {
    context?: { body?: unknown };
    body?: unknown;
    message?: string;
  };

  const directBody = maybeError.context?.body ?? maybeError.body;
  if (isSmartReplyResponse(directBody)) return directBody;

  const message = maybeError.message;
  if (!message) return null;

  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return null;

  try {
    const parsed = JSON.parse(message.slice(jsonStart));
    return isSmartReplyResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const useSmartReply = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const lastInvalidatedRef = useRef<number>(0);
  const MIN_INTERVAL_MS = 30_000; // mínimo 30s entre invalidações para economizar tokens

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-replies', conversationId],
    queryFn: async (): Promise<SmartReplyResponse> => {
      if (!conversationId) throw new Error('No conversation selected');
      const { data, error } = await supabase.functions.invoke('suggest-smart-replies', { body: { conversationId } });
      if (error) {
        if (isConversationNotFoundError(error)) return getFallbackResponse();
        if (data?.suggestions) return data as SmartReplyResponse;
        const fallback = extractFallbackFromError(error);
        if (fallback) return fallback;
        throw error;
      }
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
      if (error) {
        if (isConversationNotFoundError(error)) return getFallbackResponse();
        if (data?.suggestions) return data as SmartReplyResponse;
        const fallback = extractFallbackFromError(error);
        if (fallback) return fallback;
        throw error;
      }
      return data as SmartReplyResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['smart-replies', conversationId], data);
      lastInvalidatedRef.current = Date.now();
      if (data.error !== 'conversation_not_found') {
        toast.success('Novas sugestões geradas!');
      }
    },
    onError: (error: any) => {
      if (isConversationNotFoundError(error)) return;
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
