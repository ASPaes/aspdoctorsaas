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
  rateLimited?: boolean;
  error?: string;
}

const LOCAL_FALLBACK: SmartReplySuggestion[] = [
  { text: "Olá! Como posso te ajudar?", tone: "friendly" },
  { text: "Certo — me conta um pouco mais pra eu entender.", tone: "direct" },
  { text: "Perfeito. Qual é a sua dúvida principal?", tone: "formal" },
];

const safeParseSuggestions = (raw: unknown): SmartReplySuggestion[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s: any) => s && typeof s === 'object' && typeof s.text === 'string'
  ) as SmartReplySuggestion[];
};

const safeParseResponse = (data: unknown): SmartReplyResponse => {
  if (!data || typeof data !== 'object') {
    return { suggestions: [], rateLimited: false };
  }
  const d = data as Record<string, unknown>;
  return {
    suggestions: safeParseSuggestions(d.suggestions),
    context: (d.context && typeof d.context === 'object') ? d.context as any : null,
    rateLimited: d.rate_limited === true || d.error === 'rate_limit',
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

const extractFallbackFromError = (error: unknown): SmartReplyResponse | null => {
  if (!error || typeof error !== 'object') return null;
  try {
    const errBody = (error as any)?.context?.body ?? (error as any)?.body;
    if (errBody) {
      const parsed = safeParseResponse(errBody);
      if (parsed.suggestions.length > 0) return parsed;
    }
    const msg = typeof (error as any)?.message === 'string' ? (error as any).message : '';
    const jsonStart = msg.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = safeParseResponse(JSON.parse(msg.slice(jsonStart)));
      if (parsed.suggestions.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
};

async function fetchSmartReplies(conversationId: string): Promise<SmartReplyResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('suggest-smart-replies', {
      body: { conversationId },
    });

    if (error) {
      console.warn('[useSmartReply] invoke error:', error);
      if (data) {
        const parsed = safeParseResponse(data);
        if (parsed.suggestions.length > 0) return parsed;
      }
      const fallback = extractFallbackFromError(error);
      if (fallback) return fallback;
      return { suggestions: [], rateLimited: false };
    }

    return safeParseResponse(data);
  } catch (err) {
    console.warn('[useSmartReply] unexpected error:', err);
    return { suggestions: [], rateLimited: false };
  }
}

export const useSmartReply = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const canRun = !!conversationId;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['smart-replies', conversationId ?? '__none__'],
    queryFn: () => {
      if (!conversationId) return Promise.resolve({ suggestions: [], rateLimited: false } as SmartReplyResponse);
      return fetchSmartReplies(conversationId);
    },
    enabled: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => {
      if (!conversationId) return Promise.resolve({ suggestions: [], rateLimited: false } as SmartReplyResponse);
      return fetchSmartReplies(conversationId);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['smart-replies', conversationId], result);
      if (result.suggestions.length > 0 && !result.rateLimited) {
        toast.success('Novas sugestões geradas!');
      }
    },
    onError: () => {
      console.warn('[useSmartReply] refresh failed');
    },
  });

  return {
    suggestions: data?.suggestions ?? [],
    context: data?.context ?? null,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    refresh: () => refreshMutation.mutate(),
    rateLimited: data?.rateLimited ?? false,
    error: null as Error | null,
    refetch,
  };
};
