import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useWhatsAppSentiment = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sentiment, isLoading, error, refetch } = useQuery({
    queryKey: ['whatsapp', 'sentiment', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await supabase
        .from('whatsapp_sentiment_analysis' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!conversationId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async (params: { conversationId: string }) => {
      const { data, error } = await supabase.functions.invoke('analyze-whatsapp-sentiment', { body: params });
      if (error) throw error;
      // Handle non-success responses from the function
      if (data && !data.success) {
        if (data.error === 'ai_not_configured') {
          throw new Error('IA não configurada. Acesse Configurações > Inteligência Artificial.');
        }
        if (data.error === 'ai_key_invalid') {
          throw new Error('Chave de API inválida. Verifique em Configurações > IA.');
        }
        if (data.error === 'rate_limit') {
          throw new Error('Limite da API atingido. Tente novamente em instantes.');
        }
        if (data.message) {
          throw new Error(data.message);
        }
      }
      return data;
    },
    onSuccess: (data) => {
      if (conversationId) queryClient.invalidateQueries({ queryKey: ['whatsapp', 'sentiment', conversationId] });
      if (data?.success) {
        toast({ title: 'Análise concluída', description: 'Sentimento atualizado com sucesso.' });
      }
    },
    onError: (err: any) => {
      const msg = err?.message || 'Erro desconhecido ao analisar sentimento.';
      toast({
        title: 'Erro na análise de sentimento',
        description: msg,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`sentiment-updates-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_sentiment_analysis' }, (payload) => {
        const newRecord = payload.new as any;
        const oldRecord = payload.old as any;
        if (newRecord?.conversation_id === conversationId || oldRecord?.conversation_id === conversationId) {
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'sentiment', conversationId] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return {
    sentiment,
    isLoading,
    error,
    isAnalyzing: analyzeMutation.isPending,
    analyze: () => analyzeMutation.mutate({ conversationId: conversationId! }),
    refetch,
  };
};
