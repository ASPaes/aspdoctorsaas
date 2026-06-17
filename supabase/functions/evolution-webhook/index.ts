import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { processInboundMessage } from '../_shared/message-processor.ts';
import { NormalizedInboundMessage, InstanceInfo, InstanceSecrets } from '../_shared/message-types.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { normalizeBRPhone, phoneSearchVariants } from '../_shared/phone.ts';

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
  // PATCH: handle documentWithCaptionMessage wrapper (Evolution API v2)
  if (message.documentWithCaptionMessage?.message?.documentMessage) return 'document';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.contactMessage) return 'contact';
  if (message.contactsArrayMessage) return 'contacts';
  return 'text';
}

function resolveDocumentMessage(message: any): any {
  return message.documentMessage
    || message.documentWithCaptionMessage?.message?.documentMessage
    || null;
}

function isRevokeMessage(message: any): boolean {
  return !!(message?.protocolMessage &&
    (message.protocolMessage.type === 0 || message.protocolMessage.type === 'REVOKE'));
}

function isEditedMessage(message: any): boolean {
  if (!message) return false;
  if (
    message.editedMessage ||
    message.protocolMessage?.editedMessage ||
    message.editedMessage?.message?.protocolMessage?.editedMessage ||
    (message.protocolMessage && (
      message.protocolMessage.type === 14 ||
      message.protocolMessage.type === 'MESSAGE_EDIT'
    ))
  ) return true;
  // Fallback permissivo: procurar "editedMessage" em qualquer profundidade do objeto
  try {
    const s = JSON.stringify(message);
    if (s.includes('"editedMessage"') || s.includes('"MESSAGE_EDIT"')) return true;
  } catch { /* ignore */ }
  return false;
}

// Extrai { messageId, newContent } de qualquer formato conhecido de edicao do Evolution
function extractEditPayload(data: any): { editedId: string; newContent: string } | null {
  if (!data) return null;
  const message = data.message;
  // Caminhos possíveis para o protocolMessage que contem a edicao
  const candidates = [
    message?.protocolMessage,
    message?.editedMessage?.message?.protocolMessage,
    message?.editedMessage?.protocolMessage,
  ].filter(Boolean);

  for (const pm of candidates) {
    const editedId = pm?.key?.id || data?.key?.id;
    const edited = pm?.editedMessage;
    const newContent =
      edited?.conversation ||
      edited?.extendedTextMessage?.text ||
      edited?.message?.conversation ||
      edited?.message?.extendedTextMessage?.text;
    if (editedId && newContent) return { editedId, newContent };
  }

  // Fallback: data.message.editedMessage direto (sem protocolMessage)
  const direct = message?.editedMessage;
  if (direct) {
    const editedId = direct?.key?.id || data?.key?.id;
    const newContent =
      direct?.message?.conversation ||
      direct?.message?.extendedTextMessage?.text ||
      direct?.conversation ||
      direct?.extendedTextMessage?.text;
    if (editedId && newContent) return { editedId, newContent };
  }

  // Fallback recursivo: vasculha o objeto inteiro procurando um nó com editedMessage
  try {
    const stack: any[] = [data];
    const seen = new Set<any>();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (node.editedMessage) {
        const edited = node.editedMessage;
        const newContent =
          edited?.conversation ||
          edited?.extendedTextMessage?.text ||
          edited?.message?.conversation ||
          edited?.message?.extendedTextMessage?.text;
        const editedId =
          node?.key?.id ||
          edited?.key?.id ||
          edited?.message?.key?.id ||
          data?.key?.id ||
          data?.message?.key?.id;
        if (editedId && newContent) return { editedId, newContent };
      }
      for (const k of Object.keys(node)) stack.push(node[k]);
    }
  } catch { /* ignore */ }
  return null;
}

function getPayloadIsFromMe(data: any): boolean {
  return Boolean(
    data?.key?.fromMe ?? data?.key?.from_me ?? data?.fromMe ??
    data?.message?.key?.fromMe ?? data?.message?.key?.from_me ?? false
  );
}

function normalizePhoneNumber(remoteJid: string): { phone: string; isGroup: boolean } {
  const { phone, isGroup } = normalizeBRPhone(remoteJid);
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
  // PATCH: handle documentWithCaptionMessage caption
  if (type === 'document') {
    const docMsg = resolveDocumentMessage(message);
    if (docMsg?.caption) return docMsg.caption;
  }
  const mediaMessage = message[`${type}Message`];
  if (mediaMessage?.caption) return mediaMessage.caption;
  if (type === 'reaction') {
    return message.reactionMessage?.text || '';
  }
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
    const extracted = extractEditPayload(payload.data);
    if (!extracted) { console.warn(`${LOG} Edit: nao consegui extrair id/conteudo`); return; }
    const { editedId, newContent } = extracted;

    const resolved = await resolveInstanceTenant(supabase, payload.instance);
    if (!resolved) return;

    // Buscar mensagem original para salvar historico
    const { data: originalRow } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, content')
      .eq('tenant_id', resolved.tenantId)
      .eq('message_id', editedId)
      .maybeSingle();

    if (!originalRow) { console.warn(`${LOG} Edit: mensagem ${editedId} nao encontrada`); return; }

    const nowIso = new Date().toISOString();
    await supabase.from('whatsapp_message_edit_history').insert({
      tenant_id: resolved.tenantId,
      conversation_id: originalRow.conversation_id,
      message_id: editedId,
      previous_content: originalRow.content,
      edited_at: nowIso,
    });

    const { data: updated, error } = await supabase.from('whatsapp_messages').update({
      content: newContent,
      original_content: originalRow.content,
      edited_at: nowIso,
    }).eq('id', originalRow.id)
      .select('id, conversation_id, content, timestamp, is_from_me');

    if (error) { console.error(`${LOG} Edit update error:`, error); return; }
    if (!updated?.length) { console.warn(`${LOG} Edit: update vazio para ${editedId}`); return; }

    // Atualizar preview da conversa se a mensagem editada for a ultima
    const row = updated[0];
    const { data: lastMsg } = await supabase.from('whatsapp_messages')
      .select('id, content, timestamp, is_from_me')
      .eq('conversation_id', row.conversation_id)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false })
      .limit(1).maybeSingle();
    if (lastMsg?.id === row.id) {
      await supabase.from('whatsapp_conversations').update({
        last_message_preview: (newContent || '').substring(0, 200),
        last_message_at: row.timestamp,
        is_last_message_from_me: row.is_from_me,
      }).eq('id', row.conversation_id);
    }
    console.log(`${LOG} Edit aplicado: msg ${editedId} -> "${newContent.substring(0, 60)}"`);
  } catch (err) { console.error(`${LOG} Error in processMessageEdit:`, err); }
}

// ── Decifragem de secretEncryptedMessage (edições E2E novas do WhatsApp) ─────

function toU8(input: any): Uint8Array | null {
  if (!input) return null;
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) return new Uint8Array(input);
  if (typeof input === 'object') {
    const arr = Object.keys(input).sort((a, b) => Number(a) - Number(b)).map((k) => (input as any)[k]);
    if (arr.every((v) => typeof v === 'number')) return new Uint8Array(arr);
  }
  if (typeof input === 'string') {
    try { const bin = atob(input); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch { return null; }
  }
  return null;
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function concatU8(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total); let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function hkdfSha256(ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(0), tagLength: 128 },
    cryptoKey,
    ciphertext,
  );
  return new Uint8Array(pt);
}

// Parser protobuf mínimo (wire format) — extrai todos os campos length-delimited
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0; let shift = 0; let p = pos;
  while (p < buf.length) {
    const b = buf[p++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result >>> 0, p];
    shift += 7;
    if (shift > 35) break;
  }
  return [result >>> 0, p];
}

function parseProtobuf(buf: Uint8Array): Record<number, Uint8Array[]> {
  const out: Record<number, Uint8Array[]> = {};
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos); pos = p1;
    const fieldNum = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) { const [, p] = readVarint(buf, pos); pos = p; }
    else if (wire === 2) {
      const [len, p] = readVarint(buf, pos); pos = p;
      const data = buf.subarray(pos, pos + len); pos += len;
      (out[fieldNum] ||= []).push(data);
    }
    else if (wire === 1) { pos += 8; }
    else if (wire === 5) { pos += 4; }
    else break;
  }
  return out;
}

// Tenta extrair o texto editado de um proto.Message decifrado.
// Estruturas possíveis (campos do proto Message do WhatsApp):
//   field 1  = conversation (string)
//   field 14 = extendedTextMessage { field 1 = text }
//   field 12 = protocolMessage { field 14 = editedMessage (Message) }
function extractEditedTextFromMessage(buf: Uint8Array): string | null {
  const td = new TextDecoder('utf-8', { fatal: false });
  const root = parseProtobuf(buf);

  // 1) conversation direto
  if (root[1]?.[0]) {
    const s = td.decode(root[1][0]);
    if (s) return s;
  }
  // 2) extendedTextMessage.text
  if (root[14]?.[0]) {
    const ext = parseProtobuf(root[14][0]);
    if (ext[1]?.[0]) { const s = td.decode(ext[1][0]); if (s) return s; }
  }
  // 3) protocolMessage.editedMessage (recursivo)
  if (root[12]?.[0]) {
    const proto = parseProtobuf(root[12][0]);
    if (proto[14]?.[0]) {
      const inner = extractEditedTextFromMessage(proto[14][0]);
      if (inner) return inner;
    }
  }
  return null;
}

// Detecta secretEncryptedMessage com edição
function getSecretEncryptedEdit(message: any): { encPayload: Uint8Array; encIv: Uint8Array; targetId: string; targetRemoteJid: string } | null {
  const sec = message?.secretEncryptedMessage;
  if (!sec) return null;
  const secType = sec.secretEncType;
  // 2 = MESSAGE_EDIT (também aceitamos sem checar para cobrir variações)
  if (secType !== undefined && secType !== 2 && secType !== 'MESSAGE_EDIT') {
    // ainda assim tenta — pode ser EVENT_EDIT também aplicável
  }
  const encPayload = toU8(sec.encPayload);
  const encIv = toU8(sec.encIv);
  const targetId = sec.targetMessageKey?.id;
  const targetRemoteJid = sec.targetMessageKey?.remoteJid;
  if (!encPayload || !encIv || !targetId) return null;
  return { encPayload, encIv, targetId, targetRemoteJid };
}

async function fetchLidCandidatesForPhone(supabase: any, instanceId: string, fallbackInstance: string, phone: string): Promise<string[]> {
  if (!phone) return [];
  try {
    const { data: instanceRow } = await supabase.from('whatsapp_instances')
      .select('instance_name, provider_type, instance_id_external')
      .eq('id', instanceId)
      .maybeSingle();
    const secrets = await getInstanceSecrets(supabase, instanceId);
    const base = (secrets?.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
    const instanceName = instanceRow?.provider_type === 'cloud' && instanceRow?.instance_id_external
      ? instanceRow.instance_id_external
      : (instanceRow?.instance_name || fallbackInstance);
    if (!base || !instanceName || !secrets?.api_key) return [];

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (instanceRow?.provider_type === 'cloud') headers.Authorization = `Bearer ${secrets.api_key}`;
    else headers.apikey = secrets.api_key;

    const response = await fetch(`${base}/chat/fetchLid/${instanceName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: phone }),
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null);
    const found: string[] = [];
    const collect = (value: any) => {
      if (!value) return;
      if (typeof value === 'string') {
        if (value.includes('@lid')) found.push(value);
        else if (/^\d{8,}$/.test(value)) found.push(`${value}@lid`);
      } else if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(body?.lid ?? body?.data?.lid ?? body);
    return found.filter((v, i, a) => v && a.indexOf(v) === i);
  } catch (err) {
    console.warn(`${LOG} SecretEdit: não consegui buscar LID para ${phone}: ${String(err).substring(0, 160)}`);
    return [];
  }
}

function extractPlainTextFromAnyPayload(input: any): string | null {
  const seen = new Set<any>();
  const stack = [input];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const text = node?.conversation
      || node?.extendedTextMessage?.text
      || node?.editedMessage?.conversation
      || node?.editedMessage?.extendedTextMessage?.text
      || node?.message?.conversation
      || node?.message?.extendedTextMessage?.text
      || node?.message?.editedMessage?.conversation
      || node?.message?.editedMessage?.extendedTextMessage?.text;
    if (typeof text === 'string' && text.trim()) return text;
    for (const value of Object.values(node)) stack.push(value);
  }
  return null;
}

async function fetchEditedTextFromEvolution(supabase: any, instanceId: string, fallbackInstance: string, messageId: string, remoteJid: string): Promise<string | null> {
  try {
    const { data: instanceRow } = await supabase.from('whatsapp_instances')
      .select('instance_name, provider_type, instance_id_external')
      .eq('id', instanceId)
      .maybeSingle();
    const secrets = await getInstanceSecrets(supabase, instanceId);
    const base = (secrets?.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
    const instanceName = instanceRow?.provider_type === 'cloud' && instanceRow?.instance_id_external
      ? instanceRow.instance_id_external
      : (instanceRow?.instance_name || fallbackInstance);
    if (!base || !instanceName || !secrets?.api_key) return null;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (instanceRow?.provider_type === 'cloud') headers.Authorization = `Bearer ${secrets.api_key}`;
    else headers.apikey = secrets.api_key;

    const bodies = [
      { where: { key: { id: messageId } }, take: 1 },
      { where: { key: { id: messageId, remoteJid } }, take: 1 },
    ];
    for (const body of bodies) {
      const response = await fetch(`${base}/chat/findMessages/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => null);
      const rows = Array.isArray(payload) ? payload
        : Array.isArray(payload?.messages) ? payload.messages
          : Array.isArray(payload?.data) ? payload.data
            : Array.isArray(payload?.data?.messages) ? payload.data.messages
              : payload ? [payload] : [];
      for (const row of rows) {
        const rowId = row?.key?.id || row?.messageId || row?.id;
        if (rowId && rowId !== messageId) continue;
        const text = extractPlainTextFromAnyPayload(row);
        if (text) return text;
      }
    }
  } catch (err) {
    console.warn(`${LOG} SecretEdit: fallback Evolution falhou para ${messageId}: ${String(err).substring(0, 160)}`);
  }
  return null;
}

async function markEditedWithoutContent(
  supabase: any,
  messageDbId: string,
  messageId: string,
  conversationId: string,
  tenantId: string,
  previousContent: string,
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await supabase.from('whatsapp_message_edit_history').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_id: messageId,
      previous_content: previousContent,
      edited_at: nowIso,
    });
    await supabase.from('whatsapp_messages').update({
      edited_at: nowIso,
    }).eq('id', messageDbId);
  } catch (err) {
    console.error(`${LOG} markEditedWithoutContent error:`, err);
  }
}

async function processSecretEncryptedEdit(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  try {
    const data = payload.data;
    const message = data?.message;
    const env = getSecretEncryptedEdit(message);
    if (!env) return;

    const resolved = await resolveInstanceTenant(supabase, payload.instance);
    if (!resolved) { console.warn(`${LOG} SecretEdit: instance ${payload.instance} not found`); return; }

    // 1) Buscar mensagem original (precisa do messageSecret salvo no metadata)
    const { data: originalRow } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, content, metadata, remote_jid')
      .eq('tenant_id', resolved.tenantId)
      .eq('message_id', env.targetId)
      .maybeSingle();

    if (!originalRow) { console.warn(`${LOG} SecretEdit: original ${env.targetId} não encontrada`); return; }

    const meta = typeof originalRow.metadata === 'string' ? JSON.parse(originalRow.metadata) : (originalRow.metadata || {});
    const secretB64: string | undefined = meta?.messageSecret;
    if (!secretB64) {
      console.warn(`${LOG} SecretEdit: messageSecret ausente para ${env.targetId} — não dá pra decifrar`);
      return;
    }
    const secret = b64ToU8(secretB64);

    // 2) Construir lista de candidatos de JIDs para tentar decifrar
    //    O WhatsApp pode usar PN (@s.whatsapp.net), LID (@lid), ou número puro
    //    dependendo do addressingMode da conversa. Tentamos várias combinações.
    const enc = new TextEncoder();
    const stripDevice = (j: string) => j.replace(/:\d+(?=@|$)/, '');
    const phoneOnly = (j: string) => j.replace(/[@:].*/, '');

    const targetJid = env.targetRemoteJid || ''; // ex.: 267542740381868@lid (nosso LID, perspectiva do cliente)
    const clientPN = stripDevice(data?.key?.remoteJid || originalRow.remote_jid || ''); // 553196366034@s.whatsapp.net
    const clientNumber = phoneOnly(clientPN); // 553196366034
    const lidFromEvolution = await fetchLidCandidatesForPhone(supabase, resolved.instanceId, payload.instance, clientNumber);

    // Candidatos para o "originalSender" (quem ENVIOU a mensagem original)
    // targetMessageKey.fromMe=true significa "fui eu (cliente) que enviei" → cliente
    // targetMessageKey.fromMe=false significa "foi o outro lado" → o bot (nós)
    const originalIsClient = env.targetRemoteJid?.endsWith('@s.whatsapp.net') ? true : true; // cliente editou a própria msg
    const senderCandidates = [
      ...lidFromEvolution,
      clientPN,
      clientNumber,
      stripDevice(targetJid),
      targetJid,
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    // Para o "editor" também tentamos as mesmas variantes (é o mesmo cliente em 1-to-1)
    const editorCandidates = senderCandidates;

    const useCaseCandidates = ['Event Edit', 'Message Edit'];
    let plaintext: Uint8Array | null = null;
    let usedSender = ''; let usedEditor = ''; let usedUseCase = '';

    outer:
    for (const useCase of useCaseCandidates) {
      for (const sender of senderCandidates) {
        for (const editor of editorCandidates) {
          const info = concatU8(
            enc.encode(env.targetId),
            enc.encode(sender),
            enc.encode(editor),
            enc.encode(useCase),
          );
          try {
            const aesKey = await hkdfSha256(secret, info, 32);
            plaintext = await aesGcmDecrypt(aesKey, env.encIv, env.encPayload);
            usedSender = sender; usedEditor = editor; usedUseCase = useCase;
            break outer;
          } catch { /* tenta próxima combinação */ }
        }
      }
    }

    let newContent: string | null = null;
    if (!plaintext) {
      console.error(`${LOG} SecretEdit: AES-GCM falhou em todas as combinações para ${env.targetId}. useCases=${JSON.stringify(useCaseCandidates)}, JIDs=${JSON.stringify(senderCandidates)}, targetJid=${targetJid}, addressingMode=${data?.key?.addressingMode}`);
      newContent = await fetchEditedTextFromEvolution(supabase, resolved.instanceId, payload.instance, env.targetId, originalRow.remote_jid);
      if (!newContent || newContent === originalRow.content) return;
      console.log(`${LOG} SecretEdit aplicado via fallback Evolution: ${env.targetId} -> "${newContent.substring(0, 80)}"`);
    } else {
      // 6) Extrair texto do proto.Message decifrado
      newContent = extractEditedTextFromMessage(plaintext);
      if (!newContent) {
        console.warn(`${LOG} SecretEdit: decifrou (useCase=${usedUseCase}, sender=${usedSender}, editor=${usedEditor}) mas não achou texto editado em ${env.targetId}. Plaintext hex: ${Array.from(plaintext).map(b => b.toString(16).padStart(2, '0')).join('')}`);
        return;
      }
      console.log(`${LOG} SecretEdit decifrado (useCase=${usedUseCase}, sender=${usedSender}): ${env.targetId} -> "${newContent.substring(0, 80)}"`);
    }


    // 7) Aplicar edição via mesmo fluxo do processMessageEdit
    const nowIso = new Date().toISOString();
    await supabase.from('whatsapp_message_edit_history').insert({
      tenant_id: resolved.tenantId,
      conversation_id: originalRow.conversation_id,
      message_id: env.targetId,
      previous_content: originalRow.content,
      edited_at: nowIso,
    });

    const { data: updated, error } = await supabase.from('whatsapp_messages').update({
      content: newContent,
      original_content: originalRow.content,
      edited_at: nowIso,
    }).eq('id', originalRow.id)
      .select('id, conversation_id, content, timestamp, is_from_me');

    if (error) { console.error(`${LOG} SecretEdit update error:`, error); return; }
    if (!updated?.length) return;

    const row = updated[0];
    const { data: lastMsg } = await supabase.from('whatsapp_messages')
      .select('id, content, timestamp, is_from_me')
      .eq('conversation_id', row.conversation_id)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false })
      .limit(1).maybeSingle();
    if (lastMsg?.id === row.id) {
      await supabase.from('whatsapp_conversations').update({
        last_message_preview: (newContent || '').substring(0, 200),
        last_message_at: row.timestamp,
        is_last_message_from_me: row.is_from_me,
      }).eq('id', row.conversation_id);
    }
  } catch (err) {
    console.error(`${LOG} Error in processSecretEncryptedEdit:`, err);
  }
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
      console.log(`[processMessageUpdate] raw update: ${JSON.stringify(update).substring(0, 300)}`);
      if (!messageId || !statusRaw) {
        console.log(`[processMessageUpdate] SKIP — messageId=${messageId} statusRaw=${statusRaw}`);
        continue;
      }
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
    const secrets = await getInstanceSecrets(supabase, resolved.instanceId);
    if (!secrets) return;
    if (!secrets) return;

    // ── Find or create contact — com variantes de número e vínculo ao cliente ──
    // Montar variantes (com/sem 9 dígito)
    const phoneVariants: string[] = phoneSearchVariants(phone);

    // Buscar cliente pelo telefone (qualquer variante)
    const { data: clienteRow } = await supabase.from('clientes')
      .select('id, nome_fantasia, razao_social')
      .eq('tenant_id', resolved.tenantId)
      .eq('cancelado', false)
      .or(phoneVariants.map((v: string) => `telefone_whatsapp.eq.${v},telefone_whatsapp_contato.eq.${v}`).join(','))
      .limit(1).maybeSingle();

    const clienteName = clienteRow?.nome_fantasia || clienteRow?.razao_social || null;
    const clienteId = clienteRow?.id || null;

    // Buscar contato existente por qualquer variante
    const { data: contact } = await supabase.from('whatsapp_contacts')
      .select('id, name')
      .eq('tenant_id', resolved.tenantId)
      .in('phone_number', phoneVariants)
      .maybeSingle();

    let contactId = contact?.id;
    if (!contactId) {
      const { data: newContact } = await supabase.from('whatsapp_contacts').insert({
        instance_id: resolved.instanceId, phone_number: phone,
        name: clienteName || phone, is_group: false, tenant_id: resolved.tenantId,
      }).select('id').single();
      contactId = newContact?.id;
    } else if (clienteName && contact?.name === contact?.name?.match(/^55/)?.input) {
      // Atualizar nome se ainda está como número
      supabase.from('whatsapp_contacts').update({ name: clienteName, updated_at: new Date().toISOString() })
        .eq('id', contactId).then(() => {}).catch(() => {});
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
        ...(clienteId ? { cliente_id: clienteId } : {}),
      }).select('id').single();
      conversationId = newConv?.id;
    } else if (clienteId) {
      // Atualizar cliente_id na conversa existente se ainda não vinculado
      supabase.from('whatsapp_conversations').update({ cliente_id: clienteId })
        .eq('id', conversationId).is('cliente_id', null).then(() => {}).catch(() => {});
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
      // Verificar se a conversa tem mensagens do cliente (inbound)
      const { count: inboundCount } = await supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('is_from_me', false);

      const isOutboundOnly = (inboundCount ?? 0) === 0;

      await supabase.from('whatsapp_conversations').update({
        last_message_at: timestamp,
        last_message_preview: content.substring(0, 200) || '📤 Mensagem enviada',
        is_last_message_from_me: true,
        updated_at: new Date().toISOString(),
        // Se só tem mensagens outbound, manter/forçar fechado
        ...(isOutboundOnly ? { status: 'closed' } : {}),
      }).eq('id', conversationId);
    }
  } catch (err) { console.error(`${LOG} Error in processSendMessageEvent:`, err); }
}

// ── processMessageUpsert — delega ao message-processor ───────────────────────

async function processMessageUpsert(payload: EvolutionWebhookPayload, supabase: any): Promise<void> {
  const { instance, data } = payload;
  const { key, pushName, message, messageTimestamp } = data;
  console.log(`${LOG} Processing message: ${key?.id} type=${getMessageType(message)}`);

  try {

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
        (_msgText.startsWith('LIMIT UP') || _msgText === 'STATUS IA' || _msgText.startsWith('SNOOZE') || _msgText === 'SIM DB' || _msgText === 'NÃO DB' || _msgText === 'NAO DB' || _msgText === 'DEPOIS DB');

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

    const secrets = await getInstanceSecrets(supabase, instanceData.id);
    if (!secrets?.api_url) { console.error(`${LOG} No secrets for instance ${instance}`); return; }

    const { phone, isGroup } = normalizePhoneNumber(key.remoteJid);
    const fromMe = getPayloadIsFromMe(data);
    const messageType = getMessageType(message);
    // PATCH: safe timestamp — protect against undefined messageTimestamp
    const safeTimestamp = messageTimestamp && !isNaN(messageTimestamp)
      ? messageTimestamp
      : Math.floor(Date.now() / 1000);
    const timestamp = new Date(safeTimestamp * 1000).toISOString();

    // Filtro de grupos: verificar whitelist em whatsapp_groups
    if (isGroup) {
      const groupJid = key.remoteJid.includes('@') ? key.remoteJid : `${phone}@g.us`;
      const { data: grpCfg } = await supabase
        .from('whatsapp_groups')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('instance_id', instanceData.id)
        .eq('group_jid', groupJid)
        .eq('enabled', true)
        .maybeSingle();
      if (!grpCfg) {
        console.log(`${LOG} Group not whitelisted, ignoring: ${groupJid}`);
        return;
      }
    }

    // Download de mídia antes de delegar
    let mediaStoragePath: string | null = null;
    let mediaMimetype: string | null = null;
    let mediaFilename: string | null = null;

    if (messageType !== 'text' && messageType !== 'reaction' && messageType !== 'revoke') {
      // PATCH: use resolveDocumentMessage for documents, fallback to standard path
      const mediaMessage = messageType === 'document'
        ? resolveDocumentMessage(message)
        : message[`${messageType}Message`];
      if (mediaMessage?.mimetype) {
        mediaMimetype = mediaMessage.mimetype;
        mediaFilename = mediaMessage.fileName || mediaMessage.filename || null;
        mediaStoragePath = await downloadAndUploadMedia(
          secrets.api_url || '', secrets.api_key || '', evolutionInstanceId,
          key, supabase, mediaMimetype as string, instanceData.provider_type || 'self_hosted'
        );
      }
    }

    const content = getMessageContent(message, messageType as string);

    // Override para mensagens de contato (contactMessage / contactsArrayMessage)
    let resolvedMessageType: NormalizedInboundMessage['messageType'] = messageType as any;
    let resolvedContent = content;
    if (message?.contactMessage?.vcard) {
      resolvedMessageType = 'contact';
      resolvedContent = message.contactMessage.displayName || message.contactMessage.vcard.match(/FN[^:]*:(.*)/i)?.[1]?.trim() || '';
    } else if (message?.contactsArrayMessage?.contacts?.length) {
      resolvedMessageType = 'contacts';
      resolvedContent = message.contactsArrayMessage.contacts
        .map((c: any) => c.displayName || '')
        .filter(Boolean)
        .join(', ');
    }
    const quotedMessageId = message.reactionMessage?.key?.id
      || message.extendedTextMessage?.contextInfo?.stanzaId
      || null;

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
      content: resolvedContent,
      messageType: resolvedMessageType,
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

  } catch (processingError) {
    // PATCH: Fallback — salva mensagem placeholder pro agente ver que algo chegou
    console.error(`${LOG} CRITICAL processing error for msg ${key?.id}:`, processingError);
    try {
      const { phone: fbPhone } = normalizePhoneNumber(key?.remoteJid || '');

      let { data: fbInstance } = await supabase.from('whatsapp_instances')
        .select('id, tenant_id').eq('instance_name', instance).maybeSingle();
      if (!fbInstance) {
        const { data: fbCloud } = await supabase.from('whatsapp_instances')
          .select('id, tenant_id').eq('instance_id_external', instance).maybeSingle();
        fbInstance = fbCloud;
      }
      if (!fbInstance) { console.error(`${LOG} FALLBACK: instance not found`); return; }

      const fbVariants = phoneSearchVariants(fbPhone);

      let { data: fbContact } = await supabase.from('whatsapp_contacts')
        .select('id').eq('tenant_id', fbInstance.tenant_id)
        .eq('instance_id', fbInstance.id)
        .in('phone_number', fbVariants).maybeSingle();

      if (!fbContact) {
        const { data: newC } = await supabase.from('whatsapp_contacts').insert({
          instance_id: fbInstance.id, phone_number: fbPhone,
          name: pushName || fbPhone, is_group: false, tenant_id: fbInstance.tenant_id,
        }).select('id').single();
        fbContact = newC;
      }
      if (!fbContact) { console.error(`${LOG} FALLBACK: contact creation failed`); return; }

      let { data: fbConv } = await supabase.from('whatsapp_conversations')
        .select('id').eq('tenant_id', fbInstance.tenant_id)
        .eq('instance_id', fbInstance.id)
        .eq('contact_id', fbContact.id).maybeSingle();

      if (!fbConv) {
        const { data: newConv } = await supabase.from('whatsapp_conversations').insert({
          instance_id: fbInstance.id, contact_id: fbContact.id,
          status: 'active', tenant_id: fbInstance.tenant_id,
        }).select('id').single();
        fbConv = newConv;
      }
      if (!fbConv) { console.error(`${LOG} FALLBACK: conversation creation failed`); return; }

      const fbTimestamp = new Date(
        (messageTimestamp && !isNaN(messageTimestamp) ? messageTimestamp : Math.floor(Date.now() / 1000)) * 1000
      ).toISOString();

      await supabase.from('whatsapp_messages').upsert({
        conversation_id: fbConv.id,
        remote_jid: key?.remoteJid || '',
        message_id: key?.id || `fallback_${Date.now()}`,
        content: '⚠️ Arquivo/mídia recebido mas não foi possível processar. Peça para o cliente reenviar.',
        message_type: 'text',
        is_from_me: false,
        status: 'received',
        timestamp: fbTimestamp,
        tenant_id: fbInstance.tenant_id,
        instance_id: fbInstance.id,
        metadata: { processing_error: true, original_error: String(processingError).substring(0, 500) },
      }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });

      await supabase.from('whatsapp_conversations').update({
        last_message_at: fbTimestamp,
        last_message_preview: '⚠️ Arquivo não processado',
        is_last_message_from_me: false,
        status: 'active',
        updated_at: new Date().toISOString(),
      }).eq('id', fbConv.id);

      console.log(`${LOG} FALLBACK: placeholder saved for msg ${key?.id} in conv ${fbConv.id}`);
    } catch (fallbackError) {
      console.error(`${LOG} FALLBACK ALSO FAILED for msg ${key?.id}:`, fallbackError);
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handleEvolutionEvent(payload: EvolutionWebhookPayload): Promise<void> {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  console.log(`${LOG} Event: ${payload.event} Instance: ${payload.instance}`);

  // Diagnostico amplo: loga payload bruto de upsert/update do remetente alvo (cliente)
  try {
    const raw = JSON.stringify(payload?.data ?? {});
    const isEditCandidate = raw.includes('editedMessage') || raw.includes('MESSAGE_EDIT') || raw.includes('"type":14');
    const isUpsertOrUpdate = payload.event === 'messages.upsert' || payload.event === 'messages.update';
    if (isEditCandidate) {
      console.log(`${LOG} [DIAG-EDIT] event=${payload.event} raw=${raw.slice(0, 6000)}`);
    } else if (isUpsertOrUpdate && raw.includes('553196366034')) {
      console.log(`${LOG} [DIAG-RAW] event=${payload.event} raw=${raw.slice(0, 6000)}`);
    }
  } catch { /* ignore */ }


  switch (payload.event) {
    case 'messages.upsert':
      if (isRevokeMessage(payload.data?.message)) {
        await processMessageRevoke(payload, supabase);
      } else if (getSecretEncryptedEdit(payload.data?.message)) {
        await processSecretEncryptedEdit(payload, supabase);
      } else if (isEditedMessage(payload.data?.message) || extractEditPayload(payload.data)) {
        await processMessageEdit(payload, supabase);
      } else {
        await processMessageUpsert(payload, supabase);
      }
      break;

    case 'messages.update': {
      // Edicoes do WhatsApp chegam frequentemente como messages.update
      const updateData = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      if (isEditedMessage(updateData?.message) || extractEditPayload(updateData)) {
        await processMessageEdit({ ...payload, data: updateData }, supabase);
      } else {
        await processMessageUpdate(payload, supabase);
      }
      break;
    }
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
          if ((delRows?.length ?? 0) > 0) await refreshConversationPreviewAfterRevoke(supabase, delRows![0].conversation_id);
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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Validação síncrona de secret (rápida) — antes de retornar 200
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

  // Parse rápido do body
  let payload: EvolutionWebhookPayload;
  try {
    payload = await req.json();
  } catch (err) {
    console.error(`${LOG} Invalid JSON:`, err);
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Processamento real em background (resposta imediata <50ms)
  // @ts-ignore - EdgeRuntime é fornecido pelo Supabase Edge runtime
  EdgeRuntime.waitUntil(
    handleEvolutionEvent(payload).catch((err) => {
      console.error(`${LOG} Background processing error:`, err);
    })
  );

  return new Response(
    JSON.stringify({ received: true, event: payload.event }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
});
