import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

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
    } else {
      replyMessage = `❓ Comando não reconhecido: *${command}*\n\nComandos disponíveis:\n\n` +
        `▪ *LIMIT UP suggest* — dobra limite de Sugestão de Respostas\n` +
        `▪ *LIMIT UP compose* — dobra limite de Composição\n` +
        `▪ *LIMIT UP sentiment* — dobra limite de Sentimento\n` +
        `▪ *LIMIT UP summary* — dobra limite de Resumo\n` +
        `▪ *LIMIT UP audio* — dobra limite de Transcrição\n` +
        `▪ *LIMIT UP ALL* — dobra todos os limites\n` +
        `▪ *STATUS IA* — ver uso atual de todas as funções`;
    }

    // Enviar resposta via Evolution API
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .limit(1)
      .maybeSingle();

    if (instance) {
      const { data: secrets } = await supabase
        .from('whatsapp_instance_secrets')
        .select('api_url, api_key')
        .eq('instance_id', instance.id)
        .single();

      if (secrets) {
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
