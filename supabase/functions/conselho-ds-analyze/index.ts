import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCTION_NAME = 'conselho-ds-analyze';

async function checkRateLimit(supabase: any, tenantId: string): Promise<{ allowed: boolean; retryAfterSeconds?: number; logId?: string }> {
  try {
    const { data: configs } = await supabase
      .from('ai_rate_limit_config')
      .select('max_calls, window_seconds, tenant_id')
      .eq('function_name', FUNCTION_NAME)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false })
      .limit(2);
    const config = configs?.[0] ?? { max_calls: 5, window_seconds: 3600 };
    const windowStart = new Date(Date.now() - config.window_seconds * 1000).toISOString();
    const { count } = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('function_name', FUNCTION_NAME)
      .gte('called_at', windowStart);
    if ((count ?? 0) >= config.max_calls) {
      return { allowed: false, retryAfterSeconds: config.window_seconds };
    }
    const logId = crypto.randomUUID();
    supabase
      .from('ai_usage_log')
      .insert({ id: logId, tenant_id: tenantId, function_name: FUNCTION_NAME, model: null, provider: null, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 })
      .then(() => {});
    return { allowed: true, logId };
  } catch {
    return { allowed: true };
  }
}

async function hashInput(payload: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function render(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v ?? '');
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { tenantId, tabKey, dadosIndicadores, alertasFactuais, filtrosAplicados, benchmarksMercado } = body || {};

    if (!tenantId || !tabKey || !dadosIndicadores) {
      return new Response(JSON.stringify({ error: "missing_fields", required: ['tenantId', 'tabKey', 'dadosIndicadores'] }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from('profiles').select('role, tenant_id').eq('user_id', userId).maybeSingle();
    const { data: isSuper } = await supabase.rpc('is_super_admin');
    const allowed = isSuper || (profile?.tenant_id === tenantId && ['admin', 'head'].includes(profile?.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "forbidden", message: "Apenas admin e head podem solicitar análise do Conselho DS." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rl = await checkRateLimit(supabase, tenantId);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate_limit_exceeded', retryAfterSeconds: rl.retryAfterSeconds }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: cfgRows } = await supabase.rpc('get_tenant_conselho_config', { p_tenant_id: tenantId, p_tab_key: tabKey });
    const cfg = cfgRows?.[0];
    if (!cfg) {
      return new Response(JSON.stringify({ error: "config_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!cfg.template_existe || !cfg.template_ativo) {
      return new Response(JSON.stringify({ error: "template_not_found_or_inactive", tab_key: tabKey }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const personaIds: string[] = cfg.persona_ids || [];
    if (personaIds.length === 0) {
      return new Response(JSON.stringify({ error: "no_personas_configured", message: "Configure pelo menos 1 persona em Configurações > Conselho DS." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [{ data: tenantRow }, { data: personas }, { data: template }] = await Promise.all([
      supabase.from('tenants').select('nome').eq('id', tenantId).maybeSingle(),
      supabase.rpc('get_conselho_personas_with_prompts', { p_persona_ids: personaIds }),
      supabase.from('conselho_aba_templates').select('*').eq('tab_key', tabKey).maybeSingle(),
    ]);
    const tenantNome = tenantRow?.nome || 'Empresa';
    const focoMes = cfg.foco_mes || 'Sem foco específico definido';
    const tom = cfg.tom || 'executivo';
    if (!template || !personas || personas.length === 0) {
      return new Response(JSON.stringify({ error: "template_or_personas_missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dataAnalise = new Date().toISOString().slice(0, 10);
    const periodoReferencia = filtrosAplicados?.periodo_referencia || 'mês atual';
    const hashInputPayload = {
      tenantId, tabKey,
      personaIds: [...personaIds].sort(),
      focoMes, tom, dadosIndicadores,
      alertasFactuais: alertasFactuais ?? {},
      filtrosAplicados: filtrosAplicados ?? {},
      data: dataAnalise,
    };
    const inputHash = await hashInput(hashInputPayload);

    const { data: cacheRows } = await supabase.rpc('get_conselho_cache', { p_tenant_id: tenantId, p_tab_key: tabKey, p_input_hash: inputHash });
    const cached = cacheRows?.[0];

    if (cached) {
      await supabase.rpc('register_conselho_analise', {
        p_tenant_id: tenantId, p_tab_key: tabKey,
        p_dados_snapshot: dadosIndicadores, p_alertas_factuais: alertasFactuais ?? {}, p_filtros_aplicados: filtrosAplicados ?? {},
        p_personas_ids: personaIds, p_personas_snapshot: cached.personas_snapshot,
        p_foco_mes: focoMes, p_tom: tom,
        p_prompt_final: '(cache hit)', p_output_markdown: cached.output_markdown,
        p_provider_usado: null, p_model_usado: cached.model_usado,
        p_tokens_in: 0, p_tokens_out: 0, p_custo_estimado_usd: 0,
        p_duracao_ms: Date.now() - startedAt,
        p_status: 'success', p_error_message: null,
        p_input_hash: inputHash, p_cache_horas: cfg.cache_horas,
        p_cache_hit_de: cached.id,
      });
      return new Response(JSON.stringify({
        success: true, cache_hit: true,
        output_markdown: cached.output_markdown,
        solicitado_em: cached.solicitado_em, expires_at: cached.expires_at,
        tokens: { in: cached.tokens_in, out: cached.tokens_out },
        custo_estimado_usd: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiConfig = await getAIConfig(tenantId, supabase);
    if (!aiConfig) {
      return new Response(JSON.stringify({ error: "ai_not_configured", message: "Nenhuma IA configurada para este tenant. Acesse Configurações > Inteligência Artificial." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const personasPerspectivas = personas
      .map((p: any, i: number) => `### Perspectiva ${i + 1}: ${p.nome_funcional}\n${p.bio_curta}\n\n${p.system_prompt_chunk}`)
      .join('\n\n---\n\n');

    const promptFinal = render(template.prompt_principal, {
      tenant_nome: tenantNome, foco_mes: focoMes, tom,
      data_analise: dataAnalise, periodo_referencia: periodoReferencia,
      dados_indicadores_json: JSON.stringify(dadosIndicadores, null, 2),
      alertas_factuais_json: JSON.stringify(alertasFactuais ?? {}, null, 2),
      benchmarks_mercado_json: JSON.stringify(benchmarksMercado ?? {}, null, 2),
      personas_perspectivas: personasPerspectivas,
    });
    const fullPrompt = `${promptFinal}\n\n${template.output_format_prompt}`;

    let aiResult: any;
    let analiseError: string | null = null;
    let status: 'success' | 'error' = 'success';
    try {
      aiResult = await callAI(aiConfig, [
        { role: "system", content: "Você é o Conselho DS — coletivo de especialistas em SaaS B2B. Responda em markdown puro, em português brasileiro, direto e sem floreio. Nunca cite nomes de pessoas reais no output. Fale sempre como Conselho DS." },
        { role: "user", content: fullPrompt },
      ], undefined, { maxTokens: 3000 });
    } catch (err: any) {
      status = 'error';
      analiseError = err?.message || 'Erro desconhecido ao chamar LLM';
    }

    const outputMarkdown = aiResult?.content || null;
    const tokensIn = aiResult?.usage?.inputTokens || 0;
    const tokensOut = aiResult?.usage?.outputTokens || 0;
    const custoUsd = aiResult?.usage?.estimatedCostUsd || 0;

    if (status === 'success') {
      if (rl.logId) {
        await supabase.from('ai_usage_log').update({
          input_tokens: tokensIn, output_tokens: tokensOut, estimated_cost_usd: custoUsd,
          model: aiConfig.model, provider: aiConfig.provider,
        }).eq('id', rl.logId);
      }
    }

    const personasSnapshot = personas.map((p: any) => ({ id: p.id, slug: p.slug, nome_funcional: p.nome_funcional, bio_curta: p.bio_curta }));

    const { data: analiseId } = await supabase.rpc('register_conselho_analise', {
      p_tenant_id: tenantId, p_tab_key: tabKey,
      p_dados_snapshot: dadosIndicadores, p_alertas_factuais: alertasFactuais ?? {}, p_filtros_aplicados: filtrosAplicados ?? {},
      p_personas_ids: personaIds, p_personas_snapshot: personasSnapshot,
      p_foco_mes: focoMes, p_tom: tom,
      p_prompt_final: fullPrompt, p_output_markdown: outputMarkdown,
      p_provider_usado: aiConfig.provider, p_model_usado: aiConfig.model,
      p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_custo_estimado_usd: custoUsd,
      p_duracao_ms: Date.now() - startedAt,
      p_status: status, p_error_message: analiseError,
      p_input_hash: inputHash, p_cache_horas: cfg.cache_horas,
      p_cache_hit_de: null,
    });

    if (status === 'error') {
      return new Response(JSON.stringify({ error: 'ai_call_failed', message: analiseError, analise_id: analiseId }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      success: true, cache_hit: false, analise_id: analiseId,
      output_markdown: outputMarkdown,
      tokens: { in: tokensIn, out: tokensOut },
      custo_estimado_usd: custoUsd,
      provider: aiConfig.provider, model: aiConfig.model,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("[conselho-ds-analyze] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Erro desconhecido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
