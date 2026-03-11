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
    const { messageIds, conversationId, mode } = body as {
      messageIds: string[];
      conversationId: string;
      mode: 'local' | 'everyone';
    };

    if (!Array.isArray(messageIds) || messageIds.length === 0 || !conversationId) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'messageIds (array) and conversationId required', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    if (mode !== 'local' && mode !== 'everyone') {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'mode must be "local" or "everyone"', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Mode: ${mode}, ${messageIds.length} messages from conversation ${conversationId}`);

    // Fetch messages
    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, message_id, remote_jid, is_from_me, timestamp, sent_by_user_id, instance_id, conversation_id, delete_status')
      .in('id', messageIds)
      .eq('conversation_id', conversationId);

    if (msgError || !messages || messages.length === 0) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: msgError?.message || 'Messages not found', requestId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    // ─── MODE: LOCAL ───
    if (mode === 'local') {
      const validIds = messages
        .filter(m => m.delete_status === 'active' || m.delete_status === 'failed')
        .map(m => m.id);

      if (validIds.length === 0) {
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No messages eligible for local deletion', requestId }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
        });
      }

      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({
          delete_scope: 'local',
          delete_status: 'revoked',
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .in('id', validIds);

      if (updateError) {
        console.error(`[${FUNCTION_NAME}][${requestId}] Error marking local delete:`, updateError);
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Failed to mark messages', requestId }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
        });
      }

      console.log(`[${FUNCTION_NAME}][${requestId}] Local delete: ${validIds.length} messages`);
      return new Response(JSON.stringify({ success: true, mode: 'local', deleted: validIds }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── MODE: EVERYONE ───
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    const errors: string[] = [];
    const validMessages: typeof messages = [];

    for (const msg of messages) {
      if (msg.delete_status !== 'active') {
        errors.push(`${msg.id}: already ${msg.delete_status}`);
        continue;
      }
      if (!msg.is_from_me) {
        errors.push(`${msg.id}: not sent by you`);
        continue;
      }
      if (!msg.message_id) {
        errors.push(`${msg.id}: no Evolution message_id`);
        continue;
      }
      if (!msg.remote_jid) {
        errors.push(`${msg.id}: no remote_jid`);
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

    // Process each message: call Evolution + mark pending
    const results: { id: string; status: 'pending' | 'failed'; error?: string }[] = [];

    for (const msg of validMessages) {
      if (!msg.instance_id || !instanceSecrets[msg.instance_id]) {
        // No instance secrets — mark failed
        await supabase.from('whatsapp_messages').update({
          delete_scope: 'everyone',
          delete_status: 'failed',
          delete_error: 'Instance secrets not found',
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        }).eq('id', msg.id);
        results.push({ id: msg.id, status: 'failed', error: 'Instance secrets not found' });
        continue;
      }

      const { api_url, api_key, instance_name } = instanceSecrets[msg.instance_id];
      const baseUrl = api_url.endsWith('/') ? api_url.slice(0, -1) : api_url;
      const cleanUrl = baseUrl.replace(/\/manager$/, '');

      try {
        const jid = msg.remote_jid && msg.remote_jid.includes('@')
          ? msg.remote_jid
          : `${msg.remote_jid}@s.whatsapp.net`;
        const deleteBody = { id: msg.message_id, remoteJid: jid, fromMe: true };

        console.log(`[${FUNCTION_NAME}][${requestId}] Evolution delete: url=${cleanUrl}/chat/deleteMessageForEveryone/${instance_name}`);

        const resp = await fetch(`${cleanUrl}/chat/deleteMessageForEveryone/${instance_name}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', apikey: api_key },
          body: JSON.stringify(deleteBody),
        });
        const respText = await resp.text();
        console.log(`[${FUNCTION_NAME}][${requestId}] Evolution response ${msg.id}: status=${resp.status}, body=${respText.slice(0, 300)}`);

        if (resp.ok) {
          // Mark as PENDING — wait for webhook REVOKE confirmation
          await supabase.from('whatsapp_messages').update({
            delete_scope: 'everyone',
            delete_status: 'pending',
            deleted_at: new Date().toISOString(),
            deleted_by: userId,
          }).eq('id', msg.id);
          results.push({ id: msg.id, status: 'pending' });
        } else {
          const errorMsg = `Evolution API error: ${resp.status}`;
          await supabase.from('whatsapp_messages').update({
            delete_scope: 'everyone',
            delete_status: 'failed',
            delete_error: errorMsg,
            deleted_at: new Date().toISOString(),
            deleted_by: userId,
          }).eq('id', msg.id);
          results.push({ id: msg.id, status: 'failed', error: errorMsg });
        }
      } catch (err) {
        const errorMsg = `Network error: ${(err as Error).message?.slice(0, 100)}`;
        console.error(`[${FUNCTION_NAME}][${requestId}] Evolution delete failed for ${msg.id}:`, err);
        await supabase.from('whatsapp_messages').update({
          delete_scope: 'everyone',
          delete_status: 'failed',
          delete_error: errorMsg,
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        }).eq('id', msg.id);
        results.push({ id: msg.id, status: 'failed', error: errorMsg });
      }
    }

    const pendingIds = results.filter(r => r.status === 'pending').map(r => r.id);
    const failedIds = results.filter(r => r.status === 'failed').map(r => r.id);

    console.log(`[${FUNCTION_NAME}][${requestId}] Done: ${pendingIds.length} pending, ${failedIds.length} failed`);

    return new Response(JSON.stringify({
      success: true,
      mode: 'everyone',
      pending: pendingIds,
      failed: failedIds,
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
