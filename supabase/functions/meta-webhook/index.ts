import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets, UNSUPPORTED_MESSAGE_LABEL } from '../_shared/message-types.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { applyDeliveryStatus } from '../_shared/apply-delivery-status.ts';
import { normalizeBRPhone } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[meta-webhook]';

// === Validacao de assinatura X-Hub-Signature-256 ===
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace('sha256=', '');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === expected;
}

// === Phone normalization ===
function normalizePhone(raw: string): string {
  return normalizeBRPhone(raw).phone;
}

// === Map Meta message type ===
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

// === Extract text content ===
// IMPORTANTE: emojis abaixo usam escape Unicode (\u{XXXX}) propositalmente.
// Edicao previa deste arquivo introduziu double-encoding UTF-8 nos emojis literais,
// causando que mensagens de midia inbound sem caption chegassem corrompidas ao banco.
// Manter escapes Unicode protege contra re-corrupcao se o arquivo for editado novamente.
//
// INVARIANTE: nunca retornar string vazia. O MessageBubble so renderiza o texto quando
// `content` e truthy — conteudo vazio vira bolha em branco no chat: numero do cliente,
// hora, e mais nada. Foi o que aconteceu na instancia digi_meta-9933 em 20/08/2026,
// porque todo tipo fora da lista caia no `return '';` do final. A evolution-webhook ja
// resolve isso ha tempos com UNSUPPORTED_MESSAGE_LABEL.
function extractContent(msg: any): string {
  if (!msg) return UNSUPPORTED_MESSAGE_LABEL;
  const t = msg.type;
  if (t === 'text') return msg.text?.body || UNSUPPORTED_MESSAGE_LABEL;
  if (t === 'image') return msg.image?.caption || '\u{1F4F7} Imagem';
  if (t === 'video') return msg.video?.caption || '\u{1F3A5} V\u{ED}deo';
  if (t === 'audio') return '\u{1F3B5} \u{C1}udio';
  if (t === 'document') return msg.document?.caption || `\u{1F4CE} ${msg.document?.filename || 'Documento'}`;
  if (t === 'sticker') return '\u{1F3A8} Sticker';
  if (t === 'contacts') { const c = msg.contacts?.length || 0; return `\u{1F464} ${c} contato${c !== 1 ? 's' : ''}`; }
  if (t === 'location') return `\u{1F4CD} Localiza\u{E7}\u{E3}o: ${msg.location?.latitude},${msg.location?.longitude}`;
  if (t === 'reaction') return msg.reaction?.emoji || UNSUPPORTED_MESSAGE_LABEL;
  // Resposta interativa: o texto E a escolha do cliente, nao um rotulo.
  if (t === 'interactive') {
    const i = msg.interactive || {};
    return i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.body
      || i.button_reply?.id || i.list_reply?.id || '\u{1F4AC} Resposta';
  }
  if (t === 'button') return msg.button?.text || msg.button?.payload || '\u{1F518} Resposta de bot\u{E3}o';
  if (t === 'order') { const n = msg.order?.product_items?.length || 0; return `\u{1F6D2} Pedido com ${n} ${n === 1 ? 'item' : 'itens'}`; }
  if (t === 'system') return msg.system?.body || '\u{2699}\u{FE0F} Evento do WhatsApp';
  // `unsupported`, `request_welcome` e qualquer tipo novo da Meta caem aqui: o rotulo
  // aparece no chat e o tipo real vai para metadata logo apos o insert (ver processMessage).
  return UNSUPPORTED_MESSAGE_LABEL;
}

// === Extract media metadata ===
function extractMediaMeta(msg: any): { mediaId: string | null; mimetype: string | null; filename: string | null } {
  if (!msg) return { mediaId: null, mimetype: null, filename: null };
  const t = msg.type;
  if (!['image', 'video', 'audio', 'document', 'sticker'].includes(t)) return { mediaId: null, mimetype: null, filename: null };
  const media = msg[t];
  if (!media) return { mediaId: null, mimetype: null, filename: null };
  return { mediaId: media.id || null, mimetype: media.mime_type || null, filename: media.filename || null };
}

// === Download media from Meta Graph API para Supabase Storage ===
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

// === Process status updates ===
async function processStatus(supabase: any, tenantId: string, status: any): Promise<void> {
  const { id: messageId, status: statusValue } = status;
  if (!messageId || !statusValue) return;
  // Quem decide o status é a escada — o `failed` da Meta entra como `error` e só o
  // verificador promove a `failed`, depois de confirmar. Ver _shared/delivery-status.ts.
  const r = await applyDeliveryStatus(supabase, {
    tenantId, messageId, providerStatus: String(statusValue),
  });

  // A Meta é a ÚNICA que diz o motivo da falha. Continua sendo gravado, agora só em
  // metadata — nunca mais junto com o status.
  if (String(statusValue) === 'failed' && Array.isArray(status.errors) && status.errors.length > 0) {
    const e = status.errors[0];
    const sendError = {
      code: e?.code ?? null,
      title: e?.title ?? null,
      message: e?.message ?? null,
      details: e?.error_data?.details ?? null,
      href: e?.href ?? null,
      at: new Date().toISOString(),
    };
    const { data: existing } = await supabase
      .from('whatsapp_messages')
      .select('metadata')
      .eq('tenant_id', tenantId).eq('message_id', messageId)
      .maybeSingle();
    await supabase.from('whatsapp_messages')
      .update({ metadata: { ...(existing?.metadata || {}), send_error: sendError } })
      .eq('tenant_id', tenantId).eq('message_id', messageId);
    console.error(`${LOG} Send FAILED ${messageId}: code=${sendError.code} title=${sendError.title} details=${sendError.details}`);
  }

  if (r.confirmedFailureCandidate) {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-failed-deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ tenantId, messageId }),
    }).catch((e) => console.error(`${LOG} verify dispatch falhou:`, e?.message));
  }

  console.log(`${LOG} Status updated: ${messageId} -> ${statusValue}`);
}

// === Main handler ===
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });

  // === GET: Webhook verification handshake ===
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
    // Buscar instancia pelo meta_verify_token: itera instancias meta_cloud e compara via Vault
    const { data: metaInstances } = await supabaseVerify
      .from('whatsapp_instances')
      .select('id')
      .eq('provider_type', 'meta_cloud');

    let verifyInstanceId: string | null = null;
    console.log(`${LOG} token received: "${token}", instances found: ${(metaInstances||[]).length}`);
    for (const inst of (metaInstances || [])) {
      const { data: secretData, error: secretErr } = await supabaseVerify
        .rpc('get_instance_secrets', { p_instance_id: inst.id });
      console.log(`${LOG} inst=${inst.id} secretData keys=${Object.keys(secretData||{}).join(',')} verify_token="${secretData?.meta_verify_token}" match=${secretData?.meta_verify_token === token}`);
      if (secretData?.meta_verify_token === token) {
        verifyInstanceId = inst.id;
        break;
      }
    }

    if (verifyInstanceId) {
      console.log(`${LOG} Verification OK instance_id=${verifyInstanceId}`);
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    console.warn(`${LOG} Verification FAILED: no matching verify_token`);
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Ler raw body para validacao de assinatura ANTES de parsear
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

      // Resolver instancia
      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('id, tenant_id, instance_name, provider_type, instance_id_external, meta_phone_number_id, skip_ura')
        .eq('meta_phone_number_id', phoneNumberId).eq('provider_type', 'meta_cloud').maybeSingle();

      if (!instance?.tenant_id) { console.warn(`${LOG} No instance for phone_number_id=${phoneNumberId}`); continue; }

      // Buscar secrets via Vault RPC
      const instanceSecrets = await getInstanceSecrets(supabase, instance.id);

      const accessToken = (instanceSecrets as any).meta_access_token || null;
      const appSecret = (instanceSecrets as any).meta_app_secret || null;

      // === Validar assinatura X-Hub-Signature-256 ===
      if (appSecret) {
        const signatureHeader = req.headers.get('X-Hub-Signature-256');
        const isValid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
        if (!isValid) {
          console.warn(`${LOG} Invalid signature for instance_id=${instance.id}`);
          return new Response('Unauthorized', { status: 401 });
        }
        console.log(`${LOG} Signature verified OK for instance_id=${instance.id}`);
      } else {
        console.warn(`${LOG} No app_secret configured - skipping signature validation for instance_id=${instance.id}`);
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

      // === Processar mensagens ===
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

        // Tipo que a gente nao sabe ler: o payload bruto da Meta nao e persistido em lugar
        // nenhum (o bloco de observability do message-processor le `rawPayload.message`, que
        // so existe no formato Baileys do Evolution). Sem isto nao ha como saber depois do
        // fato o que o cliente mandou — nem pelo banco, nem pelo log.
        if (normalized.content === UNSUPPORTED_MESSAGE_LABEL) {
          console.warn(`${LOG} Tipo nao suportado: type=${msg.type} keys=${Object.keys(msg).join(',')}`);
          const { data: row } = await supabase
            .from('whatsapp_messages').select('id, metadata')
            .eq('message_id', msg.id).eq('tenant_id', instance.tenant_id).maybeSingle();
          if (row) {
            const base = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
            await supabase.from('whatsapp_messages').update({
              metadata: {
                ...base,
                unsupportedType: msg.type ?? null,
                unsupportedKeys: Object.keys(msg),
                ...(Array.isArray(msg.errors) && msg.errors.length > 0 ? { unsupportedErrors: msg.errors } : {}),
              },
            }).eq('id', row.id);
          }
        }

        // Download de midia apos salvar a mensagem
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

      // === Processar status ===
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
