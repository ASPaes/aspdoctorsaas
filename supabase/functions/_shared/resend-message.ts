// Reenvio de uma mensagem já persistida. Extraído de resend-failed-message para poder
// ser chamado também pelo verificador (verify-failed-deliveries), que não tem JWT de
// usuário nenhum — só service_role.
//
// O que NÃO mora aqui, de propósito: autenticação, permissão de tenant, teto de 3
// tentativas manuais e cooldown de 60s. Isso é gate do handler HTTP e continua lá.
// Aqui é só "pegue esta linha e mande de novo".
import { getAdapter, getInstanceSecrets } from './providers/index.ts';

const LOG = '[resend-message]';

export interface ResendOutcome {
  ok: boolean;
  newMessageId?: string;
  error?: string;
}

export interface ResendOpts {
  /** quem mandou reenviar; null no reenvio automático */
  actorUserId: string | null;
  /** true = reenvio automático do verificador (teto de 1, volta para pending) */
  automatic: boolean;
}

export async function resendMessage(
  supabase: any,
  msg: any,
  opts: ResendOpts,
): Promise<ResendOutcome> {
  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('id, is_group, group_jid, whatsapp_contacts!inner(phone_number, name)')
    .eq('id', msg.conversation_id)
    .single() as any;

  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };

  const contact = (conversation as any).whatsapp_contacts;
  const isGroupConv = conversation.is_group === true;
  const destinationNumber = isGroupConv
    ? (conversation.group_jid || contact.phone_number)
    : (contact.phone_number.includes('@lid') ? contact.phone_number : contact.phone_number.replace(/\D/g, ''));

  const sendInstanceId = msg.instance_id;
  if (!sendInstanceId) return { ok: false, error: 'Instância da mensagem não disponível' };

  const [instanceResult, secrets] = await Promise.all([
    supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
      .eq('id', sendInstanceId)
      .single(),
    getInstanceSecrets(supabase, sendInstanceId),
  ]);

  if (instanceResult.error || !instanceResult.data) return { ok: false, error: 'Instância não encontrada' };
  const instanceData = instanceResult.data as any;
  const providerType = instanceData.provider_type || 'self_hosted';

  let mediaUrl: string | undefined;
  if (msg.message_type !== 'text') {
    if (!msg.media_path) {
      return { ok: false, error: 'Mídia original não disponível no storage. Envie manualmente.' };
    }
    const { data: signedData, error: signedErr } = await supabase.storage
      .from('whatsapp-media')
      .createSignedUrl(msg.media_path, 300);
    if (signedErr || !signedData?.signedUrl) {
      return { ok: false, error: 'Não foi possível gerar URL da mídia' };
    }
    mediaUrl = signedData.signedUrl;
  }

  const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata as Record<string, any> : {};
  const nowIso = new Date().toISOString();

  // O contador manual (metadata.retry_count, teto 3) e o automático (coluna
  // auto_retry_count, teto 1) são independentes: um não pode consumir o outro.
  const newMeta: Record<string, any> = opts.automatic
    ? { ...meta, auto_retry_at: nowIso }
    : { ...meta, retry_count: Number(meta.retry_count || 0) + 1, last_retry_at: nowIso, retried_by: opts.actorUserId };

  const adapter = getAdapter(providerType);
  const sendRequest: any = {
    to: destinationNumber,
    messageType: msg.message_type as any,
    content: msg.content || undefined,
    mediaUrl,
    mediaMimetype: msg.media_mimetype || undefined,
    fileName: msg.media_filename || undefined,
  };

  try {
    const sendResult = await adapter.send(secrets, instanceData, sendRequest);
    const newMessageId = sendResult.messageId;

    const patch: Record<string, unknown> = {
      // Reenvio automático volta para 'pending': quem promove a 'sent' é o ack.
      // O manual mantém o comportamento antigo, que o operador já conhece.
      status: opts.automatic ? 'pending' : 'sent',
      message_id: newMessageId,
      timestamp: nowIso,
      // O ciclo recomeça limpo: o veredito anterior não pode contaminar a tentativa nova.
      last_error_at: null,
      failure_confirmed_at: null,
      metadata: { ...newMeta, last_retry_error: null },
    };
    if (opts.automatic) patch.auto_retry_count = 1;

    const { error: updErr } = await supabase.from('whatsapp_messages').update(patch).eq('id', msg.id);
    if (updErr) {
      console.error(`${LOG} Update success error:`, updErr);
      return { ok: false, error: 'Mensagem reenviada mas falha ao atualizar registro' };
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

    console.log(`${LOG} Reenviada: msgId=${msg.id} automatico=${opts.automatic}`);
    return { ok: true, newMessageId };
  } catch (sendErr: any) {
    const errMsg = sendErr?.message || String(sendErr);
    console.error(`${LOG} Send failed:`, errMsg);
    await supabase
      .from('whatsapp_messages')
      .update({ metadata: { ...newMeta, last_retry_error: errMsg.substring(0, 500) } })
      .eq('id', msg.id);
    return { ok: false, error: errMsg };
  }
}
