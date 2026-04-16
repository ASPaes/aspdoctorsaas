import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const ADMIN_PHONE = '5549991210660';

const FUNCTION_ALIASES: Record<string, string> = {
  'suggest': 'suggest-smart-replies',
  'compose': 'compose-whatsapp-message',
  'sentiment': 'analyze-whatsapp-sentiment',
  'summary': 'generate-conversation-summary',
  'audio': 'transcribe-whatsapp-audio',
};

const FUNCTION_NAMES_PT: Record<string, string> = {
  'suggest-smart-replies': 'Sugestão de Respostas',
  'compose-whatsapp-message': 'Composição de Mensagem',
  'analyze-whatsapp-sentiment': 'Análise de Sentimento',
  'generate-conversation-summary': 'Resumo de Conversa',
  'transcribe-whatsapp-audio': 'Transcrição de Áudio',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null);

  try {
    const { senderPhone, command } = await req.json();

    // Segurança: só aceita comandos do número admin
    const cleanSender = senderPhone.replace(/\D/g, '');
    if (!cleanSender.includes(ADMIN_PHONE.replace(/\D/g, ''))) {
      console.warn('[ai-admin-commands] Número não autorizado:', cleanSender);
      return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: alertConfig } = await supabase
      .from('ai_alert_config')
      .select('admin_phone, admin_instance_name')
      .limit(1)
      .single();

    const instanceName = alertConfig?.admin_instance_name || 'Financeiro';
    const adminPhone = alertConfig?.admin_phone || ADMIN_PHONE;

    const cmd = command.trim().toUpperCase();
    let replyMessage = '';

    // --- LIMIT UP ---
    if (cmd.startsWith('LIMIT UP')) {
      const parts = cmd.split(' ');
      const target = parts[2]?.toLowerCase();

      if (target === 'all' || !target) {
        // Dobrar todos os limites
        const { data: configs } = await supabase
          .from('ai_rate_limit_config')
          .select('function_name, max_calls')
          .is('tenant_id', null);

        for (const c of configs || []) {
          await supabase
            .from('ai_rate_limit_config')
            .update({ max_calls: c.max_calls * 2, updated_at: new Date().toISOString() })
            .eq('function_name', c.function_name)
            .is('tenant_id', null);
        }

        // Marcar alertas como resolvidos
        await supabase
          .from('ai_alert_log')
          .update({ resolved_at: new Date().toISOString() })
          .is('resolved_at', null);

        replyMessage = `✅ *Limites dobrados para todas as funções!*\n\nEfeito imediato. Monitore os próximos 15 minutos.\n\nResponda *STATUS IA* para ver o estado atual.`;

      } else {
        const funcName = FUNCTION_ALIASES[target] || target;
        const { data: current } = await supabase
          .from('ai_rate_limit_config')
          .select('max_calls')
          .eq('function_name', funcName)
          .is('tenant_id', null)
          .maybeSingle();

        if (!current) {
          replyMessage = `❌ Função não encontrada: *${target}*\n\nFunções disponíveis:\n▪ suggest\n▪ compose\n▪ sentiment\n▪ summary\n▪ audio`;
        } else {
          const newLimit = current.max_calls * 2;
          await supabase
            .from('ai_rate_limit_config')
            .update({ max_calls: newLimit, updated_at: new Date().toISOString() })
            .eq('function_name', funcName)
            .is('tenant_id', null);

          await supabase
            .from('ai_alert_log')
            .update({ resolved_at: new Date().toISOString() })
            .eq('function_name', funcName)
            .is('resolved_at', null);

          const nameP = FUNCTION_NAMES_PT[funcName] || funcName;
          replyMessage = `✅ *Limite aumentado!*\n\n▪ Função: *${nameP}*\n▪ Novo limite: *${newLimit} chamadas/min*\n\nEfeito imediato.`;
        }
      }

    // --- STATUS IA ---
    } else if (cmd === 'STATUS IA') {
      const { data: configs } = await supabase
        .from('ai_rate_limit_config')
        .select('function_name, max_calls, window_seconds')
        .is('tenant_id', null);

      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      let statusMsg = `📊 *DoctorSaaS — Status de Uso de IA*\n_${now}_\n\n`;

      for (const c of configs || []) {
        const windowStart = new Date(Date.now() - c.window_seconds * 1000).toISOString();
        const { count } = await supabase
          .from('ai_usage_log')
          .select('id', { count: 'exact', head: true })
          .eq('function_name', c.function_name)
          .gte('called_at', windowStart);

        const usage = count ?? 0;
        const pct = Math.round((usage / c.max_calls) * 100);
        const nameP = FUNCTION_NAMES_PT[c.function_name] || c.function_name;
        const emoji = usage >= c.max_calls ? '⛔' : pct >= 90 ? '🔴' : pct >= 70 ? '🟡' : '🟢';

        statusMsg += `${emoji} *${nameP}*\n   ${usage}/${c.max_calls} chamadas (${pct}%)\n\n`;
      }

      statusMsg += `_Responda_ LIMIT UP ALL _para dobrar todos os limites._`;
      replyMessage = statusMsg;

    // --- Comando não reconhecido ---
    } else if (cmd === 'SIM DB' || cmd === 'NAO DB' || cmd === 'NÃO DB' || cmd === 'DEPOIS DB') {

      // Find the most recent pending/sent DB health alert
      const { data: pendingAlert } = await supabase
        .from('db_health_action_log')
        .select('id, check_name, diagnosis, recommended_action, level')
        .in('status', ['sent', 'snoozed'])
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pendingAlert) {
        replyMessage = `\u2139\uFE0F Nenhum alerta DB pendente encontrado.`;
      } else if (cmd === 'SIM DB') {
        // Execute the recommended action
        try {
          await supabase.rpc('exec_db_health_query', {
            query_text: pendingAlert.recommended_action
          });
          await supabase
            .from('db_health_action_log')
            .update({ status: 'resolved', resolved_at: new Date().toISOString(), response: 'SIM DB', responded_at: new Date().toISOString() })
            .eq('id', pendingAlert.id);
          replyMessage = `\u2705 *A\u00E7\u00E3o executada com sucesso!*\n\n\uD83D\uDCCB *Alerta:* ${pendingAlert.diagnosis}\n\uD83D\uDCA1 *Executado:* ${pendingAlert.recommended_action}\n\nBanco atualizado.`;
        } catch (execErr) {
          replyMessage = `\u274C *Erro ao executar a\u00E7\u00E3o:*\n${String(execErr)}\n\nVerifique manualmente no Supabase SQL Editor.`;
        }
      } else if (cmd === 'NAO DB' || cmd === 'NÃO DB') {
        await supabase
          .from('db_health_action_log')
          .update({ status: 'dismissed', response: 'NÃO DB', responded_at: new Date().toISOString() })
          .eq('id', pendingAlert.id);
        replyMessage = `\u274C *Alerta ignorado.*\n\n\uD83D\uDCCB ${pendingAlert.diagnosis}\n\nO pr\u00F3ximo check ocorre no hor\u00E1rio programado.`;
      } else if (cmd === 'DEPOIS DB') {
        await supabase
          .from('db_health_action_log')
          .update({ status: 'snoozed', response: 'DEPOIS DB', responded_at: new Date().toISOString() })
          .eq('id', pendingAlert.id);
        // Schedule a reminder in 2 hours via pg_cron (one-time)
        const runAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const cronMin = runAt.getUTCMinutes();
        const cronHour = runAt.getUTCHours();
        const cronDay = runAt.getUTCDate();
        const cronMonth = runAt.getUTCMonth() + 1;
        await supabase.rpc('exec_db_health_query', {
          query_text: `SELECT cron.schedule('db-health-snooze-${pendingAlert.id.slice(0,8)}', '${cronMin} ${cronHour} ${cronDay} ${cronMonth} *', $$SELECT net.http_post(url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/check-db-health', headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb, body := '{}'::jsonb)$$)`
        });
        replyMessage = `\u23F0 *Lembrete agendado para 2h.*\n\n\uD83D\uDCCB ${pendingAlert.diagnosis}\n\nVoc\u00EA ser\u00E1 avisado novamente \u00E0s ${runAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}h.`;
      }

    } else {
      replyMessage = `\u2753 Comando n\u00E3o reconhecido: *${command}*\n\nComandos dispon\u00EDveis:\n\n` +
        `\u25AA *LIMIT UP suggest* \u2014 dobra limite de Sugest\u00E3o de Respostas\n` +
        `\u25AA *LIMIT UP compose* \u2014 dobra limite de Composi\u00E7\u00E3o\n` +
        `\u25AA *LIMIT UP sentiment* \u2014 dobra limite de Sentimento\n` +
        `\u25AA *LIMIT UP summary* \u2014 dobra limite de Resumo\n` +
        `\u25AA *LIMIT UP audio* \u2014 dobra limite de Transcri\u00E7\u00E3o\n` +
        `\u25AA *LIMIT UP ALL* \u2014 dobra todos os limites\n` +
        `\u25AA *STATUS IA* \u2014 ver uso atual de todas as fun\u00E7\u00F5es\n` +
        `\u25AA *SIM DB* \u2014 confirmar a\u00E7\u00E3o de alerta DB\n` +
        `\u25AA *N\u00C3O DB* \u2014 ignorar alerta DB\n` +
        `\u25AA *DEPOIS DB* \u2014 lembrar em 2h`;
    }

    // Enviar resposta via Evolution API
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .limit(1)
      .maybeSingle();

    if (instance) {
      const secrets = await getInstanceSecrets(supabase, instance.id);

      if (secrets.api_key && secrets.api_url) {
        const baseUrl = secrets.api_url.replace(/\/$/, '').replace(/\/manager$/, '');
        await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: secrets.api_key },
          body: JSON.stringify({ number: adminPhone, text: replyMessage }),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });

  } catch (error) {
    console.error('[ai-admin-commands] Erro:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
