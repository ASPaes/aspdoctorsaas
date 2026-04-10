import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets } from '../_shared/message-types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[evolution-webhook]';

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: any;
}

// ── Helpers de tipo de mensagem ───────────────────────────────────────────────

function getMessageType(message: any): NormalizedInboundMessage['messageType'] {
  if (!message) return 'text';
  if (message.reactionMessage) return 'reaction';
  if (message.protocolMessage?.type === 0 || message.protocolMessage?.type === 'REVOKE') return 'revoke';
  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.audioMessage) return 'audio';
  if (message.videoMessage) return 'video';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.contactMessage) return 'contact';
  if (message.contactsArrayMessage) return 'contacts';
  return 'text';
}

function isRevokeMessage(message: any): boolean {
  return !!(message?.protocolMessage &&
    (message.protocolMessage.type === 0 || message.protocolMessage.type === 'REVOKE'));
}

function isEditedMessage(message: any): boolean {
  return !!(message?.editedMessage || message?.protocolMessage?.editedMessage);
}

function getPayloadIsFromMe(data: any): boolean {
  return Boolean(
    data?.key?.fromMe ?? data?.key?.from_me ?? data?.fromMe ??
    data?.message?.key?.fromMe ?? data?.message?.key?.from_me ?? false
  );
}

function normalizePhoneNumber(remoteJid: string): { phone: string; isGroup: boolean } {
  const isGroup = remoteJid.includes('@g.us');
  let phone = remoteJid
    .replace('@s.whatsapp.net', '').replace('@g.us', '')
    .replace('@lid', '').replace(/:\d+/, '');
  if (phone.startsWith('55') && phone.length === 12) {
    phone = `55${phone.substring(2, 4)}9${phone.substring(4)}`;
  }
  return { phone, isGroup };
}

function getMessageContent(message: any, type: string): string {
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.contactMessage) return message.contactMessage.displayName || '📇 Contato';
  if (message.contactsArrayMessage) {
    const count = message.contactsArrayMessage.contacts?.length || 0;
    return `📇 ${count} contato${count !== 1 ? 's' : ''}`;
  }
  const mediaMessage = message[`${type}Message`];
  if (mediaMessage?.caption) return mediaMessage.caption;
  const descriptions: Record<string, string> = {
    image: '📷 Imagem', audio: '🎵 Áudio', video: '🎥 Vídeo',
    document: '📄 Documento', sticker: '🎨 Sticker',
  };
  return descriptions[type] || 'Mensagem';
}

// ── Download de mídia (Evolution API) ────────────────────────────────────────

async function downloadAndUploadMedia(
  apiUrl: string, apiKey: string, instanceName: string,
  messageKey: any, supabase: any, mimetype: string, providerType: string = 'self_hosted'
): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (providerType === 'cloud') headers['Authorization'] = `Bearer ${apiKey}`;
    else headers['apikey'] = apiKey;

    const response = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: { key: messageKey } }),
    });
    if (!response.ok) { console.error(`${LOG} Failed to download media: ${response.status}`); return null; }

    const data = await response.json();
    const base64Data = data.base64;
    if (!base64Data) { console.error(`${LOG} No base64 data`); return null; }

    const base64String = base64Data.split(',')[1] || base64Data;
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimetype });

    const extension = (mimetype.split('/')[1] || 'bin').split(';')[0].trim();
    const filename = `${Date.now()}-${messageKey.id}.${extension}`;
    const filePath = `${instanceName}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media').upload(filePath, blob, { contentType: mimetype, upsert: false });
    if (uploadError) { console.error(`${LOG} Storage upload error:`, uploadError); return null; }

    return filePath;
  } catch (err) {
    console.error(`${LOG} Error in downloadAndUploadMedia:`, err);
    return null;
  }
}

// ── Helpers de status / revoke / edit ────────────────────────────────────────

async function resolveInstanceTenant(supabase: any, instance: string): Promise<{ instanceId: string; tenantId: string } | null> {
  let { data } = await supabase.from('whatsapp_instances')
    .select('id, tenant_id').eq('instance_name', instance).maybeSingle();
  if (!data) {
    const { data: cloud } = await supabase.from('whatsapp_instances')
      .select('id, tenant_id').eq('instance_id_external', instance).maybeSingle();
    data = cloud;
  }
  if (!data) return null;
  return { instanceId: data.id, tenantId: data.tenant_id };
}

async function refreshConversationPreviewAfterRevoke(supabase: any, conversationId: string): Promise<void> {
  const { data: lastMsg } = await supabase.from('whatsapp_messages')
    .select('content, timestamp, is_from_me')
    .eq('conversation_id', conversationId)
    .neq('message_type', 'revoked')
    .order('timestamp', { ascending: false })
    .limit(1).maybeSingle();
  if (lastMsg) {
    await supabase.from('whatsapp_conversations').update({
      last_message_preview: lastMsg.content?.substring(0, 200) || '',
      last_message_at: lastMsg.timestamp,
      is_last_message_from_me: lastMsg.is_from_me,
    }).eq('id', conversationId);
  }
}

async function processMessageRevoke(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const { data } = payload;
    const revokedId = data?.key?.id || data?.message?.protocolMessage?.key?.id;
    if (!revokedId) { console.warn(`${LOG} Revoke: no message id`); return; }

    const resolved = await resolveInstanceTenant(supabase, payload.instance);
    if (!resolved) return;

    const { data: rows } = await supabase.from('whatsapp_messages').update({
      delete_status: 'revoked', delete_scope: 'everyone',
      deleted_at: new Date().toISOString(), message_type: 'revoked',
      content: '', media_url: null, media_path: null, media_mimetype: null,
      media_filename: null, media_ext: null, media_kind: null, delete_error: null,
    }).eq('tenant_id', resolved.tenantId).eq('message_id', revokedId)
      .select('id, conversation_id');

    if (rows?.length > 0) {
      await refreshConversationPreviewAfterRevoke(supabase, rows[0].conversation_id);
    }
  } catch (err) { console.error(`${LOG} Error in processMessageRevoke:`, err); }
}

async function processMessageEdit(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const { data } = payload;
    const editedMsg = data?.message?.editedMessage || data?.message?.protocolMessage?.editedMessage;
    const editedId = editedMsg?.key?.id || data?.key?.id;
    const newContent = editedMsg?.message?.conversation || editedMsg?.message?.extendedTextMessage?.text;
    if (!editedId || !newContent) { console.warn(`${LOG} Edit: missing id or content`); return; }

    const resolved = await resolveInstanceTenant(supabase, payload.instance);
    if (!resolved) return;

    await supabase.from('whatsapp_messages').update({
      content: newContent, is_edited: true, edited_at: new Date().toISOString(),
    }).eq('tenant_id', resolved.tenantId).eq('message_id', editedId);
  } catch (err) { console.error(`${LOG} Error in processMessageEdit:`, err); }
}

async function processMessageUpdate(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const updates = Array.isArray(payload.data) ? payload.data : [payload.data];
    const resolved = await resolveInstanceTenant(supabase, payload.instance);
    if (!resolved) return;

    const statusMap: Record<string, string> = {
      ERROR: 'error', PENDING: 'pending', SERVER_ACK: 'sent',
      DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read',
    };

    for (const update of updates) {
      const messageId = update?.key?.id;
      const statusRaw = update?.update?.status;
      if (!messageId || !statusRaw) continue;
      const mappedStatus = statusMap[statusRaw] || statusRaw.toLowerCase();
      await supabase.from('whatsapp_messages').update({ status: mappedStatus })
        .eq('tenant_id', resolved.tenantId).eq('message_id', messageId);
    }
  } catch (err) { console.error(`${LOG} Error in processMessageUpdate:`, err); }
}

async function processConnectionUpdate(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const state = payload.data?.state || payload.data?.connection;
    let status = 'disconnected';
    if (state === 'open' || state === 'connected') status = 'connected';
    else if (state === 'connecting') status = 'connecting';
    await supabase.from('whatsapp_instances').update({ status }).eq('instance_name', payload.instance);
    console.log(`${LOG} Connection updated: ${payload.instance} -> ${status}`);
  } catch (err) { console.error(`${LOG} Error in processConnectionUpdate:`, err); }
}

async function processSendMessageEvent(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const { instance, data } = payload;
    const { key, message, messageTimestamp } = data;
    if (!key?.id || !key?.remoteJid) return;

    let resolved = await resolveInstanceTenant(supabase, instance);
    if (!resolved) return;

    const { data: instanceData } = await supabase.from('whatsapp_instances')
      .select('id, instance_name, instance_id_external, provider_type, tenant_id, skip_ura')
      .eq('id', resolved.instanceId).maybeSingle();
    if (!instanceData) return;

    const evolutionInstanceId = instanceData.provider_type === 'cloud' && instanceData.instance_id_external
      ? instanceData.instance_id_external : instanceData.instance_name;

    const { phone } = normalizePhoneNumber(key.remoteJid);
    const { data: secrets } = await supabase.from('whatsapp_instance_secrets')
      .select('api_url, api_key').eq('instance_id', resolved.instanceId).single();
    if (!secrets) return;

    // Find or create contact and conversation (outbound)
    const { data: contact } = await supabase.from('whatsapp_contacts')
      .select('id').eq('tenant_id', resolved.tenantId).eq('phone_number', phone).maybeSingle();

    let contactId = contact?.id;
    if (!contactId) {
      const { data: newContact } = await supabase.from('whatsapp_contacts').insert({
        instance_id: resolved.instanceId, phone_number: phone,
        name: phone, is_group: false, tenant_id: resolved.tenantId,
      }).select('id').single();
      contactId = newContact?.id;
    }
    if (!contactId) return;

    const { data: existingConv } = await supabase.from('whatsapp_conversations')
      .select('id').eq('tenant_id', resolved.tenantId).eq('instance_id', resolved.instanceId)
      .eq('contact_id', contactId).maybeSingle();

    let conversationId = existingConv?.id;
    if (!conversationId) {
      const { data: newConv } = await supabase.from('whatsapp_conversations').insert({
        instance_id: resolved.instanceId, contact_id: contactId,
        status: 'closed', tenant_id: resolved.tenantId,
      }).select('id').single();
      conversationId = newConv?.id;
    }
    if (!conversationId) return;

    const messageType = getMessageType(message);
    const content = getMessageContent(message, messageType as string);
    const timestamp = new Date((messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();

    const { data: savedMsg } = await supabase.from('whatsapp_messages').upsert({
      conversation_id: conversationId, remote_jid: key.remoteJid,
      message_id: key.id, content, message_type: messageType,
      is_from_me: true, status: 'sent', timestamp,
      tenant_id: resolved.tenantId, instance_id: resolved.instanceId,
      metadata: {
        source: instanceData.instance_name?.toLowerCase().includes('financ') ? 'billing_automation' : 'automation',
        kind: instanceData.instance_name?.toLowerCase().includes('financ') ? 'cobranca' : 'general',
        event: 'send.message', instanceName: instance,
      },
    }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true }).select('id').maybeSingle();

    if (savedMsg) {
      await supabase.from('whatsapp_conversations').update({
        last_message_at: timestamp,
        last_message_preview: content.substring(0, 200) || '📤 Mensagem enviada',
        is_last_message_from_me: true, updated_at: new Date().toISOString(),
      }).eq('id', conversationId);

      // Limpar flag de fora do horário quando operador envia mensagem
      supabase.from('whatsapp_conversations').update({
        out_of_hours_cleared_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', conversationId).not('opened_out_of_hours_at', 'is', null)
        .is('out_of_hours_cleared_at', null).then(() => {}).catch(() => {});
    }
  } catch (err) { console.error(`${LOG} Error in processSendMessageEvent:`, err); }
}

// ── processMessageUpsert — delega ao message-processor ───────────────────────

async function processMessageUpsert(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const { instance, data } = payload;
    const { key, pushName, message, messageTimestamp } = data;

    console.log(`${LOG} Processing message: ${key.id}`);

    // ── Guard: Comandos administrativos ──────────────────────────────────────
    // Verificar ANTES de qualquer processamento
    // remote_jid pode vir sem o 9 (554991210660) ou com (5549991210660)
    {
      const ADMIN_PHONE_GUARD_SUFFIX = '49991210660'; // sufixo com 9
      const ADMIN_PHONE_GUARD_SUFFIX2 = '4991210660'; // sufixo sem 9
      const _rawJid = data?.key?.remoteJid || '';
      const _senderNum = _rawJid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace(/\D/g, '');
      const _msgText = (
        data?.message?.conversation ||
        data?.message?.extendedTextMessage?.text || ''
      ).trim().toUpperCase();
      const _isAdminSender = _senderNum.endsWith(ADMIN_PHONE_GUARD_SUFFIX) || _senderNum.endsWith(ADMIN_PHONE_GUARD_SUFFIX2);
      const _isAdminCmd = _isAdminSender &&
        (_msgText.startsWith('LIMIT UP') || _msgText === 'STATUS IA' || _msgText.startsWith('SNOOZE'));

      if (_isAdminCmd) {
        console.log(`${LOG} Admin command intercepted: ${_msgText} from ${_senderNum}`);
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-admin-commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` },
          body: JSON.stringify({ senderPhone: '5549991210660', command: _msgText }),
        }).catch(err => console.error(`${LOG} Admin command error:`, err));
        return;
      }
    }

    // Resolver instância
    let { data: instanceData } = await supabase.from('whatsapp_instances')
      .select('id, instance_name, instance_id_external, provider_type, status, tenant_id, skip_ura')
      .eq('instance_name', instance).maybeSingle();

    if (!instanceData) {
      const { data: cloudInstance } = await supabase.from('whatsapp_instances')
        .select('id, instance_name, instance_id_external, provider_type, status, tenant_id, skip_ura')
        .eq('instance_id_external', instance).maybeSingle();
      instanceData = cloudInstance;
    }

    if (!instanceData) { console.error(`${LOG} Instance not found: ${instance}`); return; }

    const tenantId = instanceData.tenant_id;
    const evolutionInstanceId = instanceData.provider_type === 'cloud' && instanceData.instance_id_external
      ? instanceData.instance_id_external : instanceData.instance_name;

    // Atualizar status para connected se necessário
    if (instanceData.status !== 'connected') {
      await supabase.from('whatsapp_instances').update({ status: 'connected', updated_at: new Date().toISOString() }).eq('id', instanceData.id);
    }

    const { data: secrets } = await supabase.from('whatsapp_instance_secrets')
      .select('api_url, api_key').eq('instance_id', instanceData.id).single();
    if (!secrets) { console.error(`${LOG} No secrets for instance ${instance}`); return; }

    const { phone, isGroup } = normalizePhoneNumber(key.remoteJid);
    const fromMe = getPayloadIsFromMe(data);
    const messageType = getMessageType(message);
    const timestamp = new Date(messageTimestamp * 1000).toISOString();

    // Filtro de grupos
    if (isGroup) {
      const { data: instCfg } = await supabase.from('whatsapp_instances')
        .select('ignore_group_messages').eq('id', instanceData.id).single();
      if (instCfg?.ignore_group_messages !== false) {
        console.log(`${LOG} Group message ignored: ${key.remoteJid}`);
        return;
      }
    }

    // Download de mídia antes de delegar
    let mediaStoragePath: string | null = null;
    let mediaMimetype: string | null = null;
    let mediaFilename: string | null = null;

    if (messageType !== 'text' && messageType !== 'reaction' && messageType !== 'revoke') {
      const mediaMessage = message[`${messageType}Message`];
      if (mediaMessage?.mimetype) {
        mediaMimetype = mediaMessage.mimetype;
        mediaFilename = mediaMessage.fileName || mediaMessage.filename || null;
        mediaStoragePath = await downloadAndUploadMedia(
          secrets.api_url, secrets.api_key, evolutionInstanceId,
          key, supabase, mediaMimetype, instanceData.provider_type || 'self_hosted'
        );
      }
    }

    const content = getMessageContent(message, messageType as string);
    const quotedMessageId = message.extendedTextMessage?.contextInfo?.stanzaId || null;

    const instanceInfo: InstanceInfo = {
      id: instanceData.id,
      instance_name: instanceData.instance_name,
      provider_type: instanceData.provider_type as any,
      instance_id_external: instanceData.instance_id_external,
      meta_phone_number_id: null,
      skip_ura: instanceData.skip_ura ?? false,
      tenant_id: tenantId,
    };

    const secretsObj: InstanceSecrets = {
      api_url: secrets.api_url,
      api_key: secrets.api_key,
    };

    const normalized: NormalizedInboundMessage = {
      instanceId: instanceData.id,
      tenantId,
      providerType: instanceData.provider_type as any,
      instanceInfo,
      secrets: secretsObj,
      messageId: key.id,
      remoteJid: key.remoteJid,
      fromMe,
      pushName: pushName || phone,
      content,
      messageType,
      timestamp,
      mediaUrl: null,
      mediaMimetype,
      mediaFilename,
      mediaStoragePath,
      quotedMessageId,
      rawPayload: data,
    };

    console.log(`${LOG} Delegando para processInboundMessage: ${phone} fromMe=${fromMe}`);
    await processInboundMessage(supabase, normalized);

  } catch (err) {
    console.error(`${LOG} Error in processMessageUpsert:`, err);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Validação de webhook secret
    const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET');
    if (webhookSecret) {
      const incomingSecret = req.headers.get('x-webhook-secret') || req.headers.get('apikey');
      if (incomingSecret !== webhookSecret) {
        console.warn(`${LOG} Unauthorized request`);
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const payload: EvolutionWebhookPayload = await req.json();
    console.log(`${LOG} Event: ${payload.event} Instance: ${payload.instance}`);

    // ── Roteamento de eventos ─────────────────────────────────────────────────
    switch (payload.event) {
      case 'messages.upsert':
        if (isRevokeMessage(payload.data?.message)) {
          await processMessageRevoke(payload, supabase);
        } else if (isEditedMessage(payload.data?.message)) {
          await processMessageEdit(payload, supabase);
        } else {
          await processMessageUpsert(payload, supabase);
        }
        break;
      case 'messages.update':
        await processMessageUpdate(payload, supabase);
        break;
      case 'messages.delete': {
        const deleteData = payload.data;
        const deletedKeyId = deleteData?.key?.id || deleteData?.keyId || deleteData?.id;
        if (deletedKeyId) {
          const resolved = await resolveInstanceTenant(supabase, payload.instance);
          if (resolved) {
            const { data: delRows } = await supabase.from('whatsapp_messages').update({
              delete_status: 'revoked', delete_scope: 'everyone',
              deleted_at: new Date().toISOString(), message_type: 'revoked',
              content: '', media_url: null, media_path: null,
              media_mimetype: null, media_filename: null, media_ext: null, media_kind: null, delete_error: null,
            }).eq('tenant_id', resolved.tenantId).eq('message_id', deletedKeyId)
              .select('id, conversation_id');
            if (delRows?.length > 0) await refreshConversationPreviewAfterRevoke(supabase, delRows[0].conversation_id);
          }
        }
        break;
      }
      case 'connection.update':
        await processConnectionUpdate(payload, supabase);
        break;
      case 'send.message':
        await processSendMessageEvent(payload, supabase);
        break;
      default:
        console.log(`${LOG} Unhandled event: ${payload.event}`);
    }

    return new Response(
      JSON.stringify({ success: true, event: payload.event }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    console.error(`${LOG} Fatal error:`, err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
