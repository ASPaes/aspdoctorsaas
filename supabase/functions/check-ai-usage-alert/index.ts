import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Buscar configuração de alertas
    const { data: alertConfig } = await supabase
      .from('ai_alert_config')
      .select('*')
      .limit(1)
      .single();

    if (!alertConfig) {
      console.error('[check-ai-usage-alert] Configuração de alerta não encontrada');
      return new Response(JSON.stringify({ ok: false, error: 'config_not_found' }), { status: 200 });
    }

    const { admin_phone, admin_instance_name, warning_threshold, critical_threshold } = alertConfig;

    // Buscar limites configurados
    const { data: limitConfigs } = await supabase
      .from('ai_rate_limit_config')
      .select('tenant_id, function_name, max_calls, window_seconds');

    if (!limitConfigs || limitConfigs.length === 0) return new Response(JSON.stringify({ ok: true }), { status: 200 });

    const alertsSent: string[] = [];

    for (const config of limitConfigs) {
      const windowStart = new Date(Date.now() - config.window_seconds * 1000).toISOString();

      const { count } = await supabase
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .eq('function_name', config.function_name)
        .gte('called_at', windowStart);

      const usage = count ?? 0;
      const pct = Math.round((usage / config.max_calls) * 100);

      let level: string | null = null;
      if (usage >= config.max_calls) level = 'blocked';
      else if (pct >= critical_threshold) level = 'critical';
      else if (pct >= warning_threshold) level = 'warning';

      if (!level) continue;

      // Anti-spam: verificar se já enviamos esse nível nos últimos 15 min (exceto blocked/critical que repetem)
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: recentAlert } = await supabase
        .from('ai_alert_log')
        .select('id', { count: 'exact', head: true })
        .eq('function_name', config.function_name)
        .eq('level', level)
        .gte('sent_at', fifteenMinAgo)
        .is('resolved_at', null);

      // Warning: só manda 1x por ciclo. Critical/Blocked: manda a cada 15min
      if (level === 'warning' && (recentAlert ?? 0) > 0) continue;

      // Mapear nome da função para português
      const funcNames: Record<string, string> = {
        'suggest-smart-replies': 'Sugestão de Respostas',
        'compose-whatsapp-message': 'Composição de Mensagem',
        'analyze-whatsapp-sentiment': 'Análise de Sentimento',
        'generate-conversation-summary': 'Resumo de Conversa',
        'transcribe-whatsapp-audio': 'Transcrição de Áudio',
      };
      const funcName = funcNames[config.function_name] || config.function_name;

      // Montar mensagem por nível
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      let message = '';

      if (level === 'warning') {
        message = `🟡 *DoctorSaaS — Aviso de Uso de IA*\n\n` +
          `▪ Função: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} chamadas (${pct}%)\n` +
          `▪ Horário: ${now}\n\n` +
          `💡 *O que fazer agora:*\n` +
          `Nenhuma ação urgente. Monitore o próximo ciclo de 15 minutos.\n\n` +
          `_Próximo alerta apenas se piorar._`;
      } else if (level === 'critical') {
        message = `🔴 *DoctorSaaS — USO CRÍTICO DE IA*\n\n` +
          `▪ Função: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} chamadas (${pct}%)\n` +
          `▪ Horário: ${now}\n\n` +
          `⚡ *Ação imediata — aumente o limite respondendo:*\n\n` +
          `LIMIT UP ${config.function_name}\n\n` +
          `_Efeito imediato. Próximo alerta em 15 min se não resolver._`;
      } else if (level === 'blocked') {
        message = `⛔ *DoctorSaaS — LIMITE ATINGIDO*\n\n` +
          `Usuários estão recebendo ERRO agora!\n\n` +
          `▪ Função: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} — *BLOQUEADO*\n` +
          `▪ Horário: ${now}\n\n` +
          `🔧 *Solução imediata — responda agora:*\n\n` +
          `LIMIT UP ${config.function_name}\n\n` +
          `_Para dobrar o limite de todas as funções: responda_ LIMIT UP ALL\n` +
          `_Próximo alerta em 15 min se não resolver._`;
      }

      // Buscar secrets da instância
      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name')
        .eq('instance_name', admin_instance_name)
        .limit(1)
        .maybeSingle();

      if (!instance) {
        console.error('[check-ai-usage-alert] Instância não encontrada:', admin_instance_name);
        continue;
      }

      const { data: secrets } = await supabase
        .from('whatsapp_instance_secrets')
        .select('api_url, api_key')
        .eq('instance_id', instance.id)
        .single();

      if (!secrets) {
        console.error('[check-ai-usage-alert] Secrets não encontrados para instância:', admin_instance_name);
        continue;
      }

      // Enviar via Evolution API (direto, sem criar conversa no DoctorSaaS)
      const baseUrl = secrets.api_url.replace(/\/$/, '').replace(/\/manager$/, '');
      const endpoint = `${baseUrl}/message/sendText/${admin_instance_name}`;

      const evoResp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: secrets.api_key },
        body: JSON.stringify({ number: admin_phone, text: message }),
      });

      if (evoResp.ok) {
        // Registrar alerta enviado
        await supabase.from('ai_alert_log').insert({
          tenant_id: config.tenant_id,
          function_name: config.function_name,
          level,
        });
        alertsSent.push(`${config.function_name}:${level}`);
        console.log(`[check-ai-usage-alert] ✅ Alerta ${level} enviado para ${config.function_name}`);
      } else {
        console.error('[check-ai-usage-alert] Falha ao enviar WhatsApp:', await evoResp.text());
      }
    }

    return new Response(JSON.stringify({ ok: true, alerts_sent: alertsSent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[check-ai-usage-alert] Erro:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
