import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_NAME = 'delete-whatsapp-message';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    console.log(`[${FUNCTION_NAME}][${requestId}] Início`);

    // Auth
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
    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }
    const userId = user.id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { messageIds, conversationId } = body as { messageIds: string[]; conversationId: string };

    if (!Array.isArray(messageIds) || messageIds.length === 0 || !conversationId) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'messageIds (array) and conversationId required', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Deleting ${messageIds.length} messages from conversation ${conversationId}`);

    // Fetch messages
    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, message_id, remote_jid, is_from_me, timestamp, sent_by_user_id, instance_id, conversation_id')
      .in('id', messageIds)
      .eq('conversation_id', conversationId);

    console.log(`[${FUNCTION_NAME}][${requestId}] Query result: found=${messages?.length ?? 0}, error=${msgError?.message ?? 'none'}, ids=${JSON.stringify(messageIds)}`);

    if (msgError || !messages || messages.length === 0) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: msgError?.message || 'Messages not found', requestId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    const errors: string[] = [];
    const validMessages: typeof messages = [];

    for (const msg of messages) {
      if (!msg.is_from_me) {
        errors.push(`${msg.id}: not sent by you`);
        continue;
      }
      const elapsed = now - new Date(msg.timestamp).getTime();
      if (elapsed > FIVE_MINUTES) {
        errors.push(`${msg.id}: older than 5 minutes`);
        continue;
      }
      validMessages.push(msg);
    }

    if (validMessages.length === 0) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No messages eligible for deletion', requestId, errors }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    // Get instance secrets for Evolution API call
    const instanceIds = [...new Set(validMessages.map(m => m.instance_id).filter(Boolean))];
    const instanceSecrets: Record<string, { api_url: string; api_key: string; instance_name: string }> = {};

    if (instanceIds.length > 0) {
      const [secretsResult, instancesResult] = await Promise.all([
        supabase.from('whatsapp_instance_secrets').select('instance_id, api_url, api_key').in('instance_id', instanceIds),
        supabase.from('whatsapp_instances').select('id, instance_name').in('id', instanceIds),
      ]);

      const instanceMap = new Map((instancesResult.data || []).map(i => [i.id, i.instance_name]));
      for (const s of (secretsResult.data || [])) {
        const name = instanceMap.get(s.instance_id);
        if (name) {
          instanceSecrets[s.instance_id] = { api_url: s.api_url, api_key: s.api_key, instance_name: name };
        }
      }
    }

    // Delete from Evolution API + soft-delete in DB
    const deletePromises = validMessages.map(async (msg) => {
      // Try Evolution API delete (best-effort)
      if (msg.instance_id && instanceSecrets[msg.instance_id]) {
        const { api_url, api_key, instance_name } = instanceSecrets[msg.instance_id];
        const baseUrl = api_url.endsWith('/') ? api_url.slice(0, -1) : api_url;
        const cleanUrl = baseUrl.replace(/\/manager$/, '');
        try {
          const resp = await fetch(`${cleanUrl}/chat/deleteMessageForEveryone/${instance_name}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', apikey: api_key },
            body: JSON.stringify({ id: msg.message_id, remoteJid: msg.remote_jid, fromMe: true }),
          });
          console.log(`[${FUNCTION_NAME}][${requestId}] Evolution delete ${msg.id}: ${resp.status}`);
        } catch (err) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Evolution delete failed for ${msg.id}:`, err);
        }
      }

      // Soft-delete in DB
      return supabase
        .from('whatsapp_messages')
        .update({ status: 'deleted', content: '' })
        .eq('id', msg.id);
    });

    await Promise.all(deletePromises);

    console.log(`[${FUNCTION_NAME}][${requestId}] Deleted ${validMessages.length} messages successfully`);

    return new Response(JSON.stringify({
      success: true,
      deleted: validMessages.map(m => m.id),
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Unexpected error', requestId }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
    });
  }
});
