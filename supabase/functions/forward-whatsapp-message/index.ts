import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const FUNCTION_NAME = 'forward-whatsapp-message';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    console.log(`[${FUNCTION_NAME}][${requestId}] Início`);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Missing auth' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }
    const userId = (claimsData.claims as any).sub as string;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { messageIds, targetConversationId } = body as { messageIds: string[]; targetConversationId: string };

    if (!Array.isArray(messageIds) || messageIds.length === 0 || !targetConversationId) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'messageIds and targetConversationId required', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Forwarding ${messageIds.length} msgs to ${targetConversationId}`);

    // Fetch messages to forward
    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, content, message_type, media_url, media_path, media_mimetype, media_filename, media_ext, media_size_bytes, media_kind')
      .in('id', messageIds)
      .order('timestamp', { ascending: true });

    if (msgError || !messages || messages.length === 0) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Messages not found', requestId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    // Fetch target conversation
    const { data: targetConv, error: convError } = await supabase
      .from('whatsapp_conversations')
      .select('*, whatsapp_contacts!inner(phone_number, name)')
      .eq('id', targetConversationId)
      .single();

    if (convError || !targetConv) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Target conversation not found', requestId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    const tenantId = targetConv.tenant_id;
    const contact = (targetConv as any).whatsapp_contacts;
    const destNumber = contact.phone_number.includes('@lid')
      ? contact.phone_number
      : contact.phone_number.replace(/\D/g, '');

    // Get instance
    let instanceId = targetConv.instance_id;
    if (!instanceId) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'connected')
        .limit(1)
        .maybeSingle();
      instanceId = inst?.id;
    }

    if (!instanceId) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No instance available', requestId }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    const [instanceResult, secretsResult, senderResult] = await Promise.all([
      supabase.from('whatsapp_instances').select('id, instance_name, provider_type, instance_id_external').eq('id', instanceId).single(),
      supabase.from('whatsapp_instance_secrets').select('api_url, api_key').eq('instance_id', instanceId).single(),
      (async () => {
        const { data: profile } = await supabase.from('profiles').select('funcionario_id').eq('user_id', userId).maybeSingle();
        if (!profile?.funcionario_id) return { name: '', role: null };
        const { data: func } = await supabase.from('funcionarios').select('nome, cargo').eq('id', profile.funcionario_id).maybeSingle();
        return { name: func?.nome || '', role: func?.cargo || null };
      })(),
    ]);

    const instance = instanceResult.data;
    const secrets = secretsResult.data;
    if (!instance || !secrets) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Instance or secrets not found', requestId }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    const instanceIdentifier = instance.provider_type === 'cloud' && instance.instance_id_external
      ? instance.instance_id_external : instance.instance_name;
    let baseUrl = secrets.api_url.endsWith('/') ? secrets.api_url.slice(0, -1) : secrets.api_url;
    baseUrl = baseUrl.replace(/\/manager$/, '');
    const authHeaders = { apikey: secrets.api_key };

    const forwarded: string[] = [];

    for (const msg of messages) {
      try {
        let endpoint: string;
        let reqBody: any;
        const forwardPrefix = '↪ *Encaminhado*';

        if (msg.message_type === 'text' || (!msg.media_path && !msg.media_url)) {
          endpoint = `${baseUrl}/message/sendText/${instanceIdentifier}`;
          reqBody = { number: destNumber, text: `${forwardPrefix}\n${msg.content || ''}` };
        } else {
          // Media message — get signed URL
          let mediaLink: string | null = null;
          if (msg.media_path) {
            const { data: signedData } = await supabase.storage
              .from('whatsapp-media')
              .createSignedUrl(msg.media_path, 300);
            mediaLink = signedData?.signedUrl || null;
          }
          if (!mediaLink && msg.media_url) {
            mediaLink = msg.media_url;
          }

          if (!mediaLink) {
            console.error(`[${FUNCTION_NAME}][${requestId}] No media URL for msg ${msg.id}`);
            continue;
          }

          const caption = `${forwardPrefix}${msg.content ? `\n${msg.content}` : ''}`;

          if (msg.message_type === 'audio') {
            endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instanceIdentifier}`;
            reqBody = { number: destNumber, audio: mediaLink };
          } else if (msg.message_type === 'image') {
            endpoint = `${baseUrl}/message/sendMedia/${instanceIdentifier}`;
            reqBody = { number: destNumber, media: mediaLink, mediatype: 'image', caption };
          } else if (msg.message_type === 'video') {
            endpoint = `${baseUrl}/message/sendMedia/${instanceIdentifier}`;
            reqBody = { number: destNumber, media: mediaLink, mediatype: 'video', caption };
          } else {
            // document
            endpoint = `${baseUrl}/message/sendMedia/${instanceIdentifier}`;
            reqBody = { number: destNumber, media: mediaLink, mediatype: 'document', caption, fileName: msg.media_filename || 'file' };
          }
        }

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(reqBody),
        });

        if (!resp.ok) {
          const err = await resp.text();
          console.error(`[${FUNCTION_NAME}][${requestId}] Forward failed for ${msg.id}: ${err}`);
          continue;
        }

        const evoData = await resp.json();
        const newMsgId = evoData.key?.id || `fwd_${Date.now()}_${msg.id.slice(0, 8)}`;
        const msgTimestamp = new Date().toISOString();

        const content = msg.message_type === 'text'
          ? `↪ Encaminhado\n${msg.content || ''}`
          : (msg.content ? `↪ Encaminhado\n${msg.content}` : '↪ Encaminhado');

        // Save forwarded message
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: targetConversationId,
          message_id: newMsgId,
          remote_jid: contact.phone_number,
          content,
          message_type: msg.message_type,
          media_url: msg.media_path || msg.media_url || null,
          media_mimetype: msg.media_mimetype,
          media_path: msg.media_path,
          media_filename: msg.media_filename,
          media_ext: msg.media_ext,
          media_size_bytes: msg.media_size_bytes,
          media_kind: msg.media_kind,
          status: 'sent',
          is_from_me: true,
          timestamp: msgTimestamp,
          sent_by_user_id: userId,
          instance_id: instanceId,
          sender_name: senderResult.name || null,
          sender_role: senderResult.role || null,
        });

        // Update conversation
        await supabase.from('whatsapp_conversations').update({
          last_message_at: msgTimestamp,
          last_message_preview: content.substring(0, 200),
          is_last_message_from_me: true,
          updated_at: msgTimestamp,
        }).eq('id', targetConversationId);

        forwarded.push(msg.id);
        console.log(`[${FUNCTION_NAME}][${requestId}] Forwarded msg ${msg.id} -> ${targetConversationId}`);
      } catch (err) {
        console.error(`[${FUNCTION_NAME}][${requestId}] Error forwarding ${msg.id}:`, err);
      }
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Done. Forwarded ${forwarded.length}/${messages.length}`);

    return new Response(JSON.stringify({ success: true, forwarded, total: messages.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Unexpected error', requestId }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
    });
  }
});
