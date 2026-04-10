import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const FUNCTION_NAME = 'delete-whatsapp-message';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Resolve a valid @s.whatsapp.net JID for Evolution API.
 * WhatsApp internally uses @lid (Linked ID) which doesn't work with the delete endpoint.
 */
async function resolveRemoteJid(
  supabase: any,
  remoteJid: string | null,
  conversationId: string,
  requestId: string
): Promise<string | null> {
  // If already has @s.whatsapp.net or @g.us, use as-is
  if (remoteJid && (remoteJid.includes('@s.whatsapp.net') || remoteJid.includes('@g.us'))) {
    console.log(`[${FUNCTION_NAME}][${requestId}] JID already valid: ${remoteJid}`);
    return remoteJid;
  }

  // Normalize @lid: strip ":NN" suffix
  let normalized = remoteJid;
  if (remoteJid && remoteJid.includes('@lid')) {
    normalized = remoteJid.replace(/:\d+@lid/, '@lid');
    console.log(`[${FUNCTION_NAME}][${requestId}] Normalized @lid: ${remoteJid} -> ${normalized}`);
  }

  // For @lid or missing JIDs, resolve from contact's phone_number
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('contact_id, whatsapp_contacts(phone_number, is_group)')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conv?.whatsapp_contacts?.phone_number) {
    console.log(`[${FUNCTION_NAME}][${requestId}] Could not resolve phone for conversation ${conversationId}`);
    return null;
  }

  const phone = conv.whatsapp_contacts.phone_number;
  const isGroup = conv.whatsapp_contacts.is_group;
  const suffix = isGroup ? '@g.us' : '@s.whatsapp.net';
  const resolved = `${phone}${suffix}`;
  console.log(`[${FUNCTION_NAME}][${requestId}] Resolved JID: ${remoteJid || '(null)'} -> ${resolved}`);
  return resolved;
}

/**
 * After deletion, recalculate last_message_preview from the most recent
 * non-revoked/non-deleted message in the conversation.
 */
async function refreshConversationPreview(supabase: any, conversationId: string, requestId: string) {
  try {
    const { data: lastMsg } = await supabase
      .from('whatsapp_messages')
      .select('content, timestamp, is_from_me, message_type')
      .eq('conversation_id', conversationId)
      .not('delete_status', 'eq', 'revoked')
      .not('message_type', 'eq', 'revoked')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg) {
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_preview: (lastMsg.content || '').substring(0, 200),
          last_message_at: lastMsg.timestamp,
          is_last_message_from_me: lastMsg.is_from_me,
        })
        .eq('id', conversationId);
      console.log(`[${FUNCTION_NAME}][${requestId}] Conversation preview refreshed`);
    } else {
      // No messages left
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_preview: null,
          last_message_at: null,
          is_last_message_from_me: false,
        })
        .eq('id', conversationId);
      console.log(`[${FUNCTION_NAME}][${requestId}] Conversation preview cleared (no messages)`);
    }
  } catch (err) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Error refreshing preview:`, err);
  }
}

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
    const { data: { user }, error: userError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
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
      mode: 'panel_only' | 'everyone';
    };

    if (!Array.isArray(messageIds) || messageIds.length === 0 || !conversationId) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'messageIds (array) and conversationId required', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    if (mode !== 'panel_only' && mode !== 'everyone') {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'mode must be "panel_only" or "everyone"', requestId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Mode: ${mode}, ${messageIds.length} messages, conversation: ${conversationId}`);

    // Fetch messages
    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, message_id, remote_jid, is_from_me, timestamp, sent_by_user_id, instance_id, conversation_id, delete_status, media_url, content, status')
      .in('id', messageIds)
      .eq('conversation_id', conversationId);

    if (msgError || !messages || messages.length === 0) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Messages not found:`, msgError?.message);
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: msgError?.message || 'Messages not found', requestId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    // ─── MODE: PANEL_ONLY ───
    if (mode === 'panel_only') {
      const validIds = messages
        .filter(m => m.delete_status === 'active' || m.delete_status === 'failed' || !m.delete_status)
        .map(m => m.id);

      if (validIds.length === 0) {
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No messages eligible for panel deletion', requestId }), {
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
          content: '',
          message_type: 'revoked',
          media_url: null,
          media_path: null,
          media_mimetype: null,
          media_filename: null,
          media_ext: null,
          media_kind: null,
        })
        .in('id', validIds);

      if (updateError) {
        console.error(`[${FUNCTION_NAME}][${requestId}] Error marking panel delete:`, updateError);
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Failed to mark messages', requestId }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
        });
      }

      // Refresh sidebar preview
      await refreshConversationPreview(supabase, conversationId, requestId);

      console.log(`[${FUNCTION_NAME}][${requestId}] Panel delete OK: ${validIds.length} messages`);
      return new Response(JSON.stringify({ success: true, mode: 'panel_only', deleted: validIds }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── MODE: EVERYONE ───
    const errors: string[] = [];
    const validMessages: typeof messages = [];

    for (const msg of messages) {
      if (msg.delete_status === 'revoked' || msg.delete_status === 'pending') {
        errors.push(`${msg.id}: already ${msg.delete_status}`);
        continue;
      }
      if (!msg.is_from_me) {
        errors.push(`${msg.id}: not sent by you (is_from_me=false)`);
        continue;
      }
      if (!msg.message_id) {
        errors.push(`${msg.id}: no Evolution message_id`);
        continue;
      }
      validMessages.push(msg);
    }

    if (validMessages.length === 0) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No messages eligible for delete-for-everyone', requestId, errors }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
      });
    }

    // Get instance secrets for Evolution API call
    const instanceIds = [...new Set(validMessages.map(m => m.instance_id).filter(Boolean))];
    const instanceSecrets: Record<string, { api_url: string; api_key: string; instance_name: string }> = {};

    if (instanceIds.length > 0) {
      const { data: instancesData } = await supabase.from('whatsapp_instances').select('id, instance_name').in('id', instanceIds);
      const instanceMap = new Map((instancesData || []).map((i: any) => [i.id, i.instance_name]));

      for (const iid of instanceIds) {
        const vaultSecrets = await getInstanceSecrets(supabase, iid);
        const name = instanceMap.get(iid);
        if (name && vaultSecrets.api_url && vaultSecrets.api_key) {
          instanceSecrets[iid] = { api_url: vaultSecrets.api_url, api_key: vaultSecrets.api_key, instance_name: name };
        }
      }
    }

    // Process each message
    const results: { id: string; status: 'pending' | 'failed'; error?: string }[] = [];

    for (const msg of validMessages) {
      if (!msg.instance_id || !instanceSecrets[msg.instance_id]) {
        await supabase.from('whatsapp_messages').update({
          delete_scope: 'everyone',
          delete_status: 'failed',
          delete_error: 'Instance secrets not found',
          deleted_by: userId,
        }).eq('id', msg.id);
        results.push({ id: msg.id, status: 'failed', error: 'Instance secrets not found' });
        continue;
      }

      const { api_url, api_key, instance_name } = instanceSecrets[msg.instance_id];
      const baseUrl = api_url.endsWith('/') ? api_url.slice(0, -1) : api_url;
      const cleanUrl = baseUrl.replace(/\/manager$/, '');

      try {
        // Use the original remote_jid stored on the message first
        let jidToUse = msg.remote_jid;
        console.log(`[${FUNCTION_NAME}][${requestId}] Message details: message_id=${msg.message_id}, original_remote_jid=${msg.remote_jid}, fromMe=${msg.is_from_me}`);

        // If original JID is missing, try to resolve from conversation contact
        if (!jidToUse) {
          jidToUse = await resolveRemoteJid(supabase, null, conversationId, requestId);
        }

        if (!jidToUse) {
          const errorMsg = 'Could not determine remoteJid for this message';
          await supabase.from('whatsapp_messages').update({
            delete_scope: 'everyone',
            delete_status: 'failed',
            delete_error: errorMsg,
            deleted_by: userId,
          }).eq('id', msg.id);
          results.push({ id: msg.id, status: 'failed', error: errorMsg });
          continue;
        }

        // Step 1: Mark as PENDING before calling Evolution
        await supabase.from('whatsapp_messages').update({
          delete_scope: 'everyone',
          delete_status: 'pending',
          deleted_by: userId,
        }).eq('id', msg.id);

        // Step 2: Try Evolution API with original JID first
        const evolutionUrl = `${cleanUrl}/chat/deleteMessageForEveryone/${instance_name}`;
        let deleteBody = { id: msg.message_id, remoteJid: jidToUse, fromMe: true };

        console.log(`[${FUNCTION_NAME}][${requestId}] Evolution DELETE: ${evolutionUrl}`);
        console.log(`[${FUNCTION_NAME}][${requestId}] Body: ${JSON.stringify(deleteBody)}`);

        let resp = await fetch(evolutionUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', apikey: api_key },
          body: JSON.stringify(deleteBody),
        });
        let respText = await resp.text();
        console.log(`[${FUNCTION_NAME}][${requestId}] Evolution response: status=${resp.status} body=${respText.slice(0, 500)}`);

        // If original JID failed and it's @lid, try resolved @s.whatsapp.net as fallback
        if (!resp.ok && jidToUse.includes('@lid')) {
          const fallbackJid = await resolveRemoteJid(supabase, jidToUse, conversationId, requestId);
          if (fallbackJid && fallbackJid !== jidToUse) {
            console.log(`[${FUNCTION_NAME}][${requestId}] Retrying with resolved JID: ${fallbackJid}`);
            deleteBody = { id: msg.message_id, remoteJid: fallbackJid, fromMe: true };
            resp = await fetch(evolutionUrl, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', apikey: api_key },
              body: JSON.stringify(deleteBody),
            });
            respText = await resp.text();
            console.log(`[${FUNCTION_NAME}][${requestId}] Evolution fallback response: status=${resp.status} body=${respText.slice(0, 500)}`);
          }
        }

        if (resp.ok) {
          // Evolution accepted the request (201/PENDING).
          // Keep status as 'pending' — the webhook will confirm revoke.
          // Do NOT mark as revoked here.
          console.log(`[${FUNCTION_NAME}][${requestId}] ✅ Evolution accepted delete: ${msg.id} (message_id=${msg.message_id}), waiting for webhook confirmation`);
          results.push({ id: msg.id, status: 'pending' });
        } else {
          const errorMsg = `Evolution API ${resp.status}: ${respText.slice(0, 200)}`;
          console.error(`[${FUNCTION_NAME}][${requestId}] ❌ Evolution error: ${errorMsg}`);
          await supabase.from('whatsapp_messages').update({
            delete_status: 'failed',
            delete_scope: 'everyone',
            delete_error: errorMsg,
            deleted_by: userId,
          }).eq('id', msg.id);
          results.push({ id: msg.id, status: 'failed', error: errorMsg });
        }
      } catch (err) {
        const errorMsg = `Network error: ${(err as Error).message?.slice(0, 150)}`;
        console.error(`[${FUNCTION_NAME}][${requestId}] ❌ Network error:`, err);
        await supabase.from('whatsapp_messages').update({
          delete_status: 'failed',
          delete_scope: 'everyone',
          delete_error: errorMsg,
          deleted_by: userId,
        }).eq('id', msg.id);
        results.push({ id: msg.id, status: 'failed', error: errorMsg });
      }
    }

    // NOTE: Do NOT refresh sidebar preview here for 'everyone' mode.
    // Messages are still 'pending'. The webhook will confirm revoke and refresh preview.

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
    console.error(`[${FUNCTION_NAME}][${requestId}] Fatal error:`, error);
    return new Response(JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Unexpected error', requestId }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/problem+json' },
    });
  }
});
