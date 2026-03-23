import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[meta-webhook]';

// ── Phone normalization (mirrors evolution-webhook) ──────────────────
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  // Add 9th digit for BR mobile if 12 digits (55+DDD+8)
  if (digits.startsWith('55') && digits.length === 12) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4);
    console.log(`${LOG} Brazilian phone normalized: ${digits}`);
  }
  return digits;
}

// ── Map Meta message type to our internal type ───────────────────────
function mapMessageType(msg: any): string {
  if (!msg) return 'text';
  const t = msg.type;
  if (t === 'text') return 'text';
  if (t === 'image') return 'image';
  if (t === 'video') return 'video';
  if (t === 'audio') return 'audio';
  if (t === 'document') return 'document';
  if (t === 'sticker') return 'sticker';
  if (t === 'contacts') return 'contact';
  if (t === 'location') return 'text';
  if (t === 'reaction') return 'reaction';
  return 'text';
}

// ── Extract text content from Meta message ───────────────────────────
function extractContent(msg: any): string {
  if (!msg) return '';
  const t = msg.type;
  if (t === 'text') return msg.text?.body || '';
  if (t === 'image') return msg.image?.caption || '📷 Imagem';
  if (t === 'video') return msg.video?.caption || '🎥 Vídeo';
  if (t === 'audio') return '🎵 Áudio';
  if (t === 'document') return msg.document?.caption || `📄 ${msg.document?.filename || 'Documento'}`;
  if (t === 'sticker') return '🎨 Sticker';
  if (t === 'contacts') {
    const count = msg.contacts?.length || 0;
    return `📇 ${count} contato${count !== 1 ? 's' : ''}`;
  }
  if (t === 'location') return `📍 Localização: ${msg.location?.latitude},${msg.location?.longitude}`;
  if (t === 'reaction') return msg.reaction?.emoji || '';
  return '';
}

// ── Build media metadata ─────────────────────────────────────────────
function extractMediaMeta(msg: any): Record<string, any> | null {
  if (!msg) return null;
  const t = msg.type;
  const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];
  if (!mediaTypes.includes(t)) return null;
  const media = msg[t];
  if (!media) return null;
  return {
    meta_media_id: media.id || null,
    mime_type: media.mime_type || null,
    filename: media.filename || null,
    sha256: media.sha256 || null,
  };
}

// ── Download media from Meta Graph API and upload to Supabase Storage ─
async function downloadAndUploadMetaMedia(
  supabase: any,
  accessToken: string,
  mediaId: string,
  mimetype: string,
  tenantId: string,
  instanceId: string,
  conversationId: string,
  messageId: string,
  filename: string | null,
): Promise<{ storagePath: string | null }> {
  try {
    // Step 1: Get media URL from Graph API
    console.log(`${LOG} Fetching media URL for media_id=${mediaId}`);
    const metaResp = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!metaResp.ok) {
      console.error(`${LOG} Failed to get media URL: ${metaResp.status} ${await metaResp.text()}`);
      return { storagePath: null };
    }

    const metaData = await metaResp.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) {
      console.error(`${LOG} No url in media response`);
      return { storagePath: null };
    }

    // Step 2: Download the binary content
    console.log(`${LOG} Downloading media binary from Meta CDN`);
    const downloadResp = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!downloadResp.ok) {
      console.error(`${LOG} Failed to download media: ${downloadResp.status}`);
      return { storagePath: null };
    }

    const mediaBytes = new Uint8Array(await downloadResp.arrayBuffer());
    const blob = new Blob([mediaBytes], { type: mimetype });

    // Step 3: Build storage path (mirrors Evolution pattern)
    const ext = filename
      ? filename.split('.').pop()?.toLowerCase() || mimetype.split('/')[1]?.split(';')[0] || 'bin'
      : mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const storageFilename = `${Date.now()}-${mediaId}.${ext}`;
    const storagePath = `${tenantId}/${instanceId}/${conversationId}/${storageFilename}`;

    // Step 4: Upload to Supabase Storage
    console.log(`${LOG} Uploading media to storage: ${storagePath}`);
    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(storagePath, blob, {
        contentType: mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error(`${LOG} Storage upload error:`, uploadError);
      return { storagePath: null };
    }

    console.log(`${LOG} Media uploaded: ${storagePath}`);
    return { storagePath };
  } catch (error) {
    console.error(`${LOG} Error in downloadAndUploadMetaMedia:`, error);
    return { storagePath: null };
  }
}

// ── Find or create contact ───────────────────────────────────────────
async function findOrCreateContact(
  supabase: any,
  instanceId: string,
  phoneNumber: string,
  name: string,
  tenantId: string,
): Promise<string | null> {
  // Build phone variants for BR numbers (with/without 9th digit)
  const variants = [phoneNumber];
  if (phoneNumber.startsWith('55') && phoneNumber.length === 13) {
    variants.push(phoneNumber.slice(0, 4) + phoneNumber.slice(5));
  }
  if (phoneNumber.startsWith('55') && phoneNumber.length === 12) {
    variants.push(phoneNumber.slice(0, 4) + '9' + phoneNumber.slice(4));
  }

  const { data: existing } = await supabase
    .from('whatsapp_contacts')
    .select('id, name, phone_number')
    .eq('tenant_id', tenantId)
    .in('phone_number', variants)
    .maybeSingle();

  if (existing) {
    // Normalize phone if changed
    if (existing.phone_number !== phoneNumber) {
      await supabase
        .from('whatsapp_contacts')
        .update({ phone_number: phoneNumber, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    // Update name if contact had only the number as name
    if (name && name !== phoneNumber && existing.name === existing.phone_number) {
      await supabase
        .from('whatsapp_contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from('whatsapp_contacts')
    .insert({
      instance_id: instanceId,
      phone_number: phoneNumber,
      name: name || phoneNumber,
      is_group: false,
      tenant_id: tenantId,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${LOG} Error creating contact:`, error);
    return null;
  }
  console.log(`${LOG} Contact created: ${created.id}`);
  return created.id;
}

// ── Find or create conversation (instance-scoped) ────────────────────
async function findOrCreateConversation(
  supabase: any,
  instanceId: string,
  contactId: string,
  tenantId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('whatsapp_conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('instance_id', instanceId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('whatsapp_conversations')
    .insert({
      instance_id: instanceId,
      contact_id: contactId,
      status: 'active',
      tenant_id: tenantId,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${LOG} Error creating conversation:`, error);
    return null;
  }
  console.log(`${LOG} Conversation created: ${created.id}`);
  return created.id;
}

// ── Process a single inbound/outbound message ────────────────────────
async function processMessage(
  supabase: any,
  instanceId: string,
  tenantId: string,
  phoneNumber: string,
  contactName: string,
  msg: any,
  isFromMe: boolean,
  metaTimestamp: number | null,
) {
  const messageId = msg.id;
  if (!messageId) {
    console.warn(`${LOG} Message without id, skipping`);
    return;
  }

  const phone = normalizePhone(phoneNumber);
  const contactId = await findOrCreateContact(supabase, instanceId, phone, contactName, tenantId);
  if (!contactId) return;

  const conversationId = await findOrCreateConversation(supabase, instanceId, contactId, tenantId);
  if (!conversationId) return;

  const messageType = mapMessageType(msg);

  // Reactions are handled separately
  if (messageType === 'reaction') {
    console.log(`${LOG} Reaction message, skipping persistence for now`);
    return;
  }

  const content = extractContent(msg);
  const mediaMeta = extractMediaMeta(msg);
  const timestamp = metaTimestamp
    ? new Date(metaTimestamp * 1000).toISOString()
    : new Date().toISOString();

  // Build metadata
  const metadata: Record<string, any> = {
    source: 'meta_cloud',
    provider: 'meta',
  };
  if (mediaMeta) {
    metadata.media = mediaMeta;
  }

  // Dedupe via upsert
  const { data: savedMsg, error: msgError } = await supabase
    .from('whatsapp_messages')
    .upsert(
      {
        conversation_id: conversationId,
        remote_jid: `${phoneNumber}@s.whatsapp.net`,
        message_id: messageId,
        content,
        message_type: messageType,
        media_url: null,
        media_mimetype: mediaMeta?.mime_type || null,
        media_path: null,
        media_filename: mediaMeta?.filename || null,
        media_ext: mediaMeta?.filename?.split('.')?.pop()?.toLowerCase() || null,
        media_size_bytes: null,
        media_kind: mediaMeta
          ? (['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type) ? msg.type : 'other')
          : null,
        is_from_me: isFromMe,
        status: isFromMe ? 'sent' : 'received',
        timestamp,
        tenant_id: tenantId,
        instance_id: instanceId,
        metadata,
      },
      { onConflict: 'tenant_id,message_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  if (msgError) {
    console.error(`${LOG} Error saving message:`, msgError);
    return;
  }

  if (savedMsg) {
    console.log(`${LOG} Message saved: message_id=${messageId}, conversation_id=${conversationId}, instance_id=${instanceId}, tenant_id=${tenantId}`);
  } else {
    console.log(`${LOG} Duplicate ignored: message_id=${messageId}`);
  }

  // Update conversation preview
  const { data: currentConv } = await supabase
    .from('whatsapp_conversations')
    .select('last_message_at, unread_count')
    .eq('id', conversationId)
    .single();

  const isNewerOrEqual = !currentConv?.last_message_at || timestamp >= currentConv.last_message_at;

  const updateData: Record<string, any> = {};
  if (isNewerOrEqual) {
    updateData.last_message_at = timestamp;
    updateData.last_message_preview = content.substring(0, 200);
    updateData.is_last_message_from_me = isFromMe;
  }
  if (!isFromMe) {
    updateData.unread_count = (currentConv?.unread_count || 0) + 1;
  }

  if (Object.keys(updateData).length > 0) {
    await supabase
      .from('whatsapp_conversations')
      .update(updateData)
      .eq('id', conversationId);
  }

  console.log(`${LOG} Conversation updated: conversation_id=${conversationId}`);
}

// ── Process status updates (sent/delivered/read) ─────────────────────
async function processStatus(
  supabase: any,
  tenantId: string,
  status: any,
) {
  const messageId = status.id;
  const statusValue = status.status; // sent | delivered | read | failed

  if (!messageId || !statusValue) {
    console.warn(`${LOG} Status update missing id or status`);
    return;
  }

  const statusMap: Record<string, string> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };
  const mappedStatus = statusMap[statusValue] || statusValue;

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .update({ status: mappedStatus })
    .eq('tenant_id', tenantId)
    .eq('message_id', messageId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`${LOG} Status update error:`, error);
    return;
  }

  if (data) {
    console.log(`${LOG} Status updated: message_id=${messageId} -> ${mappedStatus}`);
  } else {
    console.warn(`${LOG} Status update matched 0 rows: message_id=${messageId}, tenant_id=${tenantId}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // ── GET: Webhook verification handshake ────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode !== 'subscribe' || !token || !challenge) {
      console.warn(`${LOG} Webhook verification FAILED: missing params`);
      return new Response('Forbidden', { status: 403 });
    }

    // Buscar token de verificação nas instâncias Meta Cloud (whatsapp_instance_secrets)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseVerify = createClient(supabaseUrl, serviceRoleKey);

    const { data: matchingSecrets, error: secretsErr } = await supabaseVerify
      .from('whatsapp_instance_secrets')
      .select('instance_id, meta_verify_token')
      .eq('meta_verify_token', token)
      .limit(1);

    if (secretsErr) {
      console.error(`${LOG} Error querying verify tokens:`, secretsErr);
      return new Response('Internal Server Error', { status: 500 });
    }

    if (matchingSecrets && matchingSecrets.length > 0) {
      console.log(`${LOG} Webhook verification OK for instance_id=${matchingSecrets[0].instance_id}`);
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    console.warn(`${LOG} Webhook verification FAILED: no matching verify_token found`);
    return new Response('Forbidden', { status: 403 });
  }

  // ── POST: Process webhook events ───────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    console.error(`${LOG} Invalid JSON body`);
    return new Response('Bad Request', { status: 400 });
  }

  // Meta sends { object: 'whatsapp_business_account', entry: [...] }
  if (body.object !== 'whatsapp_business_account') {
    console.warn(`${LOG} Unknown object type: ${body.object}`);
    return new Response('OK', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) {
        console.warn(`${LOG} Missing phone_number_id in metadata`);
        continue;
      }

      // Resolve instance by meta_phone_number_id
      const { data: instance, error: instErr } = await supabase
        .from('whatsapp_instances')
        .select('id, tenant_id, instance_name, provider_type')
        .eq('meta_phone_number_id', phoneNumberId)
        .eq('provider_type', 'meta_cloud')
        .maybeSingle();

      if (instErr) {
        console.error(`${LOG} Error resolving instance:`, instErr);
        continue;
      }

      if (!instance) {
        console.warn(`${LOG} No instance found for phone_number_id=${phoneNumberId}`);
        continue;
      }

      const tenantId = instance.tenant_id;
      const instanceId = instance.id;

      console.log(`${LOG} Processing event: phone_number_id=${phoneNumberId}, instance_id=${instanceId}, tenant_id=${tenantId}`);

      // Build contact name map from contacts array
      const contactNameMap: Record<string, string> = {};
      for (const contact of value.contacts || []) {
        const wa_id = contact.wa_id;
        const name = contact.profile?.name;
        if (wa_id && name) {
          contactNameMap[wa_id] = name;
        }
      }

      // Process inbound messages
      for (const msg of value.messages || []) {
        const from = msg.from; // phone number (digits)
        const contactName = contactNameMap[from] || from;
        const ts = msg.timestamp ? parseInt(msg.timestamp, 10) : null;

        await processMessage(supabase, instanceId, tenantId, from, contactName, msg, false, ts);
      }

      // Process status updates
      for (const status of value.statuses || []) {
        await processStatus(supabase, tenantId, status);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
