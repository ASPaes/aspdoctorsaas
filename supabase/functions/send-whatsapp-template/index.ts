import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import {
  findOrCreateContact,
  findOrCreateConversation,
  ensureAttendanceForOperatorMessage,
  incrementAttendanceCounter,
} from '../_shared/message-processor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[send-whatsapp-template]';
const META_API_VERSION = 'v21.0';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const input = await req.json().catch(() => ({}));
    const { instance_id, to, template_id, parameters } = input as {
      instance_id?: string;
      to?: string;
      template_id?: string;
      parameters?: string[];
    };

    if (!instance_id || !to || !template_id) {
      return jsonResponse({ error: 'instance_id, to, and template_id are required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id, provider_type, meta_phone_number_id, is_active')
      .eq('id', instance_id)
      .single();

    if (instErr || !instance) {
      return jsonResponse({ error: 'instance not found' }, 404);
    }
    if (instance.provider_type !== 'meta_cloud') {
      return jsonResponse({ error: 'this endpoint only supports meta_cloud instances' }, 400);
    }
    if (!instance.is_active) {
      return jsonResponse({ error: 'instance is not active' }, 400);
    }
    if (!instance.meta_phone_number_id) {
      return jsonResponse({ error: 'instance has no meta_phone_number_id configured' }, 400);
    }

    const { data: template, error: tplErr } = await supabase
      .from('whatsapp_meta_templates')
      .select('id, tenant_id, instance_id, name, language, status, body_text, body_variables_count')
      .eq('id', template_id)
      .single();

    if (tplErr || !template) {
      return jsonResponse({ error: 'template not found' }, 404);
    }
    if (template.instance_id !== instance.id) {
      return jsonResponse({ error: 'template does not belong to this instance' }, 400);
    }
    if (template.tenant_id !== instance.tenant_id) {
      return jsonResponse({ error: 'tenant mismatch' }, 400);
    }
    if (template.status !== 'APPROVED') {
      return jsonResponse({ error: `template is not approved (status: ${template.status})` }, 400);
    }

    const params = parameters || [];
    if (params.length !== template.body_variables_count) {
      return jsonResponse({
        error: `template requires ${template.body_variables_count} variables, but ${params.length} provided`,
      }, 400);
    }

    const secrets = await getInstanceSecrets(supabase, instance.id);
    const accessToken = (secrets as any).meta_access_token;
    if (!accessToken) {
      return jsonResponse({ error: 'instance has no meta_access_token configured' }, 400);
    }

    const cleanTo = (to || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!cleanTo || cleanTo.length < 10) {
      return jsonResponse({ error: 'invalid phone number' }, 400);
    }
    let normalizedTo = cleanTo;
    if (!normalizedTo.startsWith('55') && (normalizedTo.length === 10 || normalizedTo.length === 11)) {
      normalizedTo = '55' + normalizedTo;
    }
    if (normalizedTo.startsWith('55') && normalizedTo.length === 12) {
      normalizedTo = normalizedTo.slice(0, 4) + '9' + normalizedTo.slice(4);
    }

    const components: any[] = [];
    if (params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: p })),
      });
    }

    const graphBody = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    console.log(`${LOG} Sending template ${template.name}/${template.language} to ${normalizedTo}`);

    const graphUrl = `https://graph.facebook.com/${META_API_VERSION}/${instance.meta_phone_number_id}/messages`;
    const graphResp = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphBody),
    });

    const graphData = await graphResp.json();

    if (!graphResp.ok) {
      console.error(`${LOG} Graph API error ${graphResp.status}:`, graphData);
      return jsonResponse({
        error: 'Graph API request failed',
        status: graphResp.status,
        detail: graphData,
      }, 502);
    }

    const wamid: string | undefined = graphData?.messages?.[0]?.id;
    if (!wamid) {
      console.error(`${LOG} no message id returned:`, graphData);
      return jsonResponse({ error: 'no message id returned from Graph API', detail: graphData }, 502);
    }

    console.log(`${LOG} Template sent successfully. wamid=${wamid}`);

    const remoteJid = `${normalizedTo}@s.whatsapp.net`;

    const contactId = await findOrCreateContact(
      supabase,
      instance.id,
      normalizedTo,
      normalizedTo,
      false,
      true,
      instance.tenant_id,
    );
    if (!contactId) {
      return jsonResponse({ error: 'failed to create contact', wamid }, 500);
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      instance.id,
      contactId,
      instance.tenant_id,
      true,
    );
    if (!conversationId) {
      return jsonResponse({ error: 'failed to create conversation', wamid, contact_id: contactId }, 500);
    }

    const nowIso = new Date().toISOString();
    const messageContent = template.body_text || `[Template: ${template.name}]`;

    const { error: msgErr } = await supabase.from('whatsapp_messages').insert({
      conversation_id: conversationId,
      remote_jid: remoteJid,
      message_id: wamid,
      content: messageContent,
      message_type: 'text',
      is_from_me: true,
      status: 'sent',
      timestamp: nowIso,
      tenant_id: instance.tenant_id,
      instance_id: instance.id,
      metadata: {
        message_kind: 'template',
        template_name: template.name,
        template_language: template.language,
        template_id: template.id,
        ...(params.length > 0 ? { template_parameters: params } : {}),
      },
    });

    if (msgErr) {
      console.error(`${LOG} Failed to persist message:`, msgErr);
    }

    await supabase.from('whatsapp_conversations').update({
      last_message_at: nowIso,
      last_message_preview: messageContent.substring(0, 200),
      is_last_message_from_me: true,
      status: 'active',
      first_agent_message_at: nowIso,
      updated_at: nowIso,
    }).eq('id', conversationId);

    try {
      await ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, instance.tenant_id);
      await incrementAttendanceCounter(supabase, conversationId, 'agent');
    } catch (err) {
      console.error(`${LOG} attendance creation/counter error:`, err);
    }

    return jsonResponse({
      success: true,
      message_id: wamid,
      conversation_id: conversationId,
      contact_id: contactId,
      template_name: template.name,
      template_language: template.language,
    }, 200);
  } catch (err) {
    console.error(`${LOG} Unexpected error:`, err);
    return jsonResponse({ error: 'unexpected', detail: String(err) }, 500);
  }
});
