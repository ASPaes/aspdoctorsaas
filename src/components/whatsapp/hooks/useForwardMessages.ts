import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useForwardMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageIds, targetConversationId }: { messageIds: string[]; targetConversationId: string }) => {
      const { data, error } = await supabase.functions.invoke('forward-whatsapp-message', {
        body: { messageIds, targetConversationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.detail || 'Falha ao encaminhar mensagens');
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.targetConversationId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      const count = data.forwarded?.length || 0;
      const skipped: { id: string; reason: string }[] = data.skipped ?? [];

      // Mídia sem arquivo guardado não é encaminhada: antes virava um texto
      // "🎥 Vídeo" e o operador achava que tinha mandado o arquivo.
      const semArquivo = skipped.filter((s) => s.reason === 'media_purged' || s.reason === 'media_unavailable').length;
      const falhou = skipped.length - semArquivo;

      const plural = (n: number) => `${n} mensagem${n !== 1 ? 'ns' : ''}`;
      const motivos = [
        semArquivo > 0 ? `${plural(semArquivo)} sem o arquivo guardado — abra a original e encaminhe pelo WhatsApp` : null,
        falhou > 0 ? `${plural(falhou)} não pôde ser enviada` : null,
      ].filter(Boolean).join('. ');

      if (count === 0) {
        toast.error('Nada foi encaminhado', { description: motivos || undefined, duration: 8000 });
        return;
      }

      if (skipped.length > 0) {
        toast.warning(`${plural(count)} encaminhada${count !== 1 ? 's' : ''}`, { description: motivos, duration: 8000 });
        return;
      }

      toast.success(`${plural(count)} encaminhada${count !== 1 ? 's' : ''}`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Erro ao encaminhar mensagens');
    },
  });
}
