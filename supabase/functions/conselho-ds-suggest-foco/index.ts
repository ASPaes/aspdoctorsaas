import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCTION_NAME = 'conselho-ds-suggest-foco';
const MAX_TOKENS = 700;

async function checkRateLimit(supabase: any, tenantId: string) {
  try {
    const { data: configs } = await supabase.from('ai_rate_limit_config')
      .select('max_calls, window_seconds, tenant_id').eq('function_name', FUNCTION_NAME)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false }).limit(2);
    const config = configs?.[0] ?? { max_calls: 10, window_seconds: 3600 };
    const windowStart = new Date(Date.now() - config.window_seconds * 1000).toISOString();
    const { count } = await supabase.from('ai_usage_log').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('function_name', FUNCTION_NAME).gte('called_at', windowStart);
    if ((count ?? 0) >= config.max_calls) {
      return { allowed: false, retryAfterSeconds: config.window_seconds };
    }
    supabase.from('ai_usage_log').insert({
      tenant_id: tenantId, function_name: FUNCTION_NAME, model: null, provider: null,
      input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0,
    }).then(() => {});
    return { allowed: true };
  } catch { return { allowed: true }; }
}

async function hashInput(payload: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { tenantId, tabKey, dadosIndicadores, personaIds, tom = 'executivo', alertasFactuais, filtrosAplicados } = body || {};

    if (!tenantId || !tabKey || !dadosIndicadores || !Array.isArray(personaIds) || personaIds.length === 0) {
      return new Response(JSON.stringify({ error: "missing_fields", required: ['tenantId', 'tabKey', 'dadosIndicadores', 'personaIds'] }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Permissão
    const { data: profile } = await supabase.from('profiles').select('role, tenant_id').eq('user_id', userId).maybeSingle();
    const { data: isSuper } = await supabase.rpc('is_super_admin');
    const allowed = isSuper || (profile?.tenant_id === tenantId && ['admin', 'head'].includes(profile?.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "forbidden", message: "Apenas admin e head podem sugerir foco." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit
    const rl = await checkRateLimit(supabase, tenantId);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate_limit_exceeded', retryAfterSeconds: rl.retryAfterSeconds }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carregar template + personas
    const [{ data: tenantRow }, { data: personas }, { data: tplRows }] = await Promise.all([
      supabase.from('tenants').select('nome').eq('id', tenantId).maybeSingle(),
      supabase.rpc('get_conselho_personas_with_prompts', { p_persona_ids: personaIds }),
      supabase.rpc('get_conselho_aba_template', { p_tenant_id: tenantId, p_tab_key: tabKey }),
    ]);
    const template = tplRows?.[0];
    const tenantNome = tenantRow?.nome || 'Empresa';

    if (!template || !personas || personas.length === 0) {
      return new Response(JSON.stringify({ error: "template_or_personas_missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash apenas para registro de histórico (não há leitura de cache nesta função)
    const sortedIds = [...personaIds].sort();
    const hashPayload = { tenantId, tabKey, personaIds: sortedIds, tom, dadosIndicadores, alertasFactuais: alertasFactuais ?? {}, filtrosAplicados: filtrosAplicados ?? {} };
    const inputHash = await hashInput(hashPayload);

    // Config IA
    const aiConfig = await getAIConfig(tenantId, supabase);
    if (!aiConfig) {
      return new Response(JSON.stringify({ error: "ai_not_configured", message: "Nenhuma IA configurada. Acesse Configurações > IA." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Construir prompt curto
    const perspectivas = personas.map((p: any) => `- **${p.nome_funcional}** — ${p.bio_curta}`).join('\n');
    const contextoObjetivo = template.contexto_objetivo || template.display_label || tabKey;

    const fullPrompt = `Você é o **Conselho DS** — coletivo de especialistas em SaaS B2B. Você está ajudando o tenant **${tenantNome}** a definir o **FOCO DO MÊS** para esta análise.\n\n## CONTEXTO DA ABA\n${contextoObjetivo}\n\n## CONSELHEIROS DESTA ANÁLISE\n${perspectivas}\n\n## INDICADORES REAIS DO TENANT\n\`\`\`json\n${JSON.stringify(dadosIndicadores, null, 2)}\n\`\`\`\n\n## TAREFA\nEscreva o FOCO DO MÊS sugerido — texto de **6 a 10 linhas**, prático e direto.\n\nRegras OBRIGATÓRIAS:\n1. Comece OBRIGATORIAMENTE com **"Baseado em seus indicadores atuais, ..."**\n2. Cite **2-3 números reais** dos indicadores como evidência\n3. Aponte a **alavanca dominante** do mês (1 frente principal)\n4. Termine sugerindo **1 ação concreta de partida** para as próximas 2 semanas\n5. Tom: ${tom === 'tecnico' ? 'técnico, com vocabulário SaaS' : tom === 'direto' ? 'direto, sem rodeio' : 'executivo, claro e estratégico'}\n6. **NUNCA cite nomes de pessoas reais** — fale como "O Conselho DS"\n7. Texto puro, sem markdown headers, sem listas — parágrafo corrido\n8. Máximo 150 palavras`;

    let aiResult: any;
    let analiseError: string | null = null;
    let status: 'success' | 'error' = 'success';
    try {
      aiResult = await callAI(aiConfig, [
        { role: "system", content: "Você é o Conselho DS. Responda em português BR, parágrafo corrido, sem markdown headers, sem citar nomes reais. Comece com 'Baseado em seus indicadores atuais'." },
        { role: "user", content: fullPrompt },
      ], undefined, { maxTokens: MAX_TOKENS });
    } catch (err: any) {
      status = 'error';
      analiseError = err?.message || 'Erro ao chamar LLM';
    }

    const outputText = aiResult?.content?.trim() || null;
    const tokensIn = aiResult?.usage?.inputTokens || 0;
    const tokensOut = aiResult?.usage?.outputTokens || 0;
    const custoUsd = aiResult?.usage?.estimatedCostUsd || 0;

    if (status === 'success') {
      await supabase.from('ai_usage_log').update({
        input_tokens: tokensIn, output_tokens: tokensOut, estimated_cost_usd: custoUsd,
        model: aiConfig.model, provider: aiConfig.provider,
      }).eq('tenant_id', tenantId).eq('function_name', FUNCTION_NAME)
        .order('called_at', { ascending: false }).limit(1);
    }

    const personasSnapshot = personas.map((p: any) => ({
      id: p.id, slug: p.slug, nome_funcional: p.nome_funcional, bio_curta: p.bio_curta,
    }));

    const { data: analiseId } = await supabase.rpc('register_conselho_analise', {
      p_tenant_id: tenantId, p_tab_key: tabKey,
      p_dados_snapshot: dadosIndicadores, p_alertas_factuais: alertasFactuais ?? {}, p_filtros_aplicados: filtrosAplicados ?? {},
      p_personas_ids: personaIds, p_personas_snapshot: personasSnapshot,
      p_foco_mes: null, p_tom: tom,
      p_prompt_final: fullPrompt, p_output_markdown: outputText,
      p_provider_usado: aiConfig.provider, p_model_usado: aiConfig.model,
      p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_custo_estimado_usd: custoUsd,
      p_duracao_ms: Date.now() - startedAt,
      p_status: status, p_error_message: analiseError,
      p_input_hash: inputHash, p_cache_horas: 0,
      p_cache_hit_de: null, p_tipo: 'suggest_foco',
    });

    if (status === 'error') {
      return new Response(JSON.stringify({ error: 'ai_call_failed', message: analiseError, analise_id: analiseId }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true, cache_hit: false, analise_id: analiseId,
      foco_sugerido: outputText,
      tokens: { in: tokensIn, out: tokensOut },
      custo_estimado_usd: custoUsd,
      provider: aiConfig.provider, model: aiConfig.model,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("[conselho-ds-suggest-foco] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
