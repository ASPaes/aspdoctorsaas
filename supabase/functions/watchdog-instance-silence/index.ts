// Watchdog de silencio de eventos (sessao zumbi Evolution) — v5
// Sinal mestre: last_event_at (alimentado pelo evolution-webhook a cada evento, throttle 60s).
//
// v5 (09/07/2026): CONFIRMACAO ATIVA.
// - A heuristica de assimetria (5+ out / 0 in / eventos mudos 10+ min) virou apenas o GATILHO
//   de "vale checar", nao mais o criterio de alerta. Antes de alertar, o watchdog consulta o
//   connectionState do Evolution da propria instancia suspeita:
//     - state === 'open'  => instancia viva (so quieta) => NAO alerta (mata falso positivo).
//     - state != 'open' / HTTP erro / sem resposta => confirmado real => alerta.
// - Elimina o falso positivo de "noite parada" (operador enviando, cliente sem responder).
// - Limitacao conhecida: zumbi-profundo que responde 'open' mas esta morto so e pego pela Fase 2
//   (pipeline de ACK MESSAGES_UPDATE). Ver learnings/watchdog-instance-silence.md.
//
// v4: removida regra no_ack, removido alerta tenant-facing. Alerta SO admin (ai_alert_config).
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
const PROBE_TIMEOUT_MS = 8000;

// Consulta ativa do estado real da instancia no Evolution.
// alive: true (open) | false (estado != open ou HTTP erro) | null (sem resposta apos retry).
async function probeEvolutionState(base: string, identifier: string, apiKey: string): Promise<{ alive: boolean | null; state: string | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${base}/instance/connectionState/${identifier}`, { headers: { apikey: apiKey }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return { alive: false, state: `http_${res.status}` };
      const data = await res.json();
      const state = data?.state || data?.instance?.state || null;
      return { alive: state === 'open', state };
    } catch (_e) {
      if (attempt === 1) return { alive: null, state: 'no_response' };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { alive: null, state: 'no_response' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: instances, error: instErr } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, instance_name, display_name, tenant_id, provider_type, instance_id_external, status, is_active, silence_alert_at, last_event_at')
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

      // assimetria: enviando bastante, recebendo nada, e eventos TAMBEM sumiram — GATILHO de checagem
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
    const suppressed: string[] = [];
    for (const { inst, s, reason } of suspects) {
      // === CONFIRMACAO ATIVA: so alerta se o Evolution confirmar que a instancia NAO esta 'open' ===
      const { data: suspectSecrets } = await supabaseAdmin.rpc('get_instance_secrets', { p_instance_id: inst.id });
      if (!suspectSecrets?.api_url || !suspectSecrets?.api_key) {
        console.warn(`[watchdog] ${inst.instance_name}: sem secrets pra confirmar — suprimindo (nao cria alarme sem confirmacao)`);
        suppressed.push(`${inst.instance_name} (sem_secrets)`);
        continue;
      }
      const probeBase = String(suspectSecrets.api_url).replace(/\/$/, '').replace(/\/manager$/, '');
      const identifier = (inst.provider_type === 'cloud' && inst.instance_id_external) ? inst.instance_id_external : inst.instance_name;
      const probe = await probeEvolutionState(probeBase, identifier, suspectSecrets.api_key);

      if (probe.alive === true) {
        // instancia viva, so quieta — NAO seta silence_alert_at, reavalia no proximo ciclo
        console.log(`[watchdog] ${inst.instance_name}: connectionState=open (viva, so quieta) — suprimido`);
        suppressed.push(`${inst.instance_name} (open)`);
        continue;
      }

      const confirmLine = probe.alive === false
        ? `Confirmado via Evolution: connectionState = '${probe.state}' (nao 'open'). Instancia caida de verdade.`
        : `A instancia NAO respondeu ao connectionState apos 2 tentativas — servico Evolution pode estar fora.`;

      const { data: tenant } = await supabaseAdmin.from('tenants').select('nome').eq('id', inst.tenant_id).single();
      const detail = `enviou ${s.out_30m} mensagens nos ultimos 30 min sem receber nenhuma e sem eventos do servidor ha ${EVENT_SILENCE_MIN}+ min`;

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
                `⚠️ *Possivel falha de recebimento — DoctorSaaS*`,
                ``,
                `📱 *Instancia:* ${inst.instance_name}`,
                `🏢 *Tenant:* ${tenant?.nome || inst.tenant_id}`,
                `📊 *Sinal:* ${detail}`,
                `✅ *Confirmacao:* ${confirmLine}`,
                `🕒 *Horario:* ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`,
                ``,
                `💡 *Acao:* Reiniciar instancia em Configuracoes > Canais. Se nao resolver, reiniciar o servico Evolution no Hostinger. Depois, usar Reestabelecer mensagens.`,
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
      alerted.push(`${inst.instance_name} (${reason}/${probe.state})`);
      console.log(`[watchdog] ALERTA CONFIRMADO (${reason}, state=${probe.state}): ${inst.instance_name}`);
    }

    return json({ ok: true, suspects: suspects.length, alerted, suppressed, recovered: recovered.length });
  } catch (error) {
    console.error('[watchdog-instance-silence] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
