import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets } from '../_shared/message-types.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[meta-webhook]';

// ── Validação de assinatura X-Hub-Signature-256 ───────────────────────────────
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace('sha256=', '');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === expected;
}

// ── Phone normalization ───────────────────────────────────────────────────────
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) digits = '55' + digits;
  if (digits.startsWith('55') && digits.length === 12) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits;
}

// ── Map Meta message type ─────────────────────────────────────────────────────
function mapMessageType(msg: any): NormalizedInboundMessage['messageType'] {
  if (!msg) return 'text';
  const t = msg.type;
  if (t === 'image') return 'image';
  if (t === 'video') return 'video';
  if (t === 'audio') return 'audio';
  if (t === 'document') return 'document';
  if (t === 'sticker') return 'sticker';
  if (t === 'contacts') return 'contacts';
  if (t === 'reaction') return 'reaction';
  return 'text';
}

// ── Extract text content ──────────────────────────────────────────────────────
function extractContent(msg: any): string {
  if (!msg) return '';
  const t = msg.type;
  if (t === 'text') return msg.text?.body || '';
  if (t === 'image') return msg.image?.caption || '📷 Imagem';
  if (t === 'video') return msg.video?.caption || '🎥 Vídeo';
  if (t === 'audio') return '🎵 Áudio';
  if (t === 'document') return msg.document?.caption || `📄 ${msg.document?.filename || 'Documento'}`;
  if (t === 'sticker') return '🎨 Sticker';
  if (t === 'contacts') { const c = msg.contacts?.length || 0; return `📇 ${c} contato${c !== 1 ? 's' : ''}`; }
  if (t === 'location') return `📍 Localização: ${msg.location?.latitude},${msg.location?.longitude}`;
  if (t === 'reaction') return msg.reaction?.emoji || '';
  return '';
}

// ── Extract media metadata ────────────────────────────────────────────────────
function extractMediaMeta(msg: any): { mediaId: string | null; mimetype: string | null; filename: string | null } {
  if (!msg) return { mediaId: null, mimetype: null, filename: null };
  const t = msg.type;
  if (!['image', 'video', 'audio', 'document', 'sticker'].includes(t)) return { mediaId: null, mimetype: null, filename: null };
  const media = msg[t];
  if (!media) return { mediaId: null, mimetype: null, filename: null };
  return { mediaId: media.id || null, mimetype: media.mime_type || null, filename: media.filename || null };
}

// ── Download media from Meta Graph API → Supabase Storage ────────────────────
async function downloadAndUploadMetaMedia(
  supabase: any, accessToken: string, mediaId: string, mimetype: string,
  tenantId: string, instanceId: string, conversationId: string, filename: string | null,
): Promise<string | null> {
  try {
    const metaResp = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaResp.ok) { console.error(`${LOG} Failed to get media URL: ${metaResp.status}`); return null; }
    const { url: mediaUrl } = await metaResp.json();
    if (!mediaUrl) { console.error(`${LOG} No url in media response`); return null; }

    const downloadResp = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!downloadResp.ok) { console.error(`${LOG} Failed to download media: ${downloadResp.status}`); return null; }

    const blob = new Blob([new Uint8Array(await downloadResp.arrayBuffer())], { type: mimetype });
    const ext = filename ? filename.split('.').pop()?.toLowerCase() || 'bin' : mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const storagePath = `${tenantId}/${instanceId}/${conversationId}/${Date.now()}-${mediaId}.${ext}`;

    const { error } = await supabase.storage.from('whatsapp-media').upload(storagePath, blob, { contentType: mimetype, upsert: false });
    if (error) { console.error(`${LOG} Storage upload error:`, error); return null; }

    console.log(`${LOG} Media uploaded: ${storagePath}`);
    return storagePath;
  } catch (err) {
    console.error(`${LOG} downloadAndUploadMetaMedia error:`, err);
    return null;
  }
}

// ── Process status updates ────────────────────────────────────────────────────
async function processStatus(supabase: any, tenantId: string, status: any): Promise<void> {
  const { id: messageId, status: statusValue } = status;
  if (!messageId || !statusValue) return;
  const statusMap: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
  await supabase.from('whatsapp_messages')
    .update({ status: statusMap[statusValue] || statusValue })
    .eq('tenant_id', tenantId).eq('message_id', messageId);
  console.log(`${LOG} Status updated: ${messageId} -> ${statusValue}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });

  // ── GET: Webhook verification handshake ────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode !== 'subscribe' || !token || !challenge) {
      console.warn(`${LOG} Verification FAILED: missing params`);
      return new Response('Forbidden', { status: 403 });
    }

    const supabaseVerify = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: match } = await supabaseVerify
      .from('whatsapp_instance_secrets').select('instance_id')
      .eq('meta_verify_token', token).limit(1);

    if (match && match.length > 0) {
      console.log(`${LOG} Verification OK instance_id=${match[0].instance_id}`);
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    console.warn(`${LOG} Verification FAILED: no matching verify_token`);
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Ler raw body para validação de assinatura ANTES de parsear
  const rawBody = await req.text();
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return new Response('Bad Request', { status: 400 }); }

  if (body.object !== 'whatsapp_business_account') {
    return new Response('OK', { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) { console.warn(`${LOG} Missing phone_number_id`); continue; }

      // Resolver instância
      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('id, tenant_id, instance_name, provider_type, instance_id_external, meta_phone_number_id, skip_ura')
        .eq('meta_phone_number_id', phoneNumberId).eq('provider_type', 'meta_cloud').maybeSingle();

      if (!instance?.tenant_id) { console.warn(`${LOG} No instance for phone_number_id=${phoneNumberId}`); continue; }

      // Buscar secrets via Vault RPC
      const instanceSecrets = await getInstanceSecrets(supabase, instance.id);

      const accessToken = instanceSecrets.meta_access_token || null;
      const appSecret = instanceSecrets.meta_app_secret || null;

      // ── Validar assinatura X-Hub-Signature-256 ─────────────────────────────
      if (appSecret) {
        const signatureHeader = req.headers.get('X-Hub-Signature-256');
        const isValid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
        if (!isValid) {
          console.warn(`${LOG} Invalid signature for instance_id=${instance.id}`);
          return new Response('Unauthorized', { status: 401 });
        }
        console.log(`${LOG} Signature verified OK for instance_id=${instance.id}`);
      } else {
        console.warn(`${LOG} No app_secret configured — skipping signature validation for instance_id=${instance.id}`);
      }

      if (!accessToken) console.warn(`${LOG} No meta_access_token for instance_id=${instance.id}`);

      // Mapa de nomes de contatos
      const contactNameMap: Record<string, string> = {};
      for (const c of value.contacts || []) {
        if (c.wa_id && c.profile?.name) contactNameMap[c.wa_id] = c.profile.name;
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

      const msgSecrets: InstanceSecrets = { meta_access_token: accessToken };

      // ── Processar mensagens ───────────────────────────────────────────────
      for (const msg of value.messages || []) {
        if (msg.type === 'reaction') { console.log(`${LOG} Reaction ignorada`); continue; }

        const normalizedPhone = normalizePhone(msg.from);
        const ts = msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString() : new Date().toISOString();
        const { mediaId, mimetype, filename } = extractMediaMeta(msg);

        const normalized: NormalizedInboundMessage = {
          instanceId: instance.id,
          tenantId: instance.tenant_id,
          providerType: 'meta_cloud',
          instanceInfo,
          secrets: msgSecrets,
          messageId: msg.id,
          remoteJid: `${normalizedPhone}@s.whatsapp.net`,
          fromMe: false,
          pushName: contactNameMap[msg.from] || msg.from,
          content: extractContent(msg),
          messageType: mapMessageType(msg),
          timestamp: ts,
          mediaUrl: null,
          mediaMimetype: mimetype,
          mediaFilename: filename,
          mediaStoragePath: null,
          rawPayload: msg,
        };

        console.log(`${LOG} Delegando para processInboundMessage: ${normalizedPhone}`);
        await processInboundMessage(supabase, normalized);

        // Download de mídia após salvar a mensagem
        if (mediaId && accessToken && mimetype) {
          const { data: savedMsg } = await supabase
            .from('whatsapp_messages').select('id, conversation_id')
            .eq('message_id', msg.id).eq('tenant_id', instance.tenant_id).maybeSingle();

          if (savedMsg) {
            const storagePath = await downloadAndUploadMetaMedia(
              supabase, accessToken, mediaId, mimetype,
              instance.tenant_id, instance.id, savedMsg.conversation_id, filename,
            );
            if (storagePath) {
              await supabase.from('whatsapp_messages')
                .update({ media_path: storagePath, media_url: storagePath })
                .eq('id', savedMsg.id);
            }
          }
        }
      }

      // ── Processar status ──────────────────────────────────────────────────
      for (const status of value.statuses || []) {
        await processStatus(supabase, instance.tenant_id, status);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
