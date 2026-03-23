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

/**
 * Resolve which Edge Function to call based on the conversation's instance provider_type.
 * Looks up the instance from the query cache first, then falls back to a DB query.
 */
async function resolveEdgeFunction(
  conversationId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<string> {
  // Try to find instance_id from conversations cache
  const convCaches = queryClient.getQueriesData<any>({ queryKey: ['whatsapp', 'conversations'] });
  let instanceId: string | null = null;

  for (const [, cacheData] of convCaches) {
    if (!cacheData?.conversations) continue;
    const conv = cacheData.conversations.find((c: any) => c.id === conversationId);
    if (conv?.instance_id) {
      instanceId = conv.instance_id;
      break;
    }
  }

  if (!instanceId) {
    // Fallback: fetch from DB
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('instance_id')
      .eq('id', conversationId)
      .single();
    instanceId = data?.instance_id || null;
  }

  if (!instanceId) return 'send-whatsapp-message';

  // Check instance cache
  const instanceCaches = queryClient.getQueriesData<any[]>({ queryKey: ['whatsapp', 'instances'] });
  for (const [, instances] of instanceCaches) {
    if (!Array.isArray(instances)) continue;
    const inst = instances.find((i: any) => i.id === instanceId);
    if (inst) {
      return inst.provider_type === 'meta_cloud' ? 'send-meta-message' : 'send-whatsapp-message';
    }
  }

  // Fallback: fetch instance from DB
  const { data: inst } = await supabase
    .from('whatsapp_instances')
    .select('provider_type')
    .eq('id', instanceId)
    .single();

  return inst?.provider_type === 'meta_cloud' ? 'send-meta-message' : 'send-whatsapp-message';
}

export const useWhatsAppSend = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const fnName = await resolveEdgeFunction(params.conversationId, queryClient);
      console.log(`[useWhatsAppSend] Routing to ${fnName} for conversation ${params.conversationId}`);
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: params,
      });
      if (error) throw error;
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
