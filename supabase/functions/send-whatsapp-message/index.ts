import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
  instanceId?: string; // NEW: optional instance override for cross-instance conversations
}

function getEvolutionAuthHeaders(apiKey: string, _providerType: string): Record<string, string> {
  return { apikey: apiKey };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify user via getClaims
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body: SendMessageRequest = await req.json();
    console.log('[send-whatsapp-message] Request received:', { 
      conversationId: body.conversationId, 
      messageType: body.messageType,
      instanceId: body.instanceId || '(auto)',
    });

    if (!body.conversationId || !body.messageType) {
      return new Response(
        JSON.stringify({ success: false, error: 'conversationId and messageType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.messageType === 'text' && !body.content) {
      return new Response(
        JSON.stringify({ success: false, error: 'content is required for text messages' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.messageType !== 'text' && !body.mediaUrl && !body.mediaBase64) {
      return new Response(
        JSON.stringify({ success: false, error: 'mediaUrl or mediaBase64 is required for media messages' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- PARALLELIZED: conversation fetch + sender resolution ---
    const senderUserId = (claimsData.claims as any).sub as string | undefined;

    const [convResult, senderInfo] = await Promise.all([
      // 1) Fetch conversation with contact info
      supabase
        .from('whatsapp_conversations')
        .select(`*, whatsapp_contacts!inner (phone_number, name)`)
        .eq('id', body.conversationId)
        .single(),
      // 2) Resolve sender name + role
      (async (): Promise<{ label: string; name: string; role: string | null }> => {
        if (!senderUserId) return { label: '', name: '', role: null };
        const { data: profile } = await supabase
          .from('profiles')
          .select('funcionario_id')
          .eq('user_id', senderUserId)
          .maybeSingle();
        if (!profile?.funcionario_id) return { label: '', name: '', role: null };
        const { data: func } = await supabase
          .from('funcionarios')
          .select('nome, cargo')
          .eq('id', profile.funcionario_id)
          .maybeSingle();
        if (!func?.nome) return { label: '', name: '', role: null };
        return { label: `*${func.nome}*`, name: func.nome, role: func.cargo || null };
      })(),
    ]);

    const { data: conversation, error: convError } = convResult;

    if (convError || !conversation) {
      console.error('[send] Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tenantId = conversation.tenant_id;
    const contact = (conversation as any).whatsapp_contacts;

    if (!tenantId) {
      console.error('[send-whatsapp-message] CRITICAL: tenant_id is null/undefined');
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine tenant_id' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CHANGED: Determine which instance to use for sending
    // Priority: 1) explicit instanceId from request, 2) conversation's instance_id, 3) last received message's instance
    let sendInstanceId = body.instanceId || conversation.instance_id;
    
    if (!sendInstanceId) {
      // Fallback: find the instance of the last received message in this conversation
      const { data: lastMsg } = await supabase
        .from('whatsapp_messages')
        .select('instance_id')
        .eq('conversation_id', body.conversationId)
        .eq('is_from_me', false)
        .not('instance_id', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      sendInstanceId = lastMsg?.instance_id;
    }

    if (!sendInstanceId) {
      // Last fallback: get any instance for this tenant
      const { data: anyInstance } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'connected')
        .limit(1)
        .maybeSingle();
      sendInstanceId = anyInstance?.id;
    }

    if (!sendInstanceId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No instance available to send message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch instance details
    const { data: instanceData, error: instanceError } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external')
      .eq('id', sendInstanceId)
      .single();

    if (instanceError || !instanceData) {
      console.error('[send] Instance not found:', sendInstanceId);
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: secrets, error: secretsError } = await supabase
      .from('whatsapp_instance_secrets')
      .select('api_url, api_key')
      .eq('instance_id', instanceData.id)
      .single();

    if (secretsError || !secrets) {
      console.error('[send] Failed to fetch instance secrets:', secretsError);
      return new Response(JSON.stringify({ error: 'Instance secrets not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const instanceName = instanceData.instance_name;
    const providerType = instanceData.provider_type || 'self_hosted';
    const instanceIdExternal = instanceData.instance_id_external;

    const instanceIdentifier = providerType === 'cloud' && instanceIdExternal
      ? instanceIdExternal
      : instanceName;

    console.log('[send-whatsapp-message] Sending to:', contact.phone_number, 'via instance:', instanceName, 'Provider:', providerType);

    const destinationNumber = getDestinationNumber(contact.phone_number);

    // Upload base64 media to Supabase Storage for persistence + signed URL for Evolution
    let persistentMediaPath: string | null = null;
    let storageSignedUrl: string | null = null;
    if (body.mediaBase64 && body.messageType !== 'text') {
      try {
        const raw = body.mediaBase64.startsWith('data:')
          ? body.mediaBase64.split(',')[1] || ''
          : body.mediaBase64;
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        const ext = getExtFromMime(body.mediaMimetype || 'application/octet-stream');
        const storagePath = `${tenantId}/${body.conversationId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('whatsapp-media')
          .upload(storagePath, bytes, {
            contentType: body.mediaMimetype || 'application/octet-stream',
            upsert: false,
          });

        if (uploadError) {
          console.error('[send-whatsapp-message] Storage upload error:', uploadError);
        } else {
          persistentMediaPath = storagePath;
          const { data: signedData } = await supabase.storage
            .from('whatsapp-media')
            .createSignedUrl(storagePath, 300);
          if (signedData?.signedUrl) {
            storageSignedUrl = signedData.signedUrl;
          }
          console.log('[send-whatsapp-message] Media uploaded to storage:', storagePath, 'signedUrl:', !!storageSignedUrl);
        }
      } catch (uploadErr) {
        console.error('[send-whatsapp-message] Failed to upload media:', uploadErr);
      }
    }

    const senderLabel = senderInfo.label;
    const prefixedBody = { ...body };
    if (senderLabel && prefixedBody.content) {
      prefixedBody.content = `${senderLabel}\n${prefixedBody.content}`;
    } else if (senderLabel && prefixedBody.messageType === 'text' && !prefixedBody.content) {
      prefixedBody.content = senderLabel;
    }

    // Use signed URL from storage if available, otherwise fall back to base64/mediaUrl
    const mediaOverride = storageSignedUrl || undefined;
    const { endpoint, requestBody } = buildEvolutionRequest(
      secrets.api_url,
      instanceIdentifier,
      destinationNumber,
      prefixedBody,
      mediaOverride
    );

    const authHeaders = getEvolutionAuthHeaders(secrets.api_key, providerType);

    const evolutionResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(requestBody),
    });

    if (!evolutionResponse.ok) {
      const errorText = await evolutionResponse.text();
      console.error('[send-whatsapp-message] Evolution API error:', errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to send message via Evolution API' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionData = await evolutionResponse.json();
    const messageId = evolutionData.key?.id || `msg_${Date.now()}`;

    let extractedMediaUrl: string | null = null;
    if (body.messageType === 'audio' && evolutionData.message?.audioMessage?.url) {
      extractedMediaUrl = evolutionData.message.audioMessage.url;
    } else if (body.messageType === 'image' && evolutionData.message?.imageMessage?.url) {
      extractedMediaUrl = evolutionData.message.imageMessage.url;
    } else if (body.messageType === 'video' && evolutionData.message?.videoMessage?.url) {
      extractedMediaUrl = evolutionData.message.videoMessage.url;
    } else if (body.messageType === 'document' && evolutionData.message?.documentMessage?.url) {
      extractedMediaUrl = evolutionData.message.documentMessage.url;
    }

    const messageContent = body.messageType === 'text' 
      ? (body.content || '') 
      : (body.content || `Sent ${body.messageType}`);

    const messageTimestamp = new Date().toISOString();

    // --- PARALLELIZED: save message + update conversation ---
    // CHANGED: include instance_id in the saved message
    const [saveResult] = await Promise.all([
      anonClient
        .from('whatsapp_messages')
        .insert({
          tenant_id: tenantId,
          conversation_id: body.conversationId,
          message_id: messageId,
          remote_jid: contact.phone_number,
          content: messageContent,
          message_type: body.messageType,
          media_url: persistentMediaPath || extractedMediaUrl || body.mediaUrl || null,
          media_mimetype: body.mediaMimetype || null,
          status: 'sent',
          is_from_me: true,
          timestamp: messageTimestamp,
          quoted_message_id: body.quotedMessageId || null,
          metadata: body.fileName ? { fileName: body.fileName } : null,
          sent_by_user_id: senderUserId || null,
          instance_id: sendInstanceId,
        })
        .select()
        .single(),
      (async () => {
        const updateData: Record<string, any> = {
          last_message_at: messageTimestamp,
          last_message_preview: messageContent.substring(0, 200),
          is_last_message_from_me: true,
          updated_at: messageTimestamp,
        };

        await supabase
          .from('whatsapp_conversations')
          .update(updateData)
          .eq('id', body.conversationId);
      })(),
    ]);

    const { data: savedMessage, error: saveError } = saveResult;

    if (saveError) {
      console.error('[send-whatsapp-message] Error saving message:', saveError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[send-whatsapp-message] Message sent and saved:', savedMessage.id, 'via instance:', sendInstanceId);

    // Fire-and-forget: trigger audio transcription for sent audio messages
    if (body.messageType === 'audio' && savedMessage?.id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      console.log('[send-whatsapp-message] Triggering audio transcription for:', savedMessage.id);
      fetch(`${supabaseUrl}/functions/v1/transcribe-whatsapp-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` },
        body: JSON.stringify({ messageId: savedMessage.id }),
      }).catch(err => console.error('[send-whatsapp-message] Transcription trigger error:', err));
    }

    return new Response(
      JSON.stringify({ success: true, message: savedMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[send-whatsapp-message] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getDestinationNumber(phoneNumber: string): string {
  if (phoneNumber.includes('@lid')) return phoneNumber;
  return phoneNumber.replace(/\D/g, '');
}

function buildEvolutionRequest(
  apiUrl: string,
  instanceName: string,
  number: string,
  body: SendMessageRequest,
  mediaUrlOverride?: string
): { endpoint: string; requestBody: any } {
  let baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  baseUrl = baseUrl.replace(/\/manager$/, '');

  switch (body.messageType) {
    case 'text': {
      const requestBody: any = { number, text: body.content };
      if (body.quotedMessageId) {
        requestBody.quoted = { key: { id: body.quotedMessageId } };
      }
      return { endpoint: `${baseUrl}/message/sendText/${instanceName}`, requestBody };
    }

    case 'audio': {
      let audioData: string | undefined = mediaUrlOverride;
      if (!audioData) {
        if (body.mediaBase64) {
          audioData = body.mediaBase64.startsWith('data:')
            ? body.mediaBase64.split(',')[1] || ''
            : body.mediaBase64;
        } else if (body.mediaUrl) {
          audioData = body.mediaUrl;
        }
      }
      if (!audioData) throw new Error('Missing audio data');
      return {
        endpoint: `${baseUrl}/message/sendWhatsAppAudio/${instanceName}`,
        requestBody: { number, audio: audioData },
      };
    }

    case 'image':
    case 'video':
    case 'document': {
      const mediaData = mediaUrlOverride || body.mediaUrl;
      if (!mediaData) throw new Error('Missing media data for ' + body.messageType);
      const requestBody: any = {
        number,
        mediatype: body.messageType,
        media: mediaData,
      };
      if (body.content) requestBody.caption = body.content;
      if (body.messageType === 'document' && body.fileName) requestBody.fileName = body.fileName;
      return { endpoint: `${baseUrl}/message/sendMedia/${instanceName}`, requestBody };
    }

    default:
      throw new Error(`Unsupported message type: ${body.messageType}`);
  }
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4', 'audio/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[mime] || 'bin';
}
