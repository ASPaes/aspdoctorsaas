import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendAdminWhatsApp(
  supabase: any,
  adminInstanceName: string,
  adminPhone: string,
  text: string
): Promise<boolean> {
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name')
    .eq('instance_name', adminInstanceName)
    .limit(1)
    .maybeSingle();
  if (!instance) {
    console.error('[check-ai-usage-alert] Instancia admin nao encontrada:', adminInstanceName);
    return false;
  }
  const secrets = await getInstanceSecrets(supabase, instance.id);
  if (!secrets.api_key || !secrets.api_url) {
    console.error('[check-ai-usage-alert] Secrets ausentes para instancia:', adminInstanceName);
    return false;
  }
  const baseUrl = secrets.api_url.replace(/\/$/, '').replace(/\/manager$/, '');
  const endpoint = `${baseUrl}/message/sendText/${adminInstanceName}`;
  const evoResp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: secrets.api_key },
    body: JSON.stringify({ number: adminPhone, text }),
  });
  if (!evoResp.ok) {
    console.error('[check-ai-usage-alert] Falha ao enviar WhatsApp:', await evoResp.text());
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: alertConfig } = await supabase
      .from('ai_alert_config')
      .select('*')
      .limit(1)
      .single();

    if (!alertConfig) {
      console.error('[check-ai-usage-alert] Configuracao de alerta nao encontrada');
      return new Response(JSON.stringify({ ok: false, error: 'config_not_found' }), { status: 200 });
    }

    const { admin_phone, admin_instance_name, warning_threshold, critical_threshold } = alertConfig;
    const alertsSent: string[] = [];

    // ============================================================
    // BLOCO 1 — Teto de CHAMADAS (rate limit) — comportamento existente
    // ============================================================
    const { data: limitConfigs } = await supabase
      .from('ai_rate_limit_config')
      .select('tenant_id, function_name, max_calls, window_seconds');

    for (const config of (limitConfigs || [])) {
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

      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: recentAlert } = await supabase
        .from('ai_alert_log')
        .select('id', { count: 'exact', head: true })
        .eq('function_name', config.function_name)
        .eq('level', level)
        .gte('sent_at', fifteenMinAgo)
        .is('resolved_at', null);

      if (level === 'warning' && (recentAlert ?? 0) > 0) continue;

      const funcNames: Record<string, string> = {
        'suggest-smart-replies': 'Sugestao de Respostas',
        'compose-whatsapp-message': 'Composicao de Mensagem',
        'analyze-whatsapp-sentiment': 'Analise de Sentimento',
        'generate-conversation-summary': 'Resumo de Conversa',
        'transcribe-whatsapp-audio': 'Transcricao de Audio',
      };
      const funcName = funcNames[config.function_name] || config.function_name;
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      let message = '';

      if (level === 'warning') {
        message = `🟡 *DoctorSaaS — Aviso de Uso de IA*\n\n` +
          `▪ Funcao: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} chamadas (${pct}%)\n` +
          `▪ Horario: ${now}\n\n` +
          `💡 *O que fazer agora:*\n` +
          `Nenhuma acao urgente. Monitore o proximo ciclo de 15 minutos.\n\n` +
          `_Proximo alerta apenas se piorar._`;
      } else if (level === 'critical') {
        message = `🔴 *DoctorSaaS — USO CRITICO DE IA*\n\n` +
          `▪ Funcao: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} chamadas (${pct}%)\n` +
          `▪ Horario: ${now}\n\n` +
          `⚡ *Acao imediata — aumente o limite respondendo:*\n\n` +
          `LIMIT UP ${config.function_name}\n\n` +
          `_Efeito imediato. Proximo alerta em 15 min se nao resolver._`;
      } else if (level === 'blocked') {
        message = `⛔ *DoctorSaaS — LIMITE ATINGIDO*\n\n` +
          `Usuarios estao recebendo ERRO agora!\n\n` +
          `▪ Funcao: *${funcName}*\n` +
          `▪ Uso: ${usage}/${config.max_calls} — *BLOQUEADO*\n` +
          `▪ Horario: ${now}\n\n` +
          `🔧 *Solucao imediata — responda agora:*\n\n` +
          `LIMIT UP ${config.function_name}\n\n` +
          `_Para dobrar o limite de todas as funcoes: responda_ LIMIT UP ALL\n` +
          `_Proximo alerta em 15 min se nao resolver._`;
      }

      const ok = await sendAdminWhatsApp(supabase, admin_instance_name, admin_phone, message);
      if (ok) {
        await supabase.from('ai_alert_log').insert({
          tenant_id: config.tenant_id,
          function_name: config.function_name,
          level,
        });
        alertsSent.push(`${config.function_name}:${level}`);
      }
    }

    // ============================================================
    // BLOCO 2 — Teto de GASTO ($) mensal por tenant (novo)
    // ============================================================
    const { data: budgetRows } = await supabase
      .from('configuracoes')
      .select('tenant_id, ai_monthly_budget_usd, ai_budget_alert_pct')
      .not('ai_monthly_budget_usd', 'is', null);

    // Nomes dos tenants sem depender de FK/embed (nao existe FK configuracoes->tenants)
    const tenantIds = (budgetRows || []).map((r: any) => r.tenant_id);
    const nameMap: Record<string, string> = {};
    if (tenantIds.length > 0) {
      const { data: tnames } = await supabase.from('tenants').select('id, nome').in('id', tenantIds);
      for (const t of (tnames || [])) nameMap[t.id] = t.nome;
    }

    for (const row of (budgetRows || [])) {
      const budget = Number(row.ai_monthly_budget_usd);
      if (!(budget > 0)) continue;

      const { data: spendData } = await supabase.rpc('ai_month_spend_usd', { p_tenant_id: row.tenant_id });
      const spend = Number(spendData) || 0;
      const pct = Math.round((spend / budget) * 100);
      const alertPct = row.ai_budget_alert_pct ?? 80;

      let level: string | null = null;
      if (spend >= budget) level = 'blocked';
      else if (pct >= alertPct) level = 'warning';
      if (!level) continue;

      const windowAgo = new Date(Date.now() - (level === 'blocked' ? 6 : 24) * 60 * 60 * 1000).toISOString();
      const { count: recent } = await supabase
        .from('ai_alert_log')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', row.tenant_id)
        .eq('function_name', 'monthly_budget')
        .eq('level', level)
        .gte('sent_at', windowAgo);
      if ((recent ?? 0) > 0) continue;

      const nome = nameMap[row.tenant_id] || row.tenant_id;
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      let message = '';

      if (level === 'warning') {
        message = `🟡 *DoctorSaaS — Gasto de IA em ${pct}%*\n\n` +
          `▪ Tenant: *${nome}*\n` +
          `▪ Gasto do mes: US$ ${spend.toFixed(2)} / US$ ${budget.toFixed(2)}\n` +
          `▪ Horario: ${now}\n\n` +
          `💡 Acompanhe. Ao atingir 100%, a analise de sentimento deste tenant e pausada automaticamente ate virar o mes ou aumentar o teto.`;
      } else {
        message = `⛔ *DoctorSaaS — TETO DE IA ATINGIDO*\n\n` +
          `▪ Tenant: *${nome}*\n` +
          `▪ Gasto do mes: US$ ${spend.toFixed(2)} / US$ ${budget.toFixed(2)} (${pct}%)\n` +
          `▪ Horario: ${now}\n\n` +
          `🔧 A analise de sentimento deste tenant esta PAUSADA. Para religar: aumente o teto em Configuracoes ou aguarde virar o mes.`;
      }

      const ok = await sendAdminWhatsApp(supabase, admin_instance_name, admin_phone, message);
      if (ok) {
        await supabase.from('ai_alert_log').insert({
          tenant_id: row.tenant_id,
          function_name: 'monthly_budget',
          level,
        });
        alertsSent.push(`monthly_budget:${nome}:${level}`);
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
