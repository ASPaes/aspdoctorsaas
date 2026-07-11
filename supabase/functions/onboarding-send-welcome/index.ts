// onboarding-send-welcome — envia boas-vindas via WhatsApp para a jornada.
// Idempotente: não reenvia se já existe support_ticket_events(event_type='onboarding_boas_vindas').

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';
import { normalizeBRPhone } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Escolhe a instância WhatsApp do tenant: preferência para nome "Financeiro"
// (mesmo padrão dos módulos administrativos), senão a primeira ativa.
async function pickTenantInstance(supabase: any, tenantId: string) {
  const { data: rows } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id, ativo')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);
  if (!rows || rows.length === 0) return null;
  const financeiro = rows.find((r: any) =>
    (r.instance_name || '').toLowerCase().includes('financeiro'),
  );
  return financeiro ?? rows[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const journey_id = body?.journey_id;
  if (!journey_id || typeof journey_id !== 'string') {
    return json({ ok: false, error: 'journey_id_required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Busca jornada + cliente
    const { data: journey, error: jerr } = await supabase
      .from('onboarding_journeys')
      .select('id, tenant_id, ticket_id, cliente_id')
      .eq('id', journey_id)
      .maybeSingle();
    if (jerr) throw jerr;
    if (!journey) return json({ ok: false, error: 'journey_not_found' }, 404);
    if (!journey.ticket_id) return json({ ok: false, error: 'ticket_not_linked' }, 422);

    // Idempotência
    const { data: existing } = await supabase
      .from('support_ticket_events')
      .select('id')
      .eq('ticket_id', journey.ticket_id)
      .eq('event_type', 'onboarding_boas_vindas')
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log('[onboarding-send-welcome] já enviado para ticket', journey.ticket_id);
      return json({ ok: true, alreadySent: true });
    }

    // Cliente + telefone
    const { data: cliente, error: cerr } = await supabase
      .from('clientes')
      .select('id, nome_fantasia, razao_social, telefone_whatsapp, telefone_whatsapp_contato, telefone_contato, contato_fone')
      .eq('id', journey.cliente_id)
      .maybeSingle();
    if (cerr) throw cerr;
    if (!cliente) return json({ ok: false, error: 'cliente_not_found' }, 404);

    const rawPhone =
      cliente.telefone_whatsapp ||
      cliente.telefone_whatsapp_contato ||
      cliente.telefone_contato ||
      cliente.contato_fone;

    if (!rawPhone) {
      console.warn('[onboarding-send-welcome] cliente sem telefone', cliente.id);
      return json({ ok: false, error: 'cliente_sem_telefone' }, 422);
    }

    const normalized = normalizeBRPhone(String(rawPhone));
    if (!normalized.phone) {
      return json({ ok: false, error: 'telefone_invalido' }, 422);
    }

    // Instância
    const instance = await pickTenantInstance(supabase, journey.tenant_id);
    if (!instance) {
      return json({ ok: false, error: 'nenhuma_instancia_ativa' }, 422);
    }

    const secrets = await getInstanceSecrets(supabase, instance.id);
    const adapter = getAdapter(instance.provider_type || 'self_hosted');

    // Mensagem — TODO: template por tenant
    const nome = cliente.nome_fantasia || cliente.razao_social || 'tudo bem';
    const messageText =
      `Olá ${nome}! 👋\n\n` +
      `Seja bem-vindo(a) ao processo de onboarding.\n` +
      `Nosso time de implantação já está preparando tudo para você começar da melhor forma.\n\n` +
      `Em breve você receberá os próximos passos por aqui. Qualquer dúvida, é só responder esta mensagem.`;

    const sendResult = await adapter.send(secrets, instance, {
      to: normalized.phone,
      messageType: 'text',
      content: messageText,
    });

    const messageId = (sendResult as any)?.messageId ?? null;

    // Registra evento
    await supabase.from('support_ticket_events').insert({
      ticket_id: journey.ticket_id,
      event_type: 'onboarding_boas_vindas',
      content: `Boas-vindas enviadas via WhatsApp para ${normalized.phone} (instância: ${instance.instance_name})`,
      new_value: messageId,
    });

    console.log('[onboarding-send-welcome] enviado', { journey_id, ticket_id: journey.ticket_id, messageId });
    return json({ ok: true, messageId });
  } catch (e: any) {
    console.error('[onboarding-send-welcome] fatal:', e);
    return json({ ok: false, error: 'internal_error', detail: e?.message }, 500);
  }
});
