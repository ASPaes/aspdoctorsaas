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

      // Generate a local preview URL for base64 media
      let optimisticMediaUrl = newMessage.mediaUrl ?? null;
      if (!optimisticMediaUrl && newMessage.mediaBase64) {
        const base64Data = newMessage.mediaBase64.startsWith('data:')
          ? newMessage.mediaBase64
          : `data:${newMessage.mediaMimetype || 'application/octet-stream'};base64,${newMessage.mediaBase64}`;
        optimisticMediaUrl = base64Data;
      }

      const optimisticMessage: Partial<Message> = {
        id: 'temp-' + Date.now(),
        conversation_id: newMessage.conversationId,
        content: newMessage.content || '',
        message_type: newMessage.messageType,
        media_url: optimisticMediaUrl,
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

      // Optimistically update conversation's last_message_at for instant reorder
      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        return {
          ...old,
          conversations: old.conversations.map((c: any) =>
            c.id === newMessage.conversationId
              ? {
                  ...c,
                  last_message_at: new Date().toISOString(),
                  last_message_preview: newMessage.content?.substring(0, 100) || `Sent ${newMessage.messageType}`,
                }
              : c
          ),
        };
      });

      return { previousMessages };
    },
    onError: (_err, newMessage, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['whatsapp', 'messages', newMessage.conversationId], context.previousMessages);
      }
    },
    onSettled: (_data, _error, variables) => {
      // Only invalidate conversations list (for last_message_* reorder).
      // Messages are updated via realtime subscription — no need to refetch here.
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    },
  });

  return mutation;
};
