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
            .select('support_csat_enabled, support_csat_timeout_minutes, support_csat_score_min, support_csat_score_max, support_csat_reason_threshold, support_csat_reason_prompt_template, support_csat_thanks_template')
            .eq('tenant_id', csat.tenant_id)
            .maybeSingle();
          config = {
            enabled: cfgData?.support_csat_enabled ?? true,
            timeoutMinutes: cfgData?.support_csat_timeout_minutes ?? 30,
            scoreMin: cfgData?.support_csat_score_min ?? 0,
            scoreMax: cfgData?.support_csat_score_max ?? 5,
            reasonThreshold: cfgData?.support_csat_reason_threshold ?? 3,
            reasonPrompt: cfgData?.support_csat_reason_prompt_template ?? 'Pode nos contar rapidamente o motivo da sua nota? Sua resposta nos ajuda a melhorar. 🙏',
            thanks: cfgData?.support_csat_thanks_template ?? 'Obrigado pela sua avaliação! 😊',
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

        const askedAt = new Date(csat.asked_at);
        const expiresAt = new Date(askedAt.getTime() + config.timeoutMinutes * 60000);
        const now = new Date();

        const { data: att } = await supabase
          .from('support_attendances')
          .select('id, attendance_code, conversation_id, tenant_id')
          .eq('id', csat.attendance_id)
          .single();

        if (!att) continue;

        // PRIMEIRA resposta do cliente após o CSAT (regra: a 1ª resposta é a avaliação)
        const { data: firstReply } = await supabase
          .from('whatsapp_messages')
          .select('content, created_at')
          .eq('conversation_id', att.conversation_id)
          .eq('tenant_id', csat.tenant_id)
          .eq('is_from_me', false)
          .gt('created_at', csat.asked_at)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        const parseScore = (txt: string | null | undefined): number | null => {
          const t = (txt ?? '').trim();
          if (t.length > 4) return null;
          const d = t.replace(/[^0-9]/g, '');
          if (!/^[0-9]$/.test(d)) return null;
          const n = parseInt(d, 10);
          return (n >= config.scoreMin && n <= config.scoreMax) ? n : null;
        };

        if (firstReply) {
          const replyAt = new Date(firstReply.created_at);
          const score = parseScore(firstReply.content);

          // 1ª resposta é nota válida e veio dentro do timeout -> CAPTURA
          if (score !== null && replyAt <= expiresAt) {
            const needsReason = score <= config.reasonThreshold;
            await supabase.from('support_csat').update({
              score,
              responded_at: firstReply.created_at,
              status: needsReason ? 'awaiting_reason' : 'completed',
            }).eq('id', csat.id);

            if (!needsReason) {
              await supabase.rpc('fn_close_attendance_atomic', {
                p_attendance_id: att.id,
                p_closed_reason: 'csat_completed',
                p_closure_type: 'csat_completed',
              });
            }

            const ctx = await buildInstanceCtx(supabase, att);
            if (ctx) {
              if (needsReason) {
                await sendAndPersistAutoMessage(supabase, ctx, att.conversation_id, att.tenant_id, config.reasonPrompt, { csat: true });
              } else {
                await sendAndPersistAutoMessage(supabase, ctx, att.conversation_id, att.tenant_id, config.thanks, { csat: true });
                await sendDeferredClosureMessage(supabase, ctx, att.conversation_id, att.tenant_id, att.id, att.attendance_code);
              }
            }
            processed++;
            continue;
          }

          // 1ª resposta NÃO é nota (cliente tem outra demanda) -> expira silencioso, NÃO encerra
          if (score === null && replyAt <= expiresAt) {
            await supabase.from('support_csat')
              .update({ status: 'expired', responded_at: now.toISOString() })
              .eq('id', csat.id);
            processed++;
            continue;
          }
        }

        // Sem resposta válida ainda dentro do timeout -> aguarda
        if (now < expiresAt) continue;

        // TIMEOUT (silêncio) -> expira + mensagem + encerra como csat_timeout (NUNCA inatividade)
        await supabase.from('support_csat')
          .update({ status: 'expired', responded_at: now.toISOString() })
          .eq('id', csat.id);

        await supabase.rpc('fn_close_attendance_atomic', {
          p_attendance_id: att.id,
          p_closed_reason: 'csat_timeout',
          p_closure_type: 'csat_timeout',
        });

        const ctx = await buildInstanceCtx(supabase, att);
        if (ctx) {
          await sendAndPersistAutoMessage(
            supabase, ctx, att.conversation_id, att.tenant_id,
            'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! 😊',
            { csat: true, csat_timeout: true }
          );
          await sendDeferredClosureMessage(supabase, ctx, att.conversation_id, att.tenant_id, att.id, att.attendance_code);
        }

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

async function buildInstanceCtx(
  supabase: any,
  att: { conversation_id: string; tenant_id: string }
): Promise<InstanceContext | null> {
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('id, instance_id, contact_id')
    .eq('id', att.conversation_id)
    .maybeSingle();
  if (!conv) return null;

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_id_external, provider_type')
    .eq('id', conv.instance_id)
    .maybeSingle();
  if (!instance) return null;

  const { data: secrets } = await supabase.rpc('get_instance_secrets', { p_instance_id: instance.id });
  const apiUrl = secrets?.api_url;
  const apiKey = secrets?.api_key;
  if (!apiUrl || !apiKey) return null;

  const { data: contact } = await supabase
    .from('whatsapp_contacts')
    .select('phone_number, name, rules_disabled')
    .eq('id', conv.contact_id)
    .maybeSingle();
  if (!contact) return null;

  // Guard "Sem regras do sistema"
  if (contact.rules_disabled === true) {
    console.log(`[${FUNCTION_NAME}] rules_disabled=true on contact — skipping CSAT messages for conv=${att.conversation_id}`);
    return null;
  }

  const evolutionInstanceId = instance.instance_id_external || instance.instance_name;
  return {
    apiUrl,
    apiKey,
    instanceName: evolutionInstanceId,
    providerType: instance.provider_type || 'self_hosted',
    remoteJid: `${contact.phone_number}@s.whatsapp.net`,
    contactName: contact.name || '',
  };
}


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
