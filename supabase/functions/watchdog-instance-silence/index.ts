// Watchdog de silêncio de eventos (sessão zumbi Evolution) — v4
// Sinal mestre: last_event_at (alimentado pelo evolution-webhook a cada evento, throttle 60s).
//
// v4 (09/07/2026):
// - REMOVIDA a regra "no_ack": instâncias Evolution não recebem MESSAGES_UPDATE (0 ACKs em 3 dias
//   de dados), então "nenhum evento de entrega retornou" era sempre verdadeiro por construção.
//   Na prática a regra disparava em "rajada de envios + 10 min sem inbound" = rotina de suporte.
//   Falsos positivos confirmados: Consysa 09/07 08:22, Liberty 09/07 11:02 (flapping em 2 min).
//   Será reintroduzida quando o pipeline de ACK (MESSAGES_UPDATE) estiver ativo — Fases 2 e 3.
// - REMOVIDO o alerta tenant-facing (notify_event): alerta de suspeita é operação de plataforma;
//   tenant admin não tem contexto pra agir e interpretava como "sistema quebrado".
//   O alerta vai SOMENTE para os números de ai_alert_config (admin da plataforma).
//
// Regra ativa (assimetria): 5+ outbound / 0 inbound em 30 min E eventos mudos há 10+ min
//   (last_event_at nulo ou 10+ min). Eventos frescos = instância viva.
// Ação: SÓ ALERTA — WhatsApp direto pros números de ai_alert_config, com fallback de emissora.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const EVENT_SILENCE_MIN = 10;
const MIN_OUT_30M = 5;
const COOLDOWN_MIN = 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: instances, error: instErr } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, instance_name, display_name, tenant_id, provider_type, status, is_active, silence_alert_at, last_event_at')
      .eq('status', 'connected')
      .in('provider_type', ['self_hosted', 'cloud']);
    if (instErr) throw new Error(instErr.message);

    const { data: signals, error: sigErr } = await supabaseAdmin.rpc('fn_watchdog_signals');
    if (sigErr) throw new Error(sigErr.message);
    const sigMap = new Map<string, { out_30m: number; in_30m: number }>();
    for (const s of signals ?? []) sigMap.set(s.instance_id, { out_30m: Number(s.out_30m), in_30m: Number(s.in_30m) });

    const now = Date.now();
    const suspects: any[] = [];
    const recovered: any[] = [];

    for (const inst of instances ?? []) {
      if (inst.is_active === false) continue;
      const s = sigMap.get(inst.id) ?? { out_30m: 0, in_30m: 0 };
      const lastEventAge = inst.last_event_at ? now - Date.parse(inst.last_event_at) : null;
      const eventsStale = lastEventAge === null || lastEventAge > EVENT_SILENCE_MIN * 60_000;

      // assimetria: enviando bastante, recebendo nada, e eventos TAMBÉM sumiram — evento fresco = instância viva
      const asymmetry = s.out_30m >= MIN_OUT_30M && s.in_30m === 0 && eventsStale;

      if (asymmetry) {
        const lastAlert = inst.silence_alert_at ? Date.parse(inst.silence_alert_at) : 0;
        if (now - lastAlert >= COOLDOWN_MIN * 60_000) {
          suspects.push({ inst, s, reason: 'asymmetry' });
        }
      } else if (inst.silence_alert_at && (s.in_30m > 0 || (lastEventAge !== null && lastEventAge < 5 * 60_000))) {
        recovered.push(inst);
      }
    }

    for (const inst of recovered) {
      // limpa incidentes tenant-facing legados (v3 criava via notify_event)
      await supabaseAdmin.rpc('resolve_notification_incident', {
        p_tenant_id: inst.tenant_id,
        p_event_type: 'whatsapp_instance_disconnected',
        p_dedupe_key: inst.id,
      });
      await supabaseAdmin.from('whatsapp_instances').update({ silence_alert_at: null }).eq('id', inst.id);
      console.log(`[watchdog] Recuperada: ${inst.instance_name}`);
    }

    if (suspects.length === 0) return json({ ok: true, suspects: 0, recovered: recovered.length });

    const { data: alertConfig } = await supabaseAdmin
      .from('ai_alert_config')
      .select('admin_phone, admin_instance_name, extra_alert_phones')
      .single();

    const alerted: string[] = [];
    for (const { inst, s, reason } of suspects) {
      const { data: tenant } = await supabaseAdmin.from('tenants').select('nome').eq('id', inst.tenant_id).single();
      const detail = `enviou ${s.out_30m} mensagens nos últimos 30 min sem receber nenhuma e sem eventos do servidor há ${EVENT_SILENCE_MIN}+ min`;

      try {
        if (alertConfig?.admin_instance_name && alertConfig?.admin_phone) {
          let senderName = alertConfig.admin_instance_name;
          let { data: sender } = await supabaseAdmin
            .from('whatsapp_instances')
            .select('id, instance_name, status')
            .eq('instance_name', senderName)
            .single();

          if (!sender || sender.id === inst.id || sender.status !== 'connected') {
            const { data: alt } = await supabaseAdmin
              .from('whatsapp_instances')
              .select('id, instance_name')
              .eq('status', 'connected')
              .eq('is_active', true)
              .in('provider_type', ['self_hosted', 'cloud'])
              .neq('id', inst.id)
              .limit(1)
              .maybeSingle();
            if (alt) { sender = alt as any; senderName = alt.instance_name; }
          }

          if (sender) {
            const { data: senderSecrets } = await supabaseAdmin.rpc('get_instance_secrets', { p_instance_id: sender.id });
            if (senderSecrets?.api_url && senderSecrets?.api_key) {
              const base = String(senderSecrets.api_url).replace(/\/$/, '').replace(/\/manager$/, '');
              const msg = [
                `⚠️ *Possível falha de recebimento — DoctorSaaS*`,
                ``,
                `📱 *Instância:* ${inst.instance_name}`,
                `🏢 *Tenant:* ${tenant?.nome || inst.tenant_id}`,
                `📊 *Sinal:* ${detail}`,
                `🕒 *Horário:* ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`,
                ``,
                `A instância consta CONECTADA, mas parou de emitir eventos — mesmo padrão do incidente de 08/07.`,
                ``,
                `💡 *Ação:* Reiniciar instância em Configurações > Canais. Se não resolver, reiniciar o serviço Evolution no Hostinger. Depois, usar Reestabelecer mensagens.`,
              ].join('\n');

              const phones = [alertConfig.admin_phone, ...(alertConfig.extra_alert_phones ?? [])];
              for (const phone of phones) {
                await fetch(`${base}/message/sendText/${senderName}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', apikey: senderSecrets.api_key },
                  body: JSON.stringify({ number: phone, text: msg }),
                });
              }
            }
          }
        }
      } catch (waErr) {
        console.error(`[watchdog] Falha no alerta WhatsApp para ${inst.instance_name}:`, waErr);
      }

      await supabaseAdmin.from('whatsapp_instances').update({ silence_alert_at: new Date().toISOString() }).eq('id', inst.id);
      alerted.push(`${inst.instance_name} (${reason})`);
      console.log(`[watchdog] ALERTA (${reason}): ${inst.instance_name}`);
    }

    return json({ ok: true, suspects: suspects.length, alerted, recovered: recovered.length });
  } catch (error) {
    console.error('[watchdog-instance-silence] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
