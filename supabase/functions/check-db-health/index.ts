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
    .single();
  if (!alertConfig) throw new Error('Alert config not found');

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name')
    .eq('instance_name', alertConfig.admin_instance_name)
    .single();
  if (!instance) throw new Error('WhatsApp instance not found');

  const { data: secrets, error: secretsError } = await supabase.rpc('get_instance_secrets', {
    p_instance_id: instance.id,
  });
  if (secretsError || !secrets?.api_url) throw new Error('Secrets not found');

  return {
    api_url: (secrets.api_url as string).replace(/\/$/, '').replace(/\/manager$/, ''),
    api_key: (secrets.api_key as string) || '',
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
    if (value >= 15000) {
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

async function buildDailyReport(creds: any): Promise<void> {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });

  // Métricas do banco — snapshot mais recente do dia
  const { data: snapshots } = await supabase
    .from('db_metrics_snapshots')
    .select('active_connections, top_slow_query_ms, dead_tuples_whatsapp_messages, cron_job_details_count, captured_at')
    .gte('captured_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('active_connections', { ascending: false })
    .limit(100);

  const maxConn = snapshots?.length ? Math.max(...snapshots.map((s: any) => s.active_connections || 0)) : 0;
  const peakSnap = snapshots?.find((s: any) => s.active_connections === maxConn);
  const peakTime = peakSnap ? new Date(peakSnap.captured_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--';
  const latestSnap = snapshots?.[snapshots.length - 1] as any;
  const slowMs = latestSnap?.top_slow_query_ms || 0;
  const deadTuples = latestSnap?.dead_tuples_whatsapp_messages || 0;

  // Métricas por tenant
  const { data: tenants } = await supabase
    .from('tenant_daily_metrics')
    .select('tenant_id, messages_sent, messages_received, conversations_opened, conversations_closed, active_operators, ai_calls_suggest, ai_calls_compose, ai_calls_sentiment, ai_calls_summary, ai_calls_audio, whatsapp_instances_connected, whatsapp_instances_total')
    .eq('metric_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  const { data: tenantNames } = await supabase
    .from('tenants')
    .select('id, nome');

  const nameMap: Record<string, string> = {};
  (tenantNames || []).forEach((t: any) => { nameMap[t.id] = t.nome; });

  const activeTenantsData = (tenants || []).filter((t: any) => t.messages_sent > 0 || t.messages_received > 0);
  const totalMsgSent = activeTenantsData.reduce((s: number, t: any) => s + (t.messages_sent || 0), 0);
  const totalMsgRecv = activeTenantsData.reduce((s: number, t: any) => s + (t.messages_received || 0), 0);
  const totalAI = activeTenantsData.reduce((s: number, t: any) => s + (t.ai_calls_suggest || 0) + (t.ai_calls_compose || 0) + (t.ai_calls_sentiment || 0) + (t.ai_calls_summary || 0) + (t.ai_calls_audio || 0), 0);

  // Status instâncias
  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, status, tenant_id');

  const disconnected = (instances || []).filter((i: any) => i.status !== 'connected');

  // Alertas do dia
  const { data: alerts } = await supabase
    .from('db_health_action_log')
    .select('level, status')
    .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const alertsCount = alerts?.length || 0;
  const resolvedCount = alerts?.filter((a: any) => a.status === 'resolved').length || 0;

  // Montar mensagem
  const lines = [
    `📊 *Relatório Diário — DoctorSaaS*`,
    `📅 ${hoje.charAt(0).toUpperCase() + hoje.slice(1)}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🗄️ *Banco de Dados*`,
    ``,
    `🔌 Conexões: pico de *${maxConn}* às ${peakTime}h`,
    slowMs > 2000 ? `⚠️ Query lenta: *${slowMs}ms* média` : `⚡ Performance: *normal*`,
    deadTuples > 1000 ? `⚠️ Dead tuples: *${deadTuples}* em mensagens` : `🧹 Limpeza: *ok*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💬 *Operação Geral*`,
    ``,
    `📨 Mensagens: *${totalMsgSent}* enviadas · *${totalMsgRecv}* recebidas`,
    `🤖 IA utilizada: *${totalAI}* chamadas`,
    `📱 Instâncias: *${(instances || []).length - disconnected.length}/${(instances || []).length}* conectadas`,
    disconnected.length > 0 ? `⚠️ Desconectadas: ${disconnected.map((i: any) => i.instance_name).join(', ')}` : ``,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏢 *Por Tenant*`,
    ``,
    ...activeTenantsData.sort((a: any, b: any) => b.messages_sent - a.messages_sent).map((t: any) => {
      const aiTotal = (t.ai_calls_suggest || 0) + (t.ai_calls_compose || 0) + (t.ai_calls_sentiment || 0) + (t.ai_calls_summary || 0) + (t.ai_calls_audio || 0);
      const instStatus = t.whatsapp_instances_connected === t.whatsapp_instances_total ? '✅' : '⚠️';
      return `${instStatus} *${nameMap[t.tenant_id] || t.tenant_id}*\n   💬 ${t.messages_sent}↑ ${t.messages_received}↓ · 🤖 ${aiTotal} IA · 👥 ${t.active_operators} ops`;
    }),
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    alertsCount > 0 ? `🔔 *Alertas hoje:* ${alertsCount} enviados · ${resolvedCount} resolvidos` : `✅ *Sem alertas hoje*`,
    ``,
    `_Próximo check: amanhã às 08:15h_`,
  ].filter(l => l !== undefined).join('\n');

  await sendWhatsApp(creds, lines);
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

    // Check if it's the 19h report time in São Paulo (UTC-3)
    const nowUTC = new Date();
    const hourSP = (nowUTC.getUTCHours() - 3 + 24) % 24;
    const minuteSP = nowUTC.getUTCMinutes();
    const isReportTime = hourSP === 19 && minuteSP < 15;

    const creds = await getWhatsAppCredentials();

    if (isReportTime) {
      console.log(`[check-db-health][${requestId}] Building daily report`);
      await buildDailyReport(creds);
      return new Response(JSON.stringify({ ok: true, message: 'Daily report sent' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (issues.length === 0) {
      console.log(`[check-db-health][${requestId}] All checks passed — no alert sent`);
      return new Response(JSON.stringify({ ok: true, message: 'All checks passed' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

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

      // Human-friendly descriptions per check type
      const checkDescriptions: Record<string, { title: string; impact: string; action: string }> = {
        dead_tuples: {
          title: '🧹 Limpeza do banco necessária',
          impact: 'Registros obsoletos estão acumulando e deixando o chat mais lento com o tempo.',
          action: 'Executar limpeza automática (VACUUM) — rápido e sem impacto nos usuários.',
        },
        cron_bloat: {
          title: '📦 Log de tarefas acumulado',
          impact: 'Histórico de tarefas agendadas ocupando espaço desnecessário no banco.',
          action: 'Remover registros antigos — sem impacto nenhum na operação.',
        },
        query_lenta: {
          title: '🐢 Sistema com lentidão detectada',
          impact: 'Algumas buscas estão demorando mais que o normal — usuários podem sentir lentidão ao abrir conversas.',
          action: 'Analisar e otimizar. Responda SIM DB para registrar e monitorar.',
        },
        conexoes_ativas: {
          title: '🔌 Muitas conexões simultâneas',
          impact: 'Pico de acessos pode deixar o sistema mais lento ou recusar novos acessos.',
          action: 'Monitorar se o sistema está respondendo normalmente agora.',
        },
      };

      const desc = checkDescriptions[issue.name] || {
        title: '⚠️ Alerta do banco de dados',
        impact: issue.diagnosis,
        action: issue.action,
      };

      const levelLabel = issue.level === 'critical' ? '🔴 CRÍTICO' : '🟡 ATENÇÃO';

      const msg = [
        `${emoji(issue.level)} *${desc.title}*`,
        `${levelLabel} · Check das ${hora}`,
        ``,
        `📋 *O que está acontecendo:*`,
        desc.impact,
        ``,
        `💡 *O que fazer:*`,
        desc.action,
        ``,
        `Deseja executar agora?`,
        `✅ *SIM DB* — executar`,
        `❌ *NÃO DB* — ignorar`,
        `⏰ *DEPOIS DB* — lembrar em 2h`,
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
