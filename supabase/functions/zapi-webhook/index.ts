import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[zapi-webhook]';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Responde 200 imediatamente para a Z-API não fazer retry
  const responsePromise = new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  // Processa em background (fire-and-forget)
  processWebhook(req).catch((err) =>
    console.error(`${LOG} Erro no processamento:`, err)
  );

  return responsePromise;
});

async function processWebhook(req: Request): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    console.error(`${LOG} Payload inválido`);
    return;
  }

  console.log(`${LOG} Payload recebido:`, JSON.stringify(payload).substring(0, 300));

  // ── Identificar instância pelo instanceId da Z-API ──────────────
  const zapiInstanceId = payload?.instanceId || payload?.instance?.id || null;
  if (!zapiInstanceId) {
    console.warn(`${LOG} instanceId não encontrado no payload`);
    return;
  }

  // Buscar instância pelo zapi_instance_id nos secrets
  const { data: secretRow } = await supabase
    .from('whatsapp_instance_secrets')
    .select('instance_id, zapi_webhook_token')
    .eq('zapi_instance_id', zapiInstanceId)
    .maybeSingle();

  if (!secretRow) {
    console.warn(`${LOG} Instância não encontrada para zapiInstanceId=${zapiInstanceId}`);
    return;
  }

  // ── Validar webhook token (segurança) ──────────────────────────
  if (secretRow.zapi_webhook_token) {
    const receivedToken =
      req.headers.get('X-Zapitoken') ||
      req.headers.get('x-zapitoken') ||
      payload?.token ||
      null;
    if (receivedToken !== secretRow.zapi_webhook_token) {
      console.warn(`${LOG} Token inválido para instanceId=${zapiInstanceId}`);
      return;
    }
  }

  const instanceId = secretRow.instance_id;

  // Buscar tenant_id da instância
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('tenant_id, instance_name')
    .eq('id', instanceId)
    .maybeSingle();

  if (!instance?.tenant_id) {
    console.warn(`${LOG} tenant_id não encontrado para instanceId=${instanceId}`);
    return;
  }

  const tenantId = instance.tenant_id;
  const type = payload?.type || payload?.event || '';

  console.log(`${LOG} Evento: ${type} | tenant: ${tenantId} | instance: ${instance.instance_name}`);

  // ── Roteamento por tipo de evento ──────────────────────────────
  if (type === 'ReceivedCallback' || type === 'message' || payload?.isMessage) {
    await handleInboundMessage(supabase, payload, instanceId, tenantId);
  } else if (type === 'MessageStatusCallback' || type === 'status') {
    await handleStatusUpdate(supabase, payload, tenantId);
  } else if (type === 'connected' || type === 'disconnected') {
    const newStatus = type === 'connected' ? 'connected' : 'disconnected';
    await supabase
      .from('whatsapp_instances')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', instanceId);
    console.log(`${LOG} Status atualizado: ${newStatus}`);
  } else {
    console.log(`${LOG} Evento ignorado: ${type}`);
  }
}

async function handleInboundMessage(
  supabase: any,
  payload: any,
  instanceId: string,
  tenantId: string
): Promise<void> {
  // Normaliza payload Z-API → formato interno
  const phone = payload?.phone || payload?.from || '';
  const messageId = payload?.messageId || payload?.id || `zapi_${Date.now()}`;
  const content = payload?.text?.message || payload?.body || payload?.message || '';
  const fromMe = payload?.fromMe === true || payload?.isFromMe === true;
  const timestamp = payload?.momment
    ? new Date(payload.momment).toISOString()
    : new Date().toISOString();

  let messageType: string = 'text';
  let mediaUrl: string | null = null;

  if (payload?.image) { messageType = 'image'; mediaUrl = payload.image?.imageUrl || null; }
  else if (payload?.audio) { messageType = 'audio'; mediaUrl = payload.audio?.audioUrl || null; }
  else if (payload?.video) { messageType = 'video'; mediaUrl = payload.video?.videoUrl || null; }
  else if (payload?.document) { messageType = 'document'; mediaUrl = payload.document?.documentUrl || null; }

  if (!phone) {
    console.warn('[zapi-webhook] Telefone ausente no payload');
    return;
  }

  const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');

  // Buscar ou criar contato
  let contactId: string | null = null;
  const { data: existingContact } = await supabase
    .from('whatsapp_contacts')
    .select('id')
    .eq('phone_number', normalizedPhone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id;
  } else {
    const contactName = payload?.senderName || payload?.name || normalizedPhone;
    const { data: newContact } = await supabase
      .from('whatsapp_contacts')
      .insert({ phone_number: normalizedPhone, name: contactName, tenant_id: tenantId })
      .select('id')
      .single();
    contactId = newContact?.id || null;
  }

  if (!contactId) {
    console.error('[zapi-webhook] Falha ao resolver contato');
    return;
  }

  // Buscar ou criar conversa
  const { data: existingConv } = await supabase
    .from('whatsapp_conversations')
    .select('id, status')
    .eq('contact_id', contactId)
    .eq('instance_id', instanceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  let conversationId: string;

  if (existingConv) {
    conversationId = existingConv.id;
    if (!fromMe && existingConv.status === 'closed') {
      await supabase
        .from('whatsapp_conversations')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    }
  } else {
    const { data: newConv } = await supabase
      .from('whatsapp_conversations')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        instance_id: instanceId,
        status: 'active',
        last_message_at: timestamp,
        last_message_preview: content.substring(0, 200),
      })
      .select('id')
      .single();
    conversationId = newConv?.id;
  }

  if (!conversationId) {
    console.error('[zapi-webhook] Falha ao resolver conversa');
    return;
  }

  // Salvar mensagem (upsert para evitar duplicatas)
  const { error: msgError } = await supabase
    .from('whatsapp_messages')
    .upsert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_id: messageId,
      remote_jid: normalizedPhone,
      content,
      message_type: messageType,
      media_url: mediaUrl,
      is_from_me: fromMe,
      status: fromMe ? 'sent' : 'received',
      timestamp,
      instance_id: instanceId,
      metadata: { source: 'zapi', raw_type: payload?.type },
    }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });

  if (msgError) {
    console.error('[zapi-webhook] Erro ao salvar mensagem:', msgError);
    return;
  }

  // Atualizar preview da conversa
  await supabase
    .from('whatsapp_conversations')
    .update({
      last_message_at: timestamp,
      last_message_preview: content.substring(0, 200),
      is_last_message_from_me: fromMe,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  console.log(`[zapi-webhook] Mensagem salva: ${messageId} | conversa: ${conversationId}`);
}

async function handleStatusUpdate(
  supabase: any,
  payload: any,
  tenantId: string
): Promise<void> {
  const messageId = payload?.messageId || payload?.id;
  const status = payload?.status;

  if (!messageId || !status) return;

  const statusMap: Record<string, string> = {
    'sent': 'sent',
    'delivered': 'delivered',
    'read': 'read',
    'failed': 'failed',
    'SENT': 'sent',
    'DELIVERED': 'delivered',
    'READ': 'read',
    'FAILED': 'failed',
  };

  const normalizedStatus = statusMap[status] || status.toLowerCase();

  await supabase
    .from('whatsapp_messages')
    .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
    .eq('message_id', messageId)
    .eq('tenant_id', tenantId);

  console.log(`[zapi-webhook] Status atualizado: ${messageId} → ${normalizedStatus}`);
}
