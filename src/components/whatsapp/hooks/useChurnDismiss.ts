import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Liga/desliga o descarte manual do risco de churn de uma conversa.
 *
 * Só a mutation de propósito: quem precisa do estado já recebe o `sentiment`
 * de fora (ChatHeader, DetailsSidebar, ConversationItem). Chamar o
 * `useWhatsAppSentiment` inteiro aqui abriria query e canal Realtime a mais
 * em cada banner montado.
 *
 * A permissão de verdade está na RPC (`admin`/`head`/super admin); o botão só
 * evita mostrar ao operador uma ação que o banco vai recusar.
 */
export const useChurnDismiss = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (dismiss: boolean) => {
      if (!conversationId) throw new Error('Conversa não identificada.');
      const { data, error } = await (supabase.rpc as any)('toggle_churn_dismiss', {
        p_conversation_id: conversationId,
        p_dismiss: dismiss,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.erro || 'Não foi possível alterar o risco de churn.');
      return data as { ok: boolean; dismissed: boolean };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'sentiment', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      toast({
        title: data?.dismissed ? 'Risco de churn descartado' : 'Risco de churn reativado',
        description: data?.dismissed
          ? 'O aviso e a sugestão de ticket CS somem até este atendimento ser encerrado.'
          : 'A IA volta a sinalizar risco nesta conversa.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Não foi possível alterar o risco de churn',
        description: err?.message || 'Erro desconhecido.',
        variant: 'destructive',
      });
    },
  });

  return {
    setDismissed: (dismiss: boolean) => mutation.mutate(dismiss),
    isSaving: mutation.isPending,
  };
};
