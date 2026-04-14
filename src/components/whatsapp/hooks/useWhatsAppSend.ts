import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeMessage, mergeMessage, type Message } from './useWhatsAppMessages';

interface SendMessageParams {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
  instanceId?: string;
}

let tempCounter = 0;

export const useWhatsAppSend = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      console.log(`[useWhatsAppSend] Sending via send-whatsapp-message for conversation ${params.conversationId}`);
      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: params,
      });
      if (error) throw new Error(error.message || 'Erro ao enviar mensagem');
      if (data?.success === false) throw new Error(data.error || 'Erro ao enviar mensagem');
      return data;
    },
    onMutate: async (newMessage) => {
      const tempId = `temp-${Date.now()}-${++tempCounter}`;

      const previousMessages = queryClient.getQueryData<Message[]>(['whatsapp', 'messages', newMessage.conversationId]);

      let optimisticMediaUrl = newMessage.mediaUrl ?? null;
      if (!optimisticMediaUrl && newMessage.mediaBase64) {
        const base64Data = newMessage.mediaBase64.startsWith('data:')
          ? newMessage.mediaBase64
          : `data:${newMessage.mediaMimetype || 'application/octet-stream'};base64,${newMessage.mediaBase64}`;
        optimisticMediaUrl = base64Data;
      }

      const optimisticType = newMessage.messageType === 'video' ? 'media' : newMessage.messageType;

      const optimisticMessage = normalizeMessage({
        id: tempId,
        conversation_id: newMessage.conversationId,
        content: newMessage.content || '',
        message_type: newMessage.messageType,
        media_url: optimisticMediaUrl,
        media_mimetype: newMessage.mediaMimetype ?? null,
        status: 'sending',
        is_from_me: true,
        isFromMe: true,
        isSystem: false,
        type: optimisticType,
        timestamp: new Date().toISOString(),
        message_id: '',
        remote_jid: '',
        quoted_message_id: newMessage.quotedMessageId || null,
        metadata: {},
      });

      queryClient.setQueryData(
        ['whatsapp', 'messages', newMessage.conversationId],
        (old: Message[] = []) => [...old, optimisticMessage]
      );

      queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
        if (!old?.conversations) return old;
        const patched = old.conversations.map((c: any) =>
          c.id === newMessage.conversationId
            ? {
                ...c,
                last_message_at: new Date().toISOString(),
                last_message_preview: newMessage.content?.substring(0, 100) || `Sent ${newMessage.messageType}`,
                is_last_message_from_me: true,
                isLastMessageFromMe: true,
              }
            : c
        );
        patched.sort((a: any, b: any) => {
          const tA = a.last_message_at || a.created_at || '';
          const tB = b.last_message_at || b.created_at || '';
          return tB.localeCompare(tA);
        });
        return { ...old, conversations: patched };
      });

      return { previousMessages, tempId };
    },
    onError: (_err, newMessage, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['whatsapp', 'messages', newMessage.conversationId], context.previousMessages);
      }
    },
    onSettled: (data, _error, variables) => {
      if (data?.message) {
        const realMessage = normalizeMessage(data.message);
        queryClient.setQueryData(
          ['whatsapp', 'messages', variables.conversationId],
          (old: Message[] | undefined) => mergeMessage(old ?? [], realMessage)
        );
        return;
      }
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.conversationId] });
      }, 3000);
    },
  });

  return mutation;
};
