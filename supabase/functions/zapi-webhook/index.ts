import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets } from '../_shared/message-types.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const LOG = '[zapi-webhook]';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await processZapiWebhook(req);
  } catch (err) {
    console.error(`${LOG} Erro no processamento:`, err);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Normaliza nÃºmero BR: adiciona 9 para celulares com 8 dÃ­gitos locais
function normalizeZapiPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  digits = digits.split('@')[0];
  if (!digits.startsWith('55') && digits.length <= 11) digits = '55' + digits;
  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const numero = digits.substring(4);
    if (numero.length === 8 && /^[6-9]/.test(numero)) digits = '55' + ddd + '9' + numero;
  }
  return digits;
}

async function processZapiWebhook(req: Request): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    console.error(`${LOG} Payload invÃ¡lido`);
    return;
  }

  console.log(`${LOG} Payload:`, JSON.stringify(payload).substring(0, 400));

  // ââ Identificar instÃ¢ncia pelo zapi_instance_id ââââââââââââââ
  const zapiInstanceId = payload?.instanceId || payload?.instance?.id || null;
  if (!zapiInstanceId) {
    console.warn(`${LOG} instanceId ausente no payload`);
    return;
  }

  const { data: instanceRow, error: instanceErr } = await supabase
    .from('whatsapp_instances')
    .select('id, tenant_id')
    .eq('instance_id_external', zapiInstanceId)
    .eq('provider_type', 'zapi')
    .maybeSingle();

  if (instanceErr || !instanceRow) {
    console.warn(`${LOG} Instância não encontrada: zapiInstanceId=${zapiInstanceId}`);
    return;
  }

  const secrets = await getInstanceSecrets(supabase, instanceRow.id);

  // ── Validar token de segurança ───────────────────────────────────────────
  const zapiWebhookToken = secrets?.zapi_webhook_token || null;
  if (zapiWebhookToken) {
    const receivedToken =
      req.headers.get('X-Zapitoken') ||
      req.headers.get('x-zapitoken') ||
      payload?.token ||
      null;
    if (receivedToken !== zapiWebhookToken) {
      console.warn(`${LOG} Token inválido`);
      return;
    }
  }

  const instanceId = instanceRow.id;

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('id, tenant_id, instance_name, provider_type, instance_id_external, meta_phone_number_id, skip_ura')
    .eq('id', instanceId)
    .maybeSingle();

  if (!instance?.tenant_id) {
    console.warn(`${LOG} tenant_id nÃ£o encontrado`);
    return;
  }

  const type = payload?.type || payload?.event || '';
  console.log(`${LOG} Evento: ${type} | instance: ${instance.instance_name}`);

  // ââ Status de conexÃ£o âââââââââââââââââââââââââââââââââââââââââ
  if (type === 'connected' || type === 'disconnected') {
    await supabase.from('whatsapp_instances').update({ status: type, updated_at: new Date().toISOString() }).eq('id', instanceId);
    return;
  }

  // ââ Status de mensagem ââââââââââââââââââââââââââââââââââââââââ
  if (type === 'MessageStatusCallback') {
    const messageId = payload?.messageId || payload?.id;
    const status = payload?.status;
    if (messageId && status) {
      const statusMap: Record<string, string> = { SENT: 'sent', DELIVERED: 'delivered', READ: 'read', FAILED: 'failed', sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
      await supabase.from('whatsapp_messages').update({ status: statusMap[status] || status.toLowerCase() }).eq('message_id', messageId).eq('tenant_id', instance.tenant_id);
    }
    return;
  }

  // ââ Mensagens recebidas âââââââââââââââââââââââââââââââââââââââ
  if (type !== 'ReceivedCallback' && !payload?.isMessage) {
    console.log(`${LOG} Evento ignorado: ${type}`);
    return;
  }

  // Ignorar mensagens enviadas pelo agente (jÃ¡ salvas pelo send-whatsapp-message)
  if (payload?.fromMe === true || payload?.isFromMe === true) {
    console.log(`${LOG} Mensagem fromMe ignorada`);
    return;
  }

  // ââ Normalizar payload Z-API â NormalizedInboundMessage ââââââ
  const rawPhone = payload?.phone || payload?.from || '';
  if (!rawPhone) { console.warn(`${LOG} Telefone ausente`); return; }

  const normalizedPhone = normalizeZapiPhone(rawPhone);
  const messageId = payload?.messageId || payload?.id || `zapi_${Date.now()}`;
  const timestamp = payload?.momment
    ? new Date(payload.momment).toISOString()
    : new Date().toISOString();

  let messageType: NormalizedInboundMessage['messageType'] = 'text';
  let mediaUrl: string | null = null;
  let mediaMimetype: string | null = null;
  let mediaFilename: string | null = null;
  let content = payload?.text?.message || payload?.body || payload?.message || '';

  if (payload?.image) {
    messageType = 'image'; mediaUrl = payload.image?.imageUrl || null;
    mediaMimetype = payload.image?.mimeType || 'image/jpeg';
    content = payload.image?.caption || content || '';
  } else if (payload?.audio) {
    messageType = 'audio'; mediaUrl = payload.audio?.audioUrl || null;
    mediaMimetype = payload.audio?.mimeType || 'audio/ogg'; content = '';
  } else if (payload?.video) {
    messageType = 'video'; mediaUrl = payload.video?.videoUrl || null;
    mediaMimetype = payload.video?.mimeType || 'video/mp4';
    content = payload.video?.caption || content || '';
  } else if (payload?.document) {
    messageType = 'document'; mediaUrl = payload.document?.documentUrl || null;
    mediaMimetype = payload.document?.mimeType || 'application/octet-stream';
    mediaFilename = payload.document?.fileName || null;
    content = payload.document?.caption || content || '';
  }

  const instanceInfo: InstanceInfo = {
    id: instance.id,
    instance_name: instance.instance_name,
    provider_type: instance.provider_type as any,
    instance_id_external: instance.instance_id_external,
    meta_phone_number_id: instance.meta_phone_number_id,
    skip_ura: instance.skip_ura ?? false,
    tenant_id: instance.tenant_id,
  };

  const vaultSecrets: InstanceSecrets = {
    zapi_instance_id: secrets.zapi_instance_id,
    zapi_token: secrets.zapi_token,
    zapi_client_token: secrets.zapi_client_token,
  };

  const normalized: NormalizedInboundMessage = {
    instanceId,
    tenantId: instance.tenant_id,
    providerType: instance.provider_type as any,
    instanceInfo,
    secrets: vaultSecrets,
    messageId,
    remoteJid: `${normalizedPhone}@s.whatsapp.net`,
    fromMe: false,
    pushName: payload?.senderName || payload?.name || '',
    content,
    messageType,
    timestamp,
    mediaUrl,
    mediaMimetype,
    mediaFilename,
    rawPayload: payload,
  };

  console.log(`${LOG} Delegando para processInboundMessage: ${normalizedPhone}`);
  await processInboundMessage(supabase, normalized);
}
