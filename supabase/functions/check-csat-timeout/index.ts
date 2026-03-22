import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const FUNCTION_NAME = 'check-csat-timeout';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstanceContext {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  providerType: string;
  remoteJid: string;
  contactName: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 204 });
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${FUNCTION_NAME}][${requestId}] Start`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find all expired CSAT records (pending or awaiting_reason)
    // We join with support_attendances to get the conversation_id + tenant_id
    const { data: expiredCsats, error: fetchErr } = await supabase
      .from('support_csat')
      .select(`
        id,
        tenant_id,
        attendance_id,
        status,
        asked_at
      `)
      .in('status', ['pending', 'awaiting_reason']);

    if (fetchErr) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Error fetching CSATs:`, fetchErr.message);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!expiredCsats || expiredCsats.length === 0) {
      console.log(`[${FUNCTION_NAME}][${requestId}] No pending CSATs found`);
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Found ${expiredCsats.length} pending CSATs to check`);

    // Group by tenant_id to fetch config once per tenant
    const tenantConfigCache = new Map<string, any>();
    let processed = 0;

    for (const csat of expiredCsats) {
      try {
        // Get tenant config (cached)
        let config = tenantConfigCache.get(csat.tenant_id);
        if (!config) {
          const { data: cfgData } = await supabase
            .from('configuracoes')
            .select('support_csat_enabled, support_csat_timeout_minutes')
            .eq('tenant_id', csat.tenant_id)
            .maybeSingle();
          config = {
            enabled: cfgData?.support_csat_enabled ?? true,
            timeoutMinutes: cfgData?.support_csat_timeout_minutes ?? 5,
          };
          tenantConfigCache.set(csat.tenant_id, config);
        }

        if (!config.enabled) {
          // CSAT disabled, mark as expired silently
          await supabase
            .from('support_csat')
            .update({ status: 'expired', responded_at: new Date().toISOString() })
            .eq('id', csat.id);
          continue;
        }

        // Check if actually expired
        const askedAt = new Date(csat.asked_at);
        const expiresAt = new Date(askedAt.getTime() + config.timeoutMinutes * 60 * 1000);
        const now = new Date();

        if (now < expiresAt) {
          // Not expired yet, skip
          continue;
        }

        console.log(`[${FUNCTION_NAME}][${requestId}] CSAT ${csat.id} expired (asked_at=${csat.asked_at}, timeout=${config.timeoutMinutes}min)`);

        // Mark as expired
        await supabase
          .from('support_csat')
          .update({ status: 'expired', responded_at: now.toISOString() })
          .eq('id', csat.id);

        // Get attendance info
        const { data: att } = await supabase
          .from('support_attendances')
          .select('id, attendance_code, conversation_id, contact_id, tenant_id')
          .eq('id', csat.attendance_id)
          .single();

        if (!att) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Attendance not found for CSAT ${csat.id}`);
          continue;
        }

        // Get conversation + instance
        const { data: conv } = await supabase
          .from('whatsapp_conversations')
          .select('id, instance_id, contact_id')
          .eq('id', att.conversation_id)
          .single();

        if (!conv) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Conversation not found for att=${att.id}`);
          continue;
        }

        // Get instance details
        const { data: instance } = await supabase
          .from('whatsapp_instances')
          .select('id, instance_name, instance_id_external, provider_type')
          .eq('id', conv.instance_id)
          .single();

        if (!instance) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Instance not found for conv=${conv.id}`);
          continue;
        }

        // Get instance secrets
        const { data: secrets } = await supabase
          .from('whatsapp_instance_secrets')
          .select('api_url, api_key')
          .eq('instance_id', instance.id)
          .single();

        if (!secrets) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Secrets not found for instance=${instance.id}`);
          continue;
        }

        // Get contact phone
        const { data: contact } = await supabase
          .from('whatsapp_contacts')
          .select('phone_number, name')
          .eq('id', conv.contact_id)
          .single();

        if (!contact) {
          console.error(`[${FUNCTION_NAME}][${requestId}] Contact not found for conv=${conv.id}`);
          continue;
        }

        const evolutionInstanceId = instance.instance_id_external || instance.instance_name;
        const remoteJid = `${contact.phone_number}@s.whatsapp.net`;

        const instanceCtx: InstanceContext = {
          apiUrl: secrets.api_url,
          apiKey: secrets.api_key,
          instanceName: evolutionInstanceId,
          providerType: instance.provider_type || 'self_hosted',
          remoteJid,
          contactName: contact.name || '',
        };

        // 1. Send friendly timeout message
        const friendlyMsg = 'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! 😊';
        await sendAndPersistAutoMessage(supabase, instanceCtx, att.conversation_id, att.tenant_id, friendlyMsg, {
          csat: true,
          csat_timeout: true,
        });

        // Small delay to ensure ordering
        await new Promise(r => setTimeout(r, 500));

        // 2. Send deferred closure message
        await sendDeferredClosureMessage(supabase, instanceCtx, att.conversation_id, att.tenant_id, att.id, att.attendance_code);

        processed++;
        console.log(`[${FUNCTION_NAME}][${requestId}] Processed expired CSAT ${csat.id} for att=${att.attendance_code}`);
      } catch (csatErr) {
        console.error(`[${FUNCTION_NAME}][${requestId}] Error processing CSAT ${csat.id}:`, csatErr);
      }
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Done. Processed ${processed} expired CSATs`);
    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Fatal error:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Helpers (duplicated from evolution-webhook for standalone execution) ───

async function sendEvolutionText(
  ctx: InstanceContext,
  text: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const phoneNumber = ctx.remoteJid
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace(/:\d+/, '');
  const endpoint = `${ctx.apiUrl}/message/sendText/${ctx.instanceName}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.providerType === 'cloud') {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  } else {
    headers['apikey'] = ctx.apiKey;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ number: phoneNumber, text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { ok: false, error: errText };
  }

  const data = await response.json();
  return { ok: true, messageId: data.key?.id };
}

async function sendAndPersistAutoMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  text: string,
  metadata?: Record<string, any>
): Promise<void> {
  const sent = await sendEvolutionText(instanceCtx, text);
  if (!sent.ok) {
    console.error(`[${FUNCTION_NAME}] Error sending auto message:`, sent.error);
    return;
  }
  const nowIso = new Date().toISOString();
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conversationId,
    remote_jid: instanceCtx.remoteJid,
    message_id: sent.messageId || `csat_timeout_${Date.now()}`,
    content: text,
    message_type: 'text',
    is_from_me: true,
    status: 'sent',
    timestamp: nowIso,
    tenant_id: tenantId,
    metadata: metadata || { csat: true },
  });
  await supabase.from('whatsapp_conversations').update({
    last_message_at: nowIso,
    last_message_preview: text.substring(0, 200),
    is_last_message_from_me: true,
  }).eq('id', conversationId);
}

async function sendDeferredClosureMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  attendanceId: string,
  attendanceCode: string
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();

    // Send closure message to customer
    const closureText = `✅ Atendimento *${attendanceCode}* encerrado com sucesso.\n\nObrigado pelo contato! Caso precise de algo mais, é só nos enviar uma nova mensagem. 😊`;
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, closureText, {
      system: true,
      attendance_event: 'closed',
      attendance_id: attendanceId,
      deferred_after_csat: true,
    });

    console.log(`[${FUNCTION_NAME}] Deferred closure message sent for att=${attendanceId} code=${attendanceCode}`);
  } catch (err) {
    console.error(`[${FUNCTION_NAME}] Error sending deferred closure message:`, err);
  }
}
