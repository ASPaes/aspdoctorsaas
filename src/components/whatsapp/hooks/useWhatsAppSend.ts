import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeMessage, upsertInfinite, patchInfinite, type Message, type MsgPages } from './useWhatsAppMessages';
import { patchConversationInCache, isConversationInCache, outgoingMediaPreview } from './conversationsCache';

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
  mentioned?: string[];
  mentionEveryone?: boolean;
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
        mentioned: params.mentioned && params.mentioned.length > 0 ? params.mentioned : undefined,
        mentionEveryone: params.mentionEveryone === true ? true : undefined,
      };

      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: sendBody,
      });
      if (error) throw new Error(error.message || 'Erro ao enviar mensagem');
      if (data?.success === false) {
        // Preserva os campos estruturados que a edge function devolve (ex.: rateLimited,
        // retryAfterMinutes do @todos). new Error(string) descartava tudo isso e obrigava
        // o ChatInput a detectar rate limit por regex na mensagem — frágil.
        const sendError = new Error(data.error || 'Erro ao enviar mensagem');
        Object.assign(sendError, {
          rateLimited: data.rateLimited === true,
          retryAfterMinutes: typeof data.retryAfterMinutes === 'number' ? data.retryAfterMinutes : undefined,
        });
        throw sendError;
      }
      return data;
    },
    onMutate: async (newMessage) => {
      const tempId = `temp-${Date.now()}-${++tempCounter}`;

      const previousMessages = queryClient.getQueryData<MsgPages>(['whatsapp', 'messages', newMessage.conversationId]);

      let optimisticMediaUrl = newMessage.mediaUrl ?? null;
      if (!optimisticMediaUrl && newMessage.file) {
        optimisticMediaUrl = URL.createObjectURL(newMessage.file);
      } else if (!optimisticMediaUrl && newMessage.mediaBase64) {
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

      // Timeout: se ainda 'sending' após X, marca como falhou. Anexos (upload direto) levam mais tempo.
      const failTimeoutMs = newMessage.file ? 180_000 : 30_000;
      setTimeout(() => {
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', newMessage.conversationId],
          (old) => patchInfinite(old, (m) => m.id === tempId && m.status === 'sending', { status: 'failed' })
        );
      }, failTimeoutMs);

      patchConversationInCache(queryClient, newMessage.conversationId, {
        last_message_at: new Date().toISOString(),
        // O fallback antigo era `Sent ${messageType}` — em inglês. Nunca apareceu
        // porque este patch estava morto; agora que volta a valer, tem que sair
        // em pt-BR e na mesma convenção do evolution-webhook.
        last_message_preview:
          newMessage.content?.substring(0, 100) || outgoingMediaPreview(newMessage.messageType),
        is_last_message_from_me: true,
        isLastMessageFromMe: true,
      });

      return { previousMessages, tempId };
    },
    onError: (err, newMessage, context) => {
      // Rate limit: a mensagem NUNCA foi enviada — o servidor recusou.
      // Marcar como 'failed' é enganoso (sugere falha de entrega e oferece retry).
      // O ChatInput já restaura o texto no input, então some com a bolha otimista.
      if ((err as any)?.rateLimited === true && context?.tempId) {
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', newMessage.conversationId],
          (old) => {
            if (!old?.pages) return old;
            return {
              ...old,
              pages: old.pages.map((pg) => pg.filter((m) => m.id !== context.tempId)),
            };
          }
        );
        return;
      }

      // Não apaga a mensagem — marca como falhou para o técnico ver
      if (context?.tempId) {
        queryClient.setQueryData<MsgPages>(
          ['whatsapp', 'messages', newMessage.conversationId],
          (old) => patchInfinite(old, (m) => m.id === context.tempId, { status: 'failed' })
        );
      }
    },
    onSettled: (data, _error, variables) => {
      // A edge function pode ter ABERTO o atendimento neste envio: quando o
      // operador escreve a primeira frase num chat que ele mesmo iniciou, o
      // send-whatsapp-message cria o support_attendances já `in_progress`, no
      // nome dele e no setor dele. Isso muda o bucket da conversa — ela sai de
      // "encerrada" e entra em "Atendendo".
      //
      // Quem enviou não pode depender do Realtime para descobrir a própria
      // ação. Sem este refresh a conversa só entrava na pill certa no refetch
      // de 60s, e o atendente concluía (com razão) que precisava dar F5.
      //
      // Só custa request quando a conversa NÃO está em nenhuma página
      // carregada — que é exatamente o caso em que ela está faltando na lista.
      // No envio comum, com o chat já na tela, isto não dispara nada.
      if (!_error && !isConversationInCache(queryClient, variables.conversationId)) {
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'active-attendance-conv-ids'] });
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
        queryClient.invalidateQueries({ queryKey: ['whatsapp', 'pill-counts'] });
      }

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
