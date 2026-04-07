import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const LOG = '[zapi-webhook]';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Responde 200 imediatamente — Z-API tem timeout curto
  const response = new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  processWebhook(req.clone()).catch((err) =>
    console.error(`${LOG} Erro no processamento:`, err)
  );

  return response;
});

// Normaliza número BR: adiciona 9 para celulares com 8 dígitos locais
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  // Remove @s.whatsapp.net ou @lid se vier no JID
  digits = digits.split('@')[0];
  // Se não tem DDI, assume Brasil
  if (!digits.startsWith('55') && digits.length <= 11) {
    digits = '55' + digits;
  }
  // BR: 55 + DDD (2) + número
  // Celular BR sem 9: 554XNNNNNNNN (12 dígitos) → adiciona 9
  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const numero = digits.substring(4);
    // Só adiciona 9 se começa com 6,7,8,9 (celular) e tem 8 dígitos
    if (numero.length === 8 && /^[6-9]/.test(numero)) {
      digits = '55' + ddd + '9' + numero;
    }
  }
  return digits;
}

async function processWebhook(req: Request): Promise<void> {
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

  // ── Identificar instância pelo zapi_instance_id ──────────────
  const zapiInstanceId = payload?.instanceId || payload?.instance?.id || null;
  if (!zapiInstanceId) {
    console.warn(`${LOG} instanceId ausente no payload`);
    return;
  }

  const { data: secretRow } = await supabase
    .from('whatsapp_instance_secrets')
    .select('instance_id, zapi_webhook_token')
    .eq('zapi_instance_id', zapiInstanceId)
    .maybeSingle();

  if (!secretRow) {
    console.warn(`${LOG} Instância não encontrada: zapiInstanceId=${zapiInstanceId}`);
    return;
  }

  // ── Validar token de segurança ────────────────────────────────
  if (secretRow.zapi_webhook_token) {
    const receivedToken =
      req.headers.get('X-Zapitoken') ||
      req.headers.get('x-zapitoken') ||
      payload?.token ||
      null;
    if (receivedToken !== secretRow.zapi_webhook_token) {
      console.warn(`${LOG} Token inválido`);
      return;
    }
  }

  const instanceId = secretRow.instance_id;

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('tenant_id, instance_name')
    .eq('id', instanceId)
    .maybeSingle();

  if (!instance?.tenant_id) {
    console.warn(`${LOG} tenant_id não encontrado`);
    return;
  }

  const type = payload?.type || payload?.event || '';
  console.log(`${LOG} Evento: ${type} | instance: ${instance.instance_name}`);

  // ── Atualização de status de conexão ─────────────────────────
  if (type === 'connected' || type === 'disconnected') {
    await supabase
      .from('whatsapp_instances')
      .update({ status: type, updated_at: new Date().toISOString() })
      .eq('id', instanceId);
    console.log(`${LOG} Status atualizado: ${type}`);
    return;
  }

  // ── Atualização de status de mensagem ─────────────────────────
  if (type === 'MessageStatusCallback') {
    const messageId = payload?.messageId || payload?.id;
    const status = payload?.status;
    if (messageId && status) {
      const statusMap: Record<string, string> = {
        SENT: 'sent', DELIVERED: 'delivered', READ: 'read', FAILED: 'failed',
        sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed',
      };
      await supabase
        .from('whatsapp_messages')
        .update({ status: statusMap[status] || status.toLowerCase() })
        .eq('message_id', messageId)
        .eq('tenant_id', instance.tenant_id);
    }
    return;
  }

  // ── Mensagens recebidas (ReceivedCallback) ────────────────────
  if (type !== 'ReceivedCallback' && !payload?.isMessage) {
    console.log(`${LOG} Evento ignorado: ${type}`);
    return;
  }

  // Ignorar mensagens enviadas pelo próprio agente
  // (já foram salvas pelo send-whatsapp-message)
  if (payload?.fromMe === true || payload?.isFromMe === true) {
    console.log(`${LOG} Mensagem fromMe ignorada`);
    return;
  }

  // ── Normalizar payload Z-API → formato Evolution MESSAGES_UPSERT ──
  const rawPhone = payload?.phone || payload?.from || '';
  if (!rawPhone) {
    console.warn(`${LOG} Telefone ausente`);
    return;
  }

  const normalizedPhone = normalizePhone(rawPhone);
  const remoteJid = `${normalizedPhone}@s.whatsapp.net`;

  const messageId = payload?.messageId || payload?.id || `zapi_${Date.now()}`;
  const timestamp = payload?.momment
    ? Math.floor(payload.momment / 1000)
    : Math.floor(Date.now() / 1000);

  // Monta o conteúdo da mensagem
  let messageType = 'conversation';
  let messageContent: any = {};
  let bodyText = payload?.text?.message || payload?.body || payload?.message || '';

  if (payload?.image) {
    messageType = 'imageMessage';
    messageContent = {
      imageMessage: {
        url: payload.image?.imageUrl || '',
        caption: payload.image?.caption || bodyText || '',
        mimetype: payload.image?.mimeType || 'image/jpeg',
      }
    };
    bodyText = payload.image?.caption || bodyText || '';
  } else if (payload?.audio) {
    messageType = 'audioMessage';
    messageContent = {
      audioMessage: {
        url: payload.audio?.audioUrl || '',
        mimetype: payload.audio?.mimeType || 'audio/ogg',
        ptt: true,
      }
    };
    bodyText = '';
  } else if (payload?.video) {
    messageType = 'videoMessage';
    messageContent = {
      videoMessage: {
        url: payload.video?.videoUrl || '',
        caption: payload.video?.caption || bodyText || '',
        mimetype: payload.video?.mimeType || 'video/mp4',
      }
    };
    bodyText = payload.video?.caption || bodyText || '';
  } else if (payload?.document) {
    messageType = 'documentMessage';
    messageContent = {
      documentMessage: {
        url: payload.document?.documentUrl || '',
        fileName: payload.document?.fileName || 'document',
        mimetype: payload.document?.mimeType || 'application/octet-stream',
      }
    };
    bodyText = payload.document?.caption || bodyText || '';
  } else {
    messageContent = { conversation: bodyText };
  }

  // Monta payload no formato Evolution MESSAGES_UPSERT
  const evolutionPayload = {
    event: 'messages.upsert',
    instance: instance.instance_name,
    data: {
      key: {
        remoteJid,
        fromMe: false,
        id: messageId,
      },
      pushName: payload?.senderName || payload?.name || '',
      message: messageContent,
      messageType,
      messageTimestamp: timestamp,
      status: 'DELIVERY_ACK',
    },
  };

  console.log(`${LOG} Repassando para evolution-webhook: ${remoteJid}`);

  // ── Delegar para evolution-webhook (lógica central) ───────────
  try {
    await fetch(`${supabaseUrl}/functions/v1/evolution-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'x-instance-id': instanceId,
      },
      body: JSON.stringify(evolutionPayload),
    });
    console.log(`${LOG} Delegado com sucesso para evolution-webhook`);
  } catch (err) {
    console.error(`${LOG} Erro ao delegar:`, err);
  }
}
