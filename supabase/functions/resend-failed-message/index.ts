import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[resend-failed-message]';
const MAX_RETRIES = 3;
const COOLDOWN_SECONDS = 60;

interface ResendRequest {
  messageId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError('Unauthorized', 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !authUser) return jsonError('Unauthorized', 401);

    const body: ResendRequest = await req.json();
    if (!body.messageId) return jsonError('messageId é obrigatório', 400);

    const { data: msg, error: msgErr } = await supabase
      .from('whatsapp_messages')
      .select('id, tenant_id, conversation_id, instance_id, content, message_type, media_path, media_mimetype, media_filename, media_kind, status, is_from_me, metadata, remote_jid')
      .eq('id', body.messageId)
      .maybeSingle();

    if (msgErr || !msg) return jsonError('Mensagem não encontrada', 404);
    if (msg.is_from_me !== true) return jsonError('Só mensagens enviadas por você podem ser reenviadas', 400);
    if (msg.status !== 'failed') return jsonError('Apenas mensagens com falha podem ser reenviadas', 400);

    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('tenant_id, access_status, status, is_super_admin')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (!senderProfile) return jsonError('Perfil não encontrado', 403);
    const isSuperAdmin = senderProfile.is_super_admin === true;

    if (!isSuperAdmin) {
      const inactive = senderProfile.access_status !== 'ativo' && senderProfile.access_status !== 'active';
      if (inactive) return jsonError('Seu usuário está inativo', 403);
      if (senderProfile.tenant_id !== msg.tenant_id) return jsonError('Sem permissão para esta mensagem', 403);
    }

    const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata as Record<string, any> : {};
    const retryCount = Number(meta.retry_count || 0);
    const lastRetryAt = meta.last_retry_at ? new Date(meta.last_retry_at) : null;

    if (retryCount >= MAX_RETRIES) {
      return jsonError(`Limite de ${MAX_RETRIES} tentativas atingido. Apague e envie nova mensagem manualmente.`, 429);
    }

    if (lastRetryAt) {
      const elapsedSec = (Date.now() - lastRetryAt.getTime()) / 1000;
      if (elapsedSec < COOLDOWN_SECONDS) {
        const wait = Math.ceil(COOLDOWN_SECONDS - elapsedSec);
        return jsonError(`Aguarde ${wait}s antes de tentar novamente`, 429);
      }
    }

    const { data: conversation } = await supabase
      .from('whatsapp_conversations')
      .select('id, is_group, group_jid, whatsapp_contacts!inner(phone_number, name)')
      .eq('id', msg.conversation_id)
      .single() as any;

    if (!conversation) return jsonError('Conversa não encontrada', 404);

    const contact = (conversation as any).whatsapp_contacts;
    const isGroupConv = conversation.is_group === true;
    const destinationNumber = isGroupConv
      ? (conversation.group_jid || contact.phone_number)
      : (contact.phone_number.includes('@lid') ? contact.phone_number : contact.phone_number.replace(/\D/g, ''));

    const sendInstanceId = msg.instance_id;
    if (!sendInstanceId) return jsonError('Instância da mensagem não disponível', 400);

    const [instanceResult, secrets] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
        .eq('id', sendInstanceId)
        .single(),
      getInstanceSecrets(supabase, sendInstanceId),
    ]);

    if (instanceResult.error || !instanceResult.data) return jsonError('Instância não encontrada', 404);
    const instanceData = instanceResult.data as any;
    const providerType = instanceData.provider_type || 'self_hosted';

    let mediaUrl: string | undefined;
    if (msg.message_type !== 'text') {
      if (!msg.media_path) {
        return jsonError('Mídia original não disponível no storage. Envie manualmente.', 400);
      }
      const { data: signedData, error: signedErr } = await supabase.storage
        .from('whatsapp-media')
        .createSignedUrl(msg.media_path, 300);
      if (signedErr || !signedData?.signedUrl) {
        return jsonError('Não foi possível gerar URL da mídia', 500);
      }
      mediaUrl = signedData.signedUrl;
    }

    const adapter = getAdapter(providerType);
    const sendRequest: any = {
      to: destinationNumber,
      messageType: msg.message_type as any,
      content: msg.content || undefined,
      mediaUrl,
      mediaMimetype: msg.media_mimetype || undefined,
      fileName: msg.media_filename || undefined,
    };

    const nowIso = new Date().toISOString();
    const newMeta = {
      ...meta,
      retry_count: retryCount + 1,
      last_retry_at: nowIso,
      retried_by: authUser.id,
    };

    try {
      const sendResult = await adapter.send(secrets, instanceData, sendRequest);
      const newMessageId = sendResult.messageId;

      const { error: updErr } = await supabase
        .from('whatsapp_messages')
        .update({
          status: 'sent',
          message_id: newMessageId,
          timestamp: nowIso,
          metadata: { ...newMeta, last_retry_error: null },
        })
        .eq('id', msg.id);

      if (updErr) {
        console.error(`${LOG} Update success error:`, updErr);
        return jsonError('Mensagem reenviada mas falha ao atualizar registro', 500);
      }

      await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_at: nowIso,
          last_message_preview: (msg.content || '').substring(0, 200),
          is_last_message_from_me: true,
          updated_at: nowIso,
        })
        .eq('id', msg.conversation_id);

      console.log(`${LOG} Reenviada com sucesso: msgId=${msg.id} retry=${retryCount + 1}/${MAX_RETRIES}`);
      return new Response(
        JSON.stringify({ success: true, retryCount: retryCount + 1, maxRetries: MAX_RETRIES }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (sendErr: any) {
      const errMsg = sendErr?.message || String(sendErr);
      console.error(`${LOG} Send failed:`, errMsg);

      await supabase
        .from('whatsapp_messages')
        .update({
          metadata: { ...newMeta, last_retry_error: errMsg.substring(0, 500) },
        })
        .eq('id', msg.id);

      return jsonError(`Falha ao reenviar: ${errMsg}`, 502);
    }
  } catch (err: any) {
    console.error(`${LOG} Unexpected:`, err);
    return jsonError('Erro interno', 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
