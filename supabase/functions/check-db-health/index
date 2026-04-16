import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface HealthCheck {
  name: string;
  level: 'ok' | 'warn' | 'critical';
  diagnosis: string;
  action: string;
  value: number;
}

async function getWhatsAppCredentials() {
  const { data: alertConfig } = await supabase
    .from('ai_alert_config')
    .select('admin_phone, admin_instance_name')
    .eq('tenant_id', 'a0000000-0000-0000-0000-000000000001')
    .single();
  if (!alertConfig) throw new Error('Alert config not found');

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name')
    .eq('instance_name', alertConfig.admin_instance_name)
    .single();
  if (!instance) throw new Error('WhatsApp instance not found');

  const { data: secrets } = await supabase
    .from('whatsapp_instance_secrets')
    .select('api_url, api_key')
    .eq('instance_id', instance.id)
    .single();
  if (!secrets?.api_key || !secrets?.api_url) throw new Error('Secrets not found');

  return {
    api_url: secrets.api_url.replace(/\/$/, '').replace(/\/manager$/, ''),
    api_key: secrets.api_key,
    instance_name: instance.instance_name,
    admin_phone: alertConfig.admin_phone,
  };
}

async function sendWhatsApp(creds: any, message: string) {
  const endpoint = `${creds.api_url}/message/sendText/${creds.instance_name}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: creds.api_key },
    body: JSON.stringify({ number: creds.admin_phone, text: message }),
  });
  if (!res.ok) console.error('[check-db-health] WhatsApp send failed:', await res.text());
}

async function runChecks(): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  // 1. Conexões ativas
  try {
    const { data } = await supabase.rpc('exec_db_health_query', {
      query_text: `SELECT count(*)::int as value FROM pg_stat_activity WHERE state = 'active' AND datname = current_database()`
    });
    const value = data?.[0]?.value ?? 0;
    checks.push({
      name: 'conexoes_ativas',
      level: value >= 35 ? 'critical' : value >= 25 ? 'warn' : 'ok',
      diagnosis: `${value} conexões ativas no banco`,
      action: 'Verificar pooler config no Supabase Dashboard → Settings → Database',
      value,
    });
  } catch (e) { console.error('[check-db-health] conexoes_ativas error:', e); }

  // 2. Dead tuples — tabelas críticas
  try {
    const { data } = await supabase.rpc('exec_db_health_query', {
      query_text: `
        SELECT relname as name, n_dead_tup::int as value
        FROM pg_stat_user_tables
        WHERE relname IN ('whatsapp_conversations','whatsapp_messages','support_attendances','whatsapp_conversation_summaries')
        AND n_dead_tup > 500
        ORDER BY n_dead_tup DESC LIMIT 1
      `
    });
    if (data?.[0]) {
      const { name, value } = data[0];
      checks.push({
        name: 'dead_tuples',
        level: value >= 2000 ? 'critical' : 'warn',
        diagnosis: `${value} dead tuples acumulados em ${name}`,
        action: `VACUUM ANALYZE public.${name}`,
        value,
      });
    }
  } catch (e) { console.error('[check-db-health] dead_tuples error:', e); }

  // 3. Query lenta
  try {
    const { data } = await supabase.rpc('exec_db_health_query', {
      query_text: `
        SELECT round(mean_exec_time::numeric, 0)::int as value,
               left(query, 100) as name
        FROM pg_stat_statements
        WHERE mean_exec_time > 2000 AND calls > 100
        AND query NOT ILIKE '%pg_stat%'
        ORDER BY mean_exec_time DESC LIMIT 1
      `
    });
    if (data?.[0]) {
      const { value } = data[0];
      checks.push({
        name: 'query_lenta',
        level: value >= 5000 ? 'critical' : 'warn',
        diagnosis: `Query com média de ${value}ms detectada`,
        action: 'Analisar índices — responda SIM DB para eu detalhar a query',
        value,
      });
    }
  } catch (e) { console.error('[check-db-health] query_lenta error:', e); }

  // 4. Cron bloat
  try {
    const { data } = await supabase.rpc('exec_db_health_query', {
      query_text: `SELECT count(*)::int as value FROM cron.job_run_details`
    });
    const value = data?.[0]?.value ?? 0;
    if (value >= 3000) {
      checks.push({
        name: 'cron_bloat',
        level: value >= 8000 ? 'critical' : 'warn',
        diagnosis: `${value} registros acumulados em cron.job_run_details`,
        action: `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'`,
        value,
      });
    }
  } catch (e) { console.error('[check-db-health] cron_bloat error:', e); }

  return checks;
}

function emoji(level: string) {
  if (level === 'critical') return '🔴';
  if (level === 'warn') return '🟡';
  return '✅';
}

function formatTime() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

Deno.serve(async () => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[check-db-health][${requestId}] Starting health check`);

  try {
    const checks = await runChecks();
    const issues = checks.filter(c => c.level !== 'ok');

    console.log(`[check-db-health][${requestId}] ${checks.length} checks, ${issues.length} issues`);

    if (issues.length === 0) {
      console.log(`[check-db-health][${requestId}] All checks passed — no alert sent`);
      return new Response(JSON.stringify({ ok: true, message: 'All checks passed' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const creds = await getWhatsAppCredentials();
    const hora = formatTime();
    const periodo = new Date().getHours() < 12 ? 'manhã' : 'noite';

    for (const issue of issues) {
      const { data: log, error: logError } = await supabase
        .from('db_health_action_log')
        .insert({
          check_name: issue.name,
          level: issue.level,
          diagnosis: issue.diagnosis,
          recommended_action: issue.action,
          status: 'sent',
        })
        .select('id')
        .single();

      if (logError) console.error(`[check-db-health][${requestId}] Log error:`, logError);

      const shortId = log?.id?.slice(0, 8) ?? 'N/A';

      const msg = [
        `${emoji(issue.level)} *Alerta DB — DoctorSaaS*`,
        `🕐 Check das ${hora} (${periodo})`,
        ``,
        `📋 *Diagnóstico:*`,
        issue.diagnosis,
        ``,
        `💡 *Ação recomendada:*`,
        issue.action,
        ``,
        `Deseja executar agora?`,
        `✅ *SIM DB* — executar ação`,
        `❌ *NÃO DB* — ignorar`,
        `⏰ *DEPOIS DB* — avisar em 2h`,
        ``,
        `🆔 ${shortId}`,
      ].join('\n');

      await sendWhatsApp(creds, msg);
      console.log(`[check-db-health][${requestId}] Alert sent: ${issue.name} (${issue.level})`);
    }

    return new Response(JSON.stringify({ ok: true, alerts: issues.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(`[check-db-health][${requestId}] Fatal:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
