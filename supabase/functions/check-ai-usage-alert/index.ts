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

    // warning_threshold / critical_threshold eram do alerta de % do teto, que saiu de cena.
    // Continuam na ai_alert_config sem uso — nao removi a coluna para nao mexer no schema.
    const { admin_phone, admin_instance_name } = alertConfig;
    const alertsSent: string[] = [];

    // ============================================================
    // BLOCO 1 — ANALISES PERDIDAS (processo interrompido)
    //
    // Substituiu o alerta de "% do teto de chamadas". Aquele media a soma de
    // TODOS os tenants contra um teto que e aplicado POR tenant, entao acusava
    // 95% com o maior tenant em 20%. E, mesmo corrigido, encostar no teto nao
    // e incidente: ninguem perde nada. Incidente e analise que nao aconteceu.
    //
    // Fonte: attendance_analysis_queue com attempts esgotados. Esses itens nao
    // voltam pra fila — o atendimento fica sem sentimento, sem resumo e sem KB,
    // para sempre. processed_at e carimbado na desistencia pelo
    // process-finalize-queue.
    // ============================================================
    const LOST_ATTEMPTS = 3;       // igual ao MAX_ATTEMPTS do process-finalize-queue
    const LOOKBACK_HOURS = 24;     // teto da janela; tambem o fallback do 1o alerta
    const lookbackIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const { data: lostRows } = await supabase
      .from('attendance_analysis_queue')
      .select('tenant_id, processed_at, last_error')
      .eq('status', 'error')
      .gte('attempts', LOST_ATTEMPTS)
      .gte('processed_at', lookbackIso);

    if ((lostRows || []).length > 0) {
      // Janela por tenant = desde o ultimo alerta dele. Sem isso, ou o mesmo
      // item e contado varias vezes (janela fixa maior que o cron) ou some no
      // vao entre execucoes (janela menor). Se o envio falhou e nao gravou
      // ai_alert_log, a janela continua aberta e a proxima rodada reavisa.
      const { data: lastAlerts } = await supabase
        .from('ai_alert_log')
        .select('tenant_id, sent_at')
        .eq('function_name', 'analysis_lost')
        .gte('sent_at', lookbackIso)
        .order('sent_at', { ascending: false });

      const windowStart: Record<string, string> = {};
      for (const a of (lastAlerts || [])) {
        if (!windowStart[a.tenant_id]) windowStart[a.tenant_id] = a.sent_at; // ordenado desc: 1o = mais recente
      }

      // "finalize HTTP 503: {"success":false,"reason":"ai_quota_exceeded"}" -> "ai_quota_exceeded (HTTP 503)"
      const motivoDe = (err: string | null): string => {
        if (!err) return 'motivo nao registrado';
        const reason = err.match(/"reason"\s*:\s*"([^"]+)"/)?.[1];
        const http = err.match(/HTTP (\d{3})/)?.[1];
        if (reason && http) return `${reason} (HTTP ${http})`;
        if (reason) return reason;
        if (http) return `HTTP ${http}`;
        return err.substring(0, 40);
      };

      const porTenant: Record<string, { total: number; motivos: Record<string, number> }> = {};
      for (const row of lostRows) {
        const desde = windowStart[row.tenant_id] ?? lookbackIso;
        if (!row.processed_at || row.processed_at <= desde) continue;
        const acc = porTenant[row.tenant_id] ??= { total: 0, motivos: {} };
        acc.total++;
        const m = motivoDe(row.last_error);
        acc.motivos[m] = (acc.motivos[m] ?? 0) + 1;
      }

      const idsPerdas = Object.keys(porTenant);
      const nomesPerda: Record<string, string> = {};
      if (idsPerdas.length > 0) {
        const { data: tn } = await supabase.from('tenants').select('id, nome').in('id', idsPerdas);
        for (const t of (tn || [])) nomesPerda[t.id] = t.nome;
      }

      for (const tenantId of idsPerdas) {
        const { total, motivos } = porTenant[tenantId];
        const motivoTop = Object.entries(motivos).sort((a, b) => b[1] - a[1])[0][0];
        const outros = Object.keys(motivos).length - 1;
        const nome = nomesPerda[tenantId] || tenantId;
        const desde = new Date(windowStart[tenantId] ?? lookbackIso)
          .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const message = `⛔ *DoctorSaaS — ANALISES PERDIDAS*\n\n` +
          `▪ Empresa: *${nome}*\n` +
          `▪ Perdidas: *${total}* analise(s) de atendimento\n` +
          `▪ Motivo: ${motivoTop}${outros > 0 ? ` (+${outros} outro(s))` : ''}\n` +
          `▪ Desde: ${desde}\n` +
          `▪ Horario: ${now}\n\n` +
          `_Nao serao reprocessadas: a fila esgotou as ${LOST_ATTEMPTS} tentativas._\n` +
          `_Cada uma e um atendimento sem sentimento, sem resumo e sem KB._`;

        const ok = await sendAdminWhatsApp(supabase, admin_instance_name, admin_phone, message);
        if (ok) {
          await supabase.from('ai_alert_log').insert({
            tenant_id: tenantId,
            function_name: 'analysis_lost',
            level: 'blocked', // unicos valores aceitos pelo CHECK: warning | critical | blocked
          });
          alertsSent.push(`analysis_lost:${nome}:${total}`);
        }
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
