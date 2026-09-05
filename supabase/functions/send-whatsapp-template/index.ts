import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { normalizeBRPhone } from '../_shared/phone.ts';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import {
  findOrCreateContact,
  findOrCreateConversation,
  ensureAttendanceForOperatorMessage,
  incrementAttendanceCounter,
} from '../_shared/message-processor.ts';
import {
  parseTemplateParams,
  resolveValues,
  buildBodyComponent,
  renderTemplateText,
} from '../_shared/meta-template-params.ts';
import { previewCut } from '../_shared/preview.ts';

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
      parameters?: string[] | Record<string, string>;
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

    // Quem clicou. Sem isso o atendimento nascia orfao: o eco do webhook da Meta
    // chegava ~100ms depois, ensureAttendanceForOperatorMessage abria um atendimento
    // 'waiting' sem dono e sem setor, e fn_assign_conversation_if_ready sai em
    // 'no_department' — o chat ficava parado na Fila ate alguem clicar Assumir.
    // Medido na Delvale em 31/08/2026: 12 de 12 conversas iniciadas por template
    // nasceram sem dono, contra 2 de 2 pelo envio normal, que ja cria o atendimento
    // antes de enviar. A funcao roda com service_role e verify_jwt=false, entao o
    // token do usuario e lido a mao do header.
    let senderUserId: string | null = null;
    try {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (jwt) {
        const { data: authData } = await supabase.auth.getUser(jwt);
        senderUserId = authData?.user?.id ?? null;
      }
    } catch (err) {
      console.error(`${LOG} could not resolve caller:`, err);
    }

    // O setor vem de support_department_members — e o que o motor de distribuicao
    // le. funcionarios.department_id e so o que a UI escreve; o sync roda por trigger.
    let senderDepartmentId: string | null = null;
    if (senderUserId) {
      const { data: mem } = await supabase
        .from('support_department_members')
        .select('department_id')
        .eq('user_id', senderUserId)
        .eq('tenant_id', instance.tenant_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      senderDepartmentId = mem?.department_id ?? null;
    }
    if (!senderUserId) {
      console.warn(`${LOG} sem autor no header — atendimento cai na fila (comportamento antigo)`);
    }

    const { data: template, error: tplErr } = await supabase
      .from('whatsapp_meta_templates')
      .select('id, tenant_id, instance_id, name, language, status, body_text, components')
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

    const spec = parseTemplateParams((template as any).components);
    if (spec.unsupported.length > 0) {
      return jsonResponse({ error: `Template não suportado: ${spec.unsupported.join('; ')}` }, 400);
    }
    const resolved = resolveValues(spec, parameters);
    if (!resolved.ok) {
      return jsonResponse({ error: resolved.error }, 400);
    }
    const values = resolved.values;

    const secrets = await getInstanceSecrets(supabase, instance.id);
    const accessToken = (secrets as any).meta_access_token;
    if (!accessToken) {
      return jsonResponse({ error: 'instance has no meta_access_token configured' }, 400);
    }

    const cleanTo = (to || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!cleanTo || cleanTo.length < 10) {
      return jsonResponse({ error: 'invalid phone number' }, 400);
    }
    // Normalizacao central em _shared/phone.ts. O 9 so entra em celular antigo:
    // fixo BR (digito apos o DDD entre 2-5) vai para a Meta como esta cadastrado.
    const { phone: basePhone, isLandline } = normalizeBRPhone(cleanTo);
    let normalizedTo = basePhone;
    if (!isLandline && normalizedTo.startsWith('55') && normalizedTo.length === 12) {
      normalizedTo = normalizedTo.slice(0, 4) + '9' + normalizedTo.slice(4);
    }

    const bodyComponent = buildBodyComponent(spec, values);

    const graphBody = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(bodyComponent ? { components: [bodyComponent] } : {}),
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
      const metaCode = graphData?.error?.code;
      const metaMsg = graphData?.error?.message ?? 'erro desconhecido';
      const metaDetails = graphData?.error?.error_data?.details;
      console.error(
        `${LOG} Graph API error ${graphResp.status} code=${metaCode}:`,
        JSON.stringify(graphData),
      );
      return jsonResponse({
        error: `A Meta recusou o envio${metaCode ? ` (código ${metaCode})` : ''}: ${metaDetails || metaMsg}`,
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
    const messageContent = template.body_text
      ? renderTemplateText(template.body_text, spec, values)
      : `[Template: ${template.name}]`;

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
      sent_by_user_id: senderUserId,
      metadata: {
        message_kind: 'template',
        template_name: template.name,
        template_language: template.language,
        template_id: template.id,
        ...(values.length > 0
          ? {
              template_parameters: values,
              template_param_names: spec.names,
              template_param_format: spec.format,
            }
          : {}),
      },
    });

    if (msgErr) {
      console.error(`${LOG} Failed to persist message:`, msgErr);
    }

    await supabase.from('whatsapp_conversations').update({
      last_message_at: nowIso,
      last_message_preview: previewCut(messageContent),
      is_last_message_from_me: true,
      status: 'active',
      first_agent_message_at: nowIso,
      updated_at: nowIso,
    }).eq('id', conversationId);

    // Quem inicia a conversa fica com ela. Mesma regra do envio normal
    // (send-whatsapp-message cria o atendimento 'in_progress' antes de enviar).
    // Aqui o atendimento so pode nascer DEPOIS do envio, porque a conversa e criada
    // a partir do wamid — entao o eco do webhook pode chegar primeiro. Por isso os
    // dois casos: adotar o que ja existe, ou criar.
    try {
      if (senderUserId) {
        const { data: existingAtt } = await supabase
          .from('support_attendances')
          .select('id, status, assigned_to, department_id')
          .eq('conversation_id', conversationId)
          .in('status', ['waiting', 'in_progress'])
          .limit(1)
          .maybeSingle();

        if (!existingAtt) {
          const { error: attErr } = await supabase.from('support_attendances').insert({
            tenant_id: instance.tenant_id,
            conversation_id: conversationId,
            contact_id: contactId,
            status: 'in_progress',
            opened_at: nowIso,
            assigned_to: senderUserId,
            assumed_at: nowIso,
            first_response_at: nowIso,
            last_operator_message_at: nowIso,
            department_id: senderDepartmentId,
            created_from: 'agent',
          });
          if (attErr) console.error(`${LOG} Error creating attendance:`, attErr);
        } else if (existingAtt.status === 'waiting' && !existingAtt.assigned_to) {
          // O eco do webhook ganhou a corrida e abriu um atendimento orfao: adota.
          const { error: adoptErr } = await supabase
            .from('support_attendances')
            .update({
              status: 'in_progress',
              assigned_to: senderUserId,
              assumed_at: nowIso,
              queued_at: null,
              department_id: existingAtt.department_id ?? senderDepartmentId,
              updated_at: nowIso,
            })
            .eq('id', existingAtt.id)
            .eq('status', 'waiting')
            .is('assigned_to', null);
          if (adoptErr) console.error(`${LOG} Error adopting attendance:`, adoptErr);
        }

        await supabase
          .from('whatsapp_conversations')
          .update({ assigned_to: senderUserId, updated_at: nowIso })
          .eq('id', conversationId)
          .is('assigned_to', null);

        if (senderDepartmentId) {
          await supabase
            .from('whatsapp_conversations')
            .update({ department_id: senderDepartmentId, updated_at: nowIso })
            .eq('id', conversationId)
            .is('department_id', null);
        }
      } else {
        // Sem autor identificado, mantem o caminho antigo. O 5o argumento estava
        // faltando na chamada original: sem instanceId a cascata do dono consultava
        // whatsapp_instances com id undefined e nunca achava a instancia pessoal.
        await ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, instance.tenant_id, instance.id);
      }
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
