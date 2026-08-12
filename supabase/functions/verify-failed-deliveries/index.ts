// Fabrica a garantia de que a mensagem NÃO chegou.
//
// O ERROR sozinho não serve de prova: os acks do WhatsApp vêm por dispositivo e, em
// grupo, por participante. Um ERROR pode ser 1 de 40 destinatários. Por isso a falha só
// é declarada quando as TRÊS condições valem ao mesmo tempo, e nunca antes da janela.
//
// Dois modos:
//   { tenantId, messageId }  → alvo, disparado pelo webhook (caminho rápido)
//   {}                       → varredura, disparada pelo cron (rede de segurança)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { resendMessage } from '../_shared/resend-message.ts';
import { decidirReenvio } from './retry-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[verify-failed-deliveries]';
const LOTE_VARREDURA = 50;

const CAMPOS = 'id, tenant_id, conversation_id, instance_id, message_id, content, message_type, media_path, media_mimetype, media_filename, media_kind, status, is_from_me, metadata, remote_jid, sent_by_user_id, last_error_at, delivery_confirmed_at, failure_confirmed_at, auto_retry_count';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function janelaSegundos(supabase: any): Promise<number> {
  const { data } = await supabase
    .from('whatsapp_delivery_config')
    .select('confirm_window_seconds')
    .eq('id', 1)
    .maybeSingle();
  return data?.confirm_window_seconds ?? 20;
}

/**
 * Segunda fonte: a própria Evolution guarda o status da mensagem no store dela.
 * Só serve para RESGATAR — se ela disser que entregou, abortamos o alarme.
 * Se estiver fora do ar, seguimos: o ERROR do provedor continua sendo uma afirmação
 * explícita de falha, e a indisponibilidade da segunda fonte não a torna menos verdadeira.
 */
async function provedorRegistraEntrega(supabase: any, msg: any): Promise<boolean> {
  const { data: inst } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name, provider_type')
    .eq('id', msg.instance_id)
    .maybeSingle();
  if (!inst || inst.provider_type !== 'self_hosted') return false;

  try {
    const secrets: any = await getInstanceSecrets(supabase, inst.id);
    if (!secrets?.api_url || !secrets?.api_key) return false;
    const base = String(secrets.api_url).replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/findMessages/${inst.instance_name}`, {
      method: 'POST',
      headers: { apikey: secrets.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { id: msg.message_id } } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const st = String((await res.json())?.messages?.records?.[0]?.status ?? '').toUpperCase();
    return st === 'DELIVERY_ACK' || st === 'READ' || st === 'PLAYED';
  } catch (e) {
    console.warn(`${LOG} segunda fonte indisponível para ${msg.message_id}: ${(e as Error)?.message}`);
    return false;
  }
}

async function avisar(supabase: any, msg: any): Promise<void> {
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('id, assigned_to, department_id')
    .eq('id', msg.conversation_id)
    .maybeSingle();

  let alvos: string[] = [];
  if (msg.sent_by_user_id) {
    alvos = [msg.sent_by_user_id];
  } else if (conv?.assigned_to) {
    alvos = [conv.assigned_to];
  } else if (conv?.department_id) {
    const { data: membros } = await supabase
      .from('support_department_members')
      .select('user_id')
      .eq('tenant_id', msg.tenant_id)
      .eq('department_id', conv.department_id)
      .eq('is_active', true);
    alvos = (membros ?? []).map((m: any) => m.user_id).filter(Boolean);
  }

  if (alvos.length === 0) {
    console.warn(`${LOG} sem destinatário para msg=${msg.id}; alarme fica só na bolha`);
    return;
  }

  // dedupe_key = conversa. Com cooldown_minutes=10 no tipo do evento, isso É o
  // agrupamento: 1 notificação por conversa a cada 10 min, e o contador sai de
  // notification_incidents.occurrences. Sem isso, a queda de uma instância vira 17
  // pings seguidos e o agente desliga a notificação na terceira.
  const { error } = await supabase.rpc('notify_event', {
    p_tenant_id: msg.tenant_id,
    p_event_type: 'whatsapp_message_failed',
    p_dedupe_key: `conv:${msg.conversation_id}`,
    p_title: 'Mensagem não entregue',
    p_body: 'Uma mensagem não chegou ao cliente, mesmo após o reenvio automático. Abra a conversa para reenviar.',
    p_metadata: {
      target_user_ids: alvos,
      conversation_id: msg.conversation_id,
      message_id: msg.id,
    },
    p_action_url: `/whatsapp?conversation=${msg.conversation_id}`,
  });
  if (error) console.error(`${LOG} notify_event falhou para msg=${msg.id}:`, error.message);
}

async function verificar(supabase: any, msg: any): Promise<string> {
  // Condições 1 e 3: nada de ack positivo, e nunca chegou a `sent`.
  if (msg.status !== 'error') return 'subiu-na-escada';
  if (msg.delivery_confirmed_at) return 'entregue';

  // Condição 2: a segunda fonte não contradiz.
  if (await provedorRegistraEntrega(supabase, msg)) {
    await supabase
      .from('whatsapp_messages')
      .update({ status: 'delivered', delivery_confirmed_at: new Date().toISOString() })
      .eq('id', msg.id);
    return 'resgatada-pela-segunda-fonte';
  }

  await supabase
    .from('whatsapp_messages')
    .update({ failure_confirmed_at: new Date().toISOString() })
    .eq('id', msg.id);

  // Em grupo, reenviar é pior do que não reenviar: o ack de falha é por participante e
  // a mensagem provavelmente chegou aos outros. Ver retry-policy.ts.
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('is_group')
    .eq('id', msg.conversation_id)
    .maybeSingle();

  const decisao = decidirReenvio({
    isGroup: conv?.is_group === true,
    messageType: msg.message_type,
    autoRetryCount: msg.auto_retry_count,
  });

  let tentouReenvio = false;
  if (decisao.reenviar) {
    tentouReenvio = true;
    const out = await resendMessage(supabase, msg, { actorUserId: null, automatic: true });
    if (out.ok) return 'reenviada-automaticamente';
    console.error(`${LOG} reenvio automático falhou msg=${msg.id}: ${out.error}`);
  } else {
    console.log(`${LOG} sem reenvio automático msg=${msg.id}: ${decisao.motivo}`);
  }

  await supabase
    .from('whatsapp_messages')
    .update({
      status: 'failed',
      metadata: {
        ...(msg.metadata ?? {}),
        send_error: {
          origem: 'verify-failed-deliveries',
          motivo: tentouReenvio
            ? 'sem confirmação de entrega após a janela, e o reenvio automático também falhou'
            : `sem confirmação de entrega após a janela; sem reenvio automático (${decisao.motivo})`,
          at: new Date().toISOString(),
        },
      },
    })
    .eq('id', msg.id);

  if (decisao.alarmar) {
    await avisar(supabase, msg);
    return 'falha-confirmada';
  }
  return 'falha-registrada-sem-alarme';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* varredura do cron manda corpo vazio */ }

    const janela = await janelaSegundos(supabase);

    if (body?.messageId) {
      // Modo alvo: espera o que falta da janela e verifica uma mensagem só.
      const { data: msg } = await supabase
        .from('whatsapp_messages')
        .select(CAMPOS)
        .eq('tenant_id', body.tenantId)
        .eq('message_id', body.messageId)
        .maybeSingle();
      if (!msg) return json({ ok: true, reason: 'not_found' });

      const desde = msg.last_error_at ? Date.now() - Date.parse(msg.last_error_at) : 0;
      const faltam = Math.max(0, janela * 1000 - desde);
      if (faltam > 0) await sleep(faltam);

      // Reler DEPOIS da espera: nesses 20s pode ter chegado o ack de outro dispositivo,
      // e é exatamente essa releitura que impede o alarme falso.
      const { data: fresca } = await supabase
        .from('whatsapp_messages')
        .select(CAMPOS)
        .eq('id', msg.id)
        .maybeSingle();
      if (!fresca) return json({ ok: true, reason: 'apagada' });

      const r = await verificar(supabase, fresca);
      console.log(`${LOG} alvo ${msg.message_id} -> ${r}`);
      return json({ ok: true, result: r });
    }

    // Modo varredura: rede de segurança para o que o caminho rápido perdeu — isolate
    // morto, webhook perdido, deploy no meio. É justamente o caso que este fluxo existe
    // para pegar; não pode depender de um único caminho.
    const { data: pendentes } = await supabase
      .from('whatsapp_messages')
      .select(CAMPOS)
      .eq('status', 'error')
      .is('failure_confirmed_at', null)
      .is('delivery_confirmed_at', null)
      .lt('last_error_at', new Date(Date.now() - janela * 1000).toISOString())
      .order('last_error_at', { ascending: true })
      .limit(LOTE_VARREDURA);

    const resultados: Record<string, number> = {};
    for (const msg of pendentes ?? []) {
      const r = await verificar(supabase, msg);
      resultados[r] = (resultados[r] ?? 0) + 1;
    }
    console.log(`${LOG} varredura: ${JSON.stringify(resultados)} de ${(pendentes ?? []).length}`);
    return json({ ok: true, varridas: (pendentes ?? []).length, resultados });
  } catch (err: any) {
    console.error(`${LOG} Unexpected:`, err?.message || err);
    return json({ ok: false, error: 'Erro interno' }, 500);
  }
});
