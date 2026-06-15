import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeMessage, upsertInfinite, patchInfinite, type Message, type MsgPages } from './useWhatsAppMessages';

interface SendMessageParams {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  file?: File; // anexo para upload direto ao Storage (evita base64 inline)
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
      let storagePath: string | undefined;
      let mediaSizeBytes: number | undefined;

      // Upload direto ao Storage para anexos (não passa base64 pela Edge Function)
      if (params.file && params.messageType !== 'text') {
        const mime = params.file.type || 'application/octet-stream';
        const { data: urlData, error: urlErr } = await supabase.functions.invoke('get-media-upload-url', {
          body: { conversationId: params.conversationId, mediaMimetype: mime, fileName: params.file.name },
        });
        if (urlErr) throw new Error(urlErr.message || 'Falha ao preparar upload');
        if (!urlData?.path || !urlData?.token) throw new Error(urlData?.error || 'Falha ao preparar upload');

        const { error: upErr } = await supabase.storage
          .from('whatsapp-media')
          .uploadToSignedUrl(urlData.path, urlData.token, params.file, { contentType: mime });
        if (upErr) throw new Error(upErr.message || 'Falha no upload do arquivo');

        storagePath = urlData.path;
        mediaSizeBytes = params.file.size;
      }

      const sendBody = {
        conversationId: params.conversationId,
        content: params.content,
        messageType: params.messageType,
        mediaUrl: params.mediaUrl,
        mediaBase64: params.mediaBase64,
        storagePath,
        mediaMimetype: params.mediaMimetype || params.file?.type,
        fileName: params.fileName || params.file?.name,
        mediaSizeBytes,
        quotedMessageId: params.quotedMessageId,
        instanceId: params.instanceId,
      };

      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: sendBody,
      });
      if (error) throw new Error(error.message || 'Erro ao enviar mensagem');
      if (data?.success === false) throw new Error(data.error || 'Erro ao enviar mensagem');
      return data;
    },
    onMutate: async (newMessage) => {
      const tempId = `temp-${Date.now()}-${++tempCounter}`;

      const previousMessages = queryClient.getQueryData<MsgPages>(['whatsapp', 'messages', newMessage.conversationId]);

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

      queryClient.setQueryData<MsgPages>(
        ['whatsapp', 'messages', newMessage.conversationId],
        (old) => upsertInfinite(old, optimisticMessage)
      );

      // Timeout: se ainda 'sending' após 30s, marcar como falhou automaticamente
      setTimeout(() => {
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', newMessage.conversationId],
          (old) => patchInfinite(old, (m) => m.id === tempId && m.status === 'sending', { status: 'failed' })
        );
      }, 30_000);

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
      // Não apaga a mensagem — marca como falhou para o técnico ver
      if (context?.tempId) {
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', newMessage.conversationId],
          (old) => patchInfinite(old, (m) => m.id === context.tempId, { status: 'failed' })
        );
      }
    },
    onSettled: (data, _error, variables) => {
      if (data?.message) {
        const realMessage = normalizeMessage(data.message);
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', variables.conversationId],
          (old) => upsertInfinite(old, realMessage)
        );
        return;
      }
      // Aguarda 15s para o Realtime entregar o INSERT antes de invalidar
      // Evita apagar a mensagem otimista prematuramente
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.conversationId] });
      }, 15_000);
    },
  });

  return mutation;
};
