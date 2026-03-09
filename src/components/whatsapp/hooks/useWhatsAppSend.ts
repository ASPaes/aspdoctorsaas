import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Message } from './useWhatsAppMessages';

interface SendMessageParams {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
}

export const useWhatsAppSend = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: params,
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (newMessage) => {
      await queryClient.cancelQueries({ queryKey: ['whatsapp', 'messages', newMessage.conversationId] });
      const previousMessages = queryClient.getQueryData(['whatsapp', 'messages', newMessage.conversationId]);

      const optimisticMessage: Partial<Message> = {
        id: 'temp-' + Date.now(),
        conversation_id: newMessage.conversationId,
        content: newMessage.content || '',
        message_type: newMessage.messageType,
        media_url: newMessage.mediaUrl ?? null,
        media_mimetype: newMessage.mediaMimetype ?? null,
        status: 'sending',
        is_from_me: true,
        timestamp: new Date().toISOString(),
        message_id: '',
        remote_jid: '',
        quoted_message_id: newMessage.quotedMessageId || null,
        metadata: {},
      };

      queryClient.setQueryData(['whatsapp', 'messages', newMessage.conversationId], (old: Message[] = []) => [
        ...old,
        optimisticMessage as Message,
      ]);

      return { previousMessages };
    },
    onError: (_err, newMessage, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['whatsapp', 'messages', newMessage.conversationId], context.previousMessages);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  return mutation;
};
