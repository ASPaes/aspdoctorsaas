import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets } from '../_shared/message-types.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { applyDeliveryStatus } from '../_shared/apply-delivery-status.ts';

const LOG = '[zapi-webhook]';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // @ts-ignore - EdgeRuntime é fornecido pelo Supabase Edge runtime
  EdgeRuntime.waitUntil(
    processZapiWebhook(req).catch((err) => {
      console.error(`${LOG} Erro no processamento (background):`, err);
    })
  );

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

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

/**
 * DEM lid (Nível 1): detecta JID anômalo (provável WhatsApp Linked ID).
 * APENAS marca flag informativa em whatsapp_conversations.metadata.has_lid_anomalies.
 * NÃO bloqueia processamento, NÃO altera fluxo. Comportamento atual 100% preservado.
 */
function isLidAnomalous(rawJid: string): boolean {
  if (!rawJid) return false;
  const beforeAt = rawJid.split('@')[0];
  const digits = beforeAt.replace(/\D/g, '');
  return digits.length >= 14;
}

async function downloadAndUploadZapiMedia(
  mediaUrl: string,
  supabase: any,
  instanceName: string,
  messageId: string,
  mimetype: string,
): Promise<string | null> {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      console.error(`${LOG} Failed to download Z-API media: ${response.status} ${response.statusText}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8.length === 0) {
      console.error(`${LOG} Downloaded media is empty`);
      return null;
    }
    const extension = (mimetype.split('/')[1] || 'bin').split(';')[0].trim();
    const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 40);
    const filename = `${Date.now()}-${safeId}.${extension}`;
    const filePath = `${instanceName}/${filename}`;
    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, uint8, { contentType: mimetype, upsert: false });
    if (uploadError) {
      console.error(`${LOG} Storage upload error:`, uploadError);
      return null;
    }
    console.log(`${LOG} Media uploaded to storage: ${filePath} (${uint8.length} bytes)`);
    return filePath;
  } catch (err) {
    console.error(`${LOG} Error in downloadAndUploadZapiMedia:`, err);
    return null;
  }
}

async function processZapiWebhook(req: Request): Promise<void> {

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    console.error(`${LOG} Payload inválido`);
    return;
  }

  console.log(`${LOG} Payload:`, JSON.stringify(payload).substring(0, 400));

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
    console.warn(`${LOG} tenant_id não encontrado`);
    return;
  }

  const type = payload?.type || payload?.event || '';
  console.log(`${LOG} Evento: ${type} | instance: ${instance.instance_name}`);

  if (type === 'connected' || type === 'disconnected') {
    await supabase.from('whatsapp_instances').update({ status: type, updated_at: new Date().toISOString() }).eq('id', instanceId);
    return;
  }

  if (type === 'MessageStatusCallback') {
    const messageId = payload?.messageId || payload?.id;
    const status = payload?.status;
    if (messageId && status) {
      // Escada única, igual aos outros dois provedores. Ver _shared/delivery-status.ts.
      const r = await applyDeliveryStatus(supabase, {
        tenantId: instance.tenant_id,
        messageId,
        providerStatus: String(status),
      });
      if (r.confirmedFailureCandidate) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-failed-deliveries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ tenantId: instance.tenant_id, messageId }),
        }).catch((e) => console.error(`${LOG} verify dispatch falhou:`, e?.message));
      }
    }
    return;
  }

  if (type !== 'ReceivedCallback' && !payload?.isMessage) {
    console.log(`${LOG} Evento ignorado: ${type}`);
    return;
  }

  if (payload?.fromMe === true || payload?.isFromMe === true) {
    console.log(`${LOG} Mensagem fromMe ignorada`);
    return;
  }

  const rawJid = payload?.phone || payload?.from || '';
  const isGroup =
    rawJid.includes('@g.us') ||
    payload?.isGroup === true ||
    payload?.chatId?.includes('@g.us') ||
    (rawJid.replace(/\D/g, '').length > 15);

  if (isGroup) {
    const rawGroupId = rawJid.replace(/\D/g, '').split('@')[0] || rawJid;
    const groupJid = rawJid.includes('@g.us') ? rawJid : `${rawGroupId}@g.us`;
    const { data: grpCfg } = await supabase
      .from('whatsapp_groups')
      .select('id')
      .eq('tenant_id', instance.tenant_id)
      .eq('instance_id', instanceId)
      .eq('group_jid', groupJid)
      .eq('enabled', true)
      .maybeSingle();
    if (!grpCfg) {
      console.log(`${LOG} Group not whitelisted, ignoring: ${groupJid}`);
      return;
    }
  }

  const rawPhone = payload?.phone || payload?.from || '';
  if (!rawPhone) { console.warn(`${LOG} Telefone ausente`); return; }

  // DEM lid Nível 1: detectar JID anômalo (apenas informativo)
  const lidAnomalous = !isGroup && isLidAnomalous(rawPhone);
  if (lidAnomalous) {
    const senderName = payload?.senderName || payload?.name || '<vazio>';
    const hasContent = !!(payload?.text?.message || payload?.body || payload?.message);
    console.warn(
      `${LOG} JID lid anômalo detectado: rawPhone=${rawPhone} ` +
      `senderName=${senderName} hasContent=${hasContent} ` +
      `tenant=${instance.tenant_id} instance=${instance.instance_name}`
    );
  }

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
  } else if (payload?.contact) {
    console.log('[zapi-webhook] contact payload:', JSON.stringify(payload.contact));
    messageType = 'contact';
    content = payload.contact?.displayName || payload.contact?.name || '';
  } else if (payload?.contacts && Array.isArray(payload.contacts)) {
    messageType = 'contacts';
    content = payload.contacts.map((c: any) => c.displayName || c.name || '').filter(Boolean).join(', ');
  }

  let mediaStoragePath: string | null = null;
  if (mediaUrl && ['image', 'audio', 'video', 'document'].includes(messageType)) {
    mediaStoragePath = await downloadAndUploadZapiMedia(
      mediaUrl,
      supabase,
      instance.instance_name || `zapi_${zapiInstanceId}`,
      messageId,
      mediaMimetype || 'application/octet-stream',
    );
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
    remoteJid: isGroup ? `${rawJid.includes('@g.us') ? rawJid : rawJid.replace(/\D/g, '').split('@')[0] + '@g.us'}` : `${normalizedPhone}@s.whatsapp.net`,
    fromMe: false,
    pushName: payload?.senderName || payload?.name || '',
    content,
    messageType,
    timestamp,
    mediaUrl,
    mediaMimetype,
    mediaFilename,
    mediaStoragePath,
    rawPayload: payload,
  };

  if (payload?.contact) {
    normalized.contactData = {
      contact: {
        displayName: payload.contact?.displayName || payload.contact?.name || null,
        vcard: payload.contact?.vCard || payload.contact?.vcard || null,
      },
    };
  } else if (payload?.contacts && Array.isArray(payload.contacts)) {
    normalized.contactData = {
      contacts: payload.contacts.map((c: any) => ({
        displayName: c.displayName || c.name || null,
        vcard: c.vCard || c.vcard || null,
      })),
    };
  }

  console.log(`${LOG} Delegando para processInboundMessage: ${normalizedPhone}`);
  await processInboundMessage(supabase, normalized);

  // DEM lid Nível 1: marcar conversa pós-processamento se foi caso anômalo
  if (lidAnomalous) {
    try {
      const { data: contactRow } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .eq('tenant_id', instance.tenant_id)
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      if (!contactRow) {
        console.warn(`${LOG} [lid-flag] Contato não encontrado: phone=${normalizedPhone}`);
      } else {
        const { data: convRow } = await supabase
          .from('whatsapp_conversations')
          .select('id, metadata')
          .eq('contact_id', contactRow.id)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (!convRow) {
          console.warn(`${LOG} [lid-flag] Conversa não encontrada: contact=${contactRow.id}`);
        } else {
          const currentMeta = (convRow.metadata as Record<string, unknown>) || {};
          if (currentMeta.has_lid_anomalies !== true) {
            const newMeta = { ...currentMeta, has_lid_anomalies: true };
            const { error: updErr } = await supabase
              .from('whatsapp_conversations')
              .update({ metadata: newMeta, updated_at: new Date().toISOString() })
              .eq('id', convRow.id);
            if (updErr) {
              console.error(`${LOG} [lid-flag] Erro ao atualizar metadata:`, updErr);
            } else {
              console.log(`${LOG} [lid-flag] Flag has_lid_anomalies=true setada em conversation ${convRow.id}`);
            }
          }
        }
      }
    } catch (err) {
      // Falha aqui NUNCA pode quebrar o fluxo principal — só loga.
      console.error(`${LOG} [lid-flag] Exception ao marcar conversa:`, err);
    }
  }
}
