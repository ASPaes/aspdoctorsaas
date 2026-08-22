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
    return new Response(null, { headers: corsHeaders, status: 204 });
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
        asked_at,
        responded_at,
        score
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

        // Relogio ancorado no que foi pedido por ULTIMO:
        //  - pending         -> espera-se a NOTA, pedida em asked_at
        //  - awaiting_reason -> espera-se o MOTIVO, pedido em responded_at (quando a nota chegou)
        const anchorAt = (csat.status === 'awaiting_reason' && csat.responded_at)
          ? new Date(csat.responded_at)
          : new Date(csat.asked_at);
        const expiresAt = new Date(anchorAt.getTime() + config.timeoutMinutes * 60000);
        const now = new Date();

        const { data: att } = await supabase
          .from('support_attendances')
          .select('id, attendance_code, conversation_id, tenant_id')
          .eq('id', csat.attendance_id)
          .single();

        if (!att) continue;

        // ── CAPTURA DE NOTA: SOMENTE para status 'pending'. ─────────────────────
        // Em 'awaiting_reason' a nota JA foi capturada e o prompt do motivo JA foi
        // enviado. Recapturar aqui reenvia o prompt a CADA ciclo do cron (2 em 2 min,
        // infinito) porque a mensagem da nota fica no historico pra sempre.
        if (csat.status === 'pending') {
          const parseScore = (txt: string | null | undefined): number | null => {
            const t = (txt ?? '').trim();
            if (t.length > 4) return null;
            const d = t.replace(/[^0-9]/g, '');
            if (!/^[0-9]$/.test(d)) return null;
            const n = parseInt(d, 10);
            return (n >= config.scoreMin && n <= config.scoreMax) ? n : null;
          };

          // Procura a PRIMEIRA resposta que é NOTA VÁLIDA dentro da janela do timeout.
          // Regra: cortesia/texto antes da nota NÃO expira o CSAT — o cliente pode mandar
          // a nota em mensagens seguintes. O message-processor re-pede a nota em tempo real;
          // aqui é só rede de segurança (captura) + fechamento por timeout (silêncio).
          const { data: replies } = await supabase
            .from('whatsapp_messages')
            .select('content, created_at')
            .eq('conversation_id', att.conversation_id)
            .eq('tenant_id', csat.tenant_id)
            .eq('is_from_me', false)
            .gt('created_at', csat.asked_at)
            .order('created_at', { ascending: true });

          let captured: { score: number; at: string } | null = null;
          for (const r of (replies || [])) {
            if (new Date(r.created_at) > expiresAt) break;
            const s = parseScore(r.content);
            if (s !== null) { captured = { score: s, at: r.created_at }; break; }
          }

          if (captured) {
            const needsReason = captured.score <= config.reasonThreshold;
            await supabase.from('support_csat').update({
              score: captured.score,
              responded_at: captured.at,
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
        }

        // Sem resposta válida ainda dentro do timeout -> aguarda
        if (now < expiresAt) continue;

        // ── TIMEOUT em 'awaiting_reason': a NOTA EXISTE, so o motivo nao veio. ──
        // Fecha como csat_completed (a nota vale) + agradece.
        // NUNCA manda "nao deu uma nota" — ele deu.
        // responded_at NAO e sobrescrito: preserva a hora em que a nota chegou.
        if (csat.status === 'awaiting_reason') {
          await supabase.from('support_csat')
            .update({ status: 'completed' })
            .eq('id', csat.id);

          await supabase.rpc('fn_close_attendance_atomic', {
            p_attendance_id: att.id,
            p_closed_reason: 'csat_completed',
            p_closure_type: 'csat_completed',
          });

          const reasonCtx = await buildInstanceCtx(supabase, att);
          if (reasonCtx) {
            await sendAndPersistAutoMessage(supabase, reasonCtx, att.conversation_id, att.tenant_id, config.thanks, { csat: true });
            await sendDeferredClosureMessage(supabase, reasonCtx, att.conversation_id, att.tenant_id, att.id, att.attendance_code);
          }

          processed++;
          console.log(`[${FUNCTION_NAME}][${requestId}] awaiting_reason timeout -> completed csat=${csat.id} score=${csat.score}`);
          continue;
        }

        // TIMEOUT (silêncio, status='pending') -> expira + mensagem + encerra como csat_timeout (NUNCA inatividade)
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

// Grupos: gate do aviso de encerramento. Coluna NOT NULL DEFAULT true em
// configuracoes, entao so devolve false com desligamento explicito do tenant.
// Falha de leitura mantem o comportamento historico (envia). Duplicado de
// proposito: por em _shared obrigaria um deploy de todas as functions (CLAUDE.md).
async function groupNoticesDisabled(supabase: any, conversationId: string, tenantId: string): Promise<boolean> {
  try {
    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('is_group')
      .eq('id', conversationId)
      .maybeSingle();
    if (conv?.is_group !== true) return false;

    const { data, error } = await supabase
      .from('configuracoes')
      .select('group_send_attendance_notices')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) {
      console.error(`[${FUNCTION_NAME}] erro ao ler group_send_attendance_notices:`, error);
      return false;
    }
    return data?.group_send_attendance_notices === false;
  } catch (err) {
    console.error(`[${FUNCTION_NAME}] falha ao ler group_send_attendance_notices:`, err);
    return false;
  }
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
    // Grupo com os avisos desligados: o atendimento ja fechou, so a mensagem some.
    if (await groupNoticesDisabled(supabase, conversationId, tenantId)) {
      console.log(`[${FUNCTION_NAME}] aviso de encerramento suprimido: grupo com group_send_attendance_notices=false conv=${conversationId}`);
      return;
    }

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
