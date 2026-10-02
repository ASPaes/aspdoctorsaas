import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";
import { notifyEvent } from "../_shared/notify.ts";
import {
  selecionarMensagens, formatarMensagens, montarPrompt, FERRAMENTA_ANALISE,
  ehCandidatoChurn, ehAlertaChurn, ehCandidatoIrritacao, ehAlertaIrritacao, ehConversa, MAX_MENSAGENS,
} from "./prompt.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Piso da janela de analise quando a conversa nao tem atendimento aberto.
// Ver o comentario na montagem de `windowStart` — sem esse piso a analise lia a
// conversa inteira e o alerta de churn citava mensagem de dias atras.
const WINDOW_FALLBACK_HOURS = 6;

// === Modelo utilitario decidido pela PLATAFORMA (nunca pelo tenant) ===
// Classificacao de sentimento roda num modelo barato, independente do modelo
// premium que o tenant configurou. Para provider 'custom'/desconhecido nao
// arrisca trocar (pode nao existir no endpoint), usa o fallback do proprio tenant.
function utilityModelFor(provider: string, fallback: string): string {
  switch (provider) {
    case "openai": return "gpt-4o-mini";
    case "anthropic": return "claude-3-5-haiku-20241022";
    case "gemini": return "gemini-1.5-flash";
    default: return fallback;
  }
}

async function checkRateLimit(
  supabase: any,
  tenantId: string,
  functionName: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number; logId?: string }> {
  try {
    const { data: configs } = await supabase
      .from('ai_rate_limit_config')
      .select('max_calls, window_seconds, tenant_id')
      .eq('function_name', functionName)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false })
      .limit(2);

    const config = configs?.[0] ?? { max_calls: 10, window_seconds: 60 };
    const windowSeconds = config.window_seconds;
    const maxCalls = config.max_calls;
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

    const { count } = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('function_name', functionName)
      .gte('called_at', windowStart);

    if ((count ?? 0) >= maxCalls) {
      return { allowed: false, retryAfterSeconds: windowSeconds };
    }

    const logId = crypto.randomUUID();
    supabase
      .from('ai_usage_log')
      .insert({ id: logId, tenant_id: tenantId, function_name: functionName, model: null, provider: null, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 })
      .then(() => {});

    return { allowed: true, logId };
  } catch {
    return { allowed: true };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    const isInternalCall = token === serviceKey;

    if (!isInternalCall) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser(token);
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    // dryRun: so analisa e devolve o resultado, sem gravar nem avisar — para
    // repassar casos reais pela regra (ex.: os alertas de um periodo). `ate`
    // reconstroi o momento: le o atendimento que estava aberto naquela hora e
    // so as mensagens ate ela. Apenas chamada interna (service_role).
    const body = await req.json();
    const conversationId = body?.conversationId;
    const dryRun = isInternalCall && body?.dryRun === true;
    const ate: string | null = dryRun && typeof body?.ate === "string" ? body.ate : null;
    if (!conversationId) {
      return new Response(JSON.stringify({ success: false, error: "conversationId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("tenant_id, contact_id, whatsapp_contacts(id, name, phone_number)")
      .eq("id", conversationId)
      .single();

    if (!convData) {
      return new Response(JSON.stringify({ success: false, error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === GATE 1: chave liga/desliga + teto de gasto (por tenant) ===
    const { data: cfg } = await supabase
      .from("configuracoes")
      .select("sentiment_analysis_enabled, ai_monthly_budget_usd, churn_alert_enabled")
      .eq("tenant_id", convData.tenant_id)
      .maybeSingle();

    if (cfg && cfg.sentiment_analysis_enabled === false) {
      return new Response(
        JSON.stringify({ success: false, error: "sentiment_disabled", message: "Analise de sentimento desativada para este tenant." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const budget = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (budget != null && budget > 0) {
      const { data: spendData } = await supabase.rpc("ai_month_spend_usd", { p_tenant_id: convData.tenant_id });
      const spend = Number(spendData) || 0;
      if (spend >= budget) {
        return new Response(
          JSON.stringify({ success: false, error: "budget_exceeded", message: `Teto de gasto de IA do mes atingido (US$ ${spend.toFixed(2)} / US$ ${budget.toFixed(2)}).` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const rateLimit = await checkRateLimit(supabase, convData.tenant_id, 'analyze-whatsapp-sentiment');
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'rate_limit_exceeded',
          message: `Limite de uso de IA atingido. Tente novamente em ${rateLimit.retryAfterSeconds} segundos.`,
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "ai_not_configured",
          message: "Nenhuma IA configurada para este tenant. Acesse Configuracoes > Inteligencia Artificial para configurar.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Janela de analise. O corte precisa existir SEMPRE: sem ele a busca pega as
    // ultimas 20 mensagens da conversa INTEIRA e, como a thread de um contato e
    // continua (nunca "termina"), a IA cita como evidencia de churn uma frase de
    // dias atras. Foi o alerta de 02/09 citando mensagem de 27/08.
    //
    // Preferencia e o atendimento aberto. Quando nao ha nenhum, cai no piso de
    // WINDOW_FALLBACK_HOURS — que e o caso real, uma corrida: o processor dispara
    // a analise ao RECEBER a mensagem e o atendimento so e gravado segundos
    // depois, entao aqui a busca por atendimento aberto volta vazia.
    let attQuery = supabase
      .from("support_attendances")
      .select("opened_at")
      .eq("conversation_id", conversationId);
    attQuery = ate ? attQuery.lte("opened_at", ate) : attQuery.is("closed_at", null);
    const { data: att } = await attQuery
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const agoraMs = ate ? new Date(ate).getTime() : Date.now();
    const windowStart =
      att?.opened_at ??
      new Date(agoraMs - WINDOW_FALLBACK_HOURS * 60 * 60 * 1000).toISOString();

    // O atendimento INTEIRO, nao as ultimas 20: com 20, imagens e mensagens de
    // sistema empurravam para fora justamente o comeco, onde o cliente diz do que
    // se trata (alerta de 30/09: "como eu cancelo um valor que passei no sistema"
    // ficou de fora e sobrou so "Entao preciso cancelar"). 500 e so a trava da
    // busca (p90 do atendimento e 46); o teto do prompt e MAX_MENSAGENS, e quem
    // passa dele perde o meio, nunca o comeco nem o fim (selecionarMensagens).
    let msgQuery = supabase
      .from("whatsapp_messages")
      .select("content, timestamp, audio_transcription, message_type, is_from_me")
      .eq("conversation_id", conversationId)
      .gte("timestamp", windowStart);
    if (ate) msgQuery = msgQuery.lte("timestamp", ate);
    const { data: messages, error: messagesError } = await msgQuery
      .order("timestamp", { ascending: true })
      .limit(500);

    if (messagesError) throw messagesError;

    const conversa = (messages || []).filter(ehConversa);
    const clientMessagesCount = conversa.filter((m: any) => !m.is_from_me).length;
    if (clientMessagesCount < 3) {
      return new Response(
        JSON.stringify({ success: false, error: "insufficient_messages", message: `Minimo 3 mensagens do cliente necessario para analise (encontradas: ${clientMessagesCount}).` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selecionadas = selecionarMensagens(conversa);
    const omitidas = conversa.length > MAX_MENSAGENS ? conversa.length - selecionadas.length : 0;
    const prompt = montarPrompt(formatarMensagens(selecionadas, omitidas));
    const tools = [FERRAMENTA_ANALISE];

    // Acumuladores de custo (tier1 + tier2)
    let totalIn = 0, totalOut = 0, totalCost = 0;
    let modelsUsed = "";
    let result: any;
    try {
      // === TIER 1: modelo utilitario barato (mini) — roda em 100% das chamadas ===
      const tier1Model = utilityModelFor(aiConfig.provider, aiConfig.model);
      const tier1Config = { ...aiConfig, model: tier1Model };
      const r1 = await callAI(tier1Config, [{ role: "user", content: prompt }], tools);
      totalIn += r1.usage.inputTokens; totalOut += r1.usage.outputTokens; totalCost += r1.usage.estimatedCostUsd;
      modelsUsed = tier1Model;
      result = JSON.parse(r1.content);

      // === TIER 2: so escala para o modelo premium quando o mini sinaliza
      // candidato a churn ou irritacao — confirma antes do alerta. Raro => custo desprezivel.
      const isChurnCandidate = ehCandidatoChurn(result) || ehCandidatoIrritacao(result);
      const premiumModel = aiConfig.model;
      if (isChurnCandidate && premiumModel && premiumModel !== tier1Model) {
        try {
          const r2 = await callAI(aiConfig, [{ role: "user", content: prompt }], tools);
          totalIn += r2.usage.inputTokens; totalOut += r2.usage.outputTokens; totalCost += r2.usage.estimatedCostUsd;
          modelsUsed = `${tier1Model}+${premiumModel}`;
          const confirmed = JSON.parse(r2.content);
          // Veredito do premium prevalece (mais preciso para o high-stakes)
          result = confirmed;
        } catch (e2: any) {
          console.error("[analyze-sentiment] tier2 confirm falhou, mantendo tier1:", e2?.message || e2);
        }
      }

      if (rateLimit.logId) {
        await supabase.from('ai_usage_log').update({
          input_tokens: totalIn,
          output_tokens: totalOut,
          estimated_cost_usd: totalCost,
          model: modelsUsed,
          provider: aiConfig.provider,
        }).eq('id', rateLimit.logId);
      }
    } catch (aiError: any) {
      const msg = aiError.message || "";
      console.error("[analyze-sentiment] AI error:", msg);
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ success: false, error: "ai_key_invalid", message: "Chave de API invalida. Verifique em Configuracoes > Inteligencia Artificial." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429") || msg.includes("insufficient_quota") || msg.includes("quota")) {
        return new Response(JSON.stringify({ success: false, error: "rate_limit", message: "Limite/creditos da API esgotados. Verifique seu plano no provedor de IA." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false, error: "ai_error", message: `Erro na IA: ${msg.substring(0, 200)}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!["positive", "neutral", "negative"].includes(result.sentiment)) {
      throw new Error("Invalid sentiment value");
    }

    const ehChurn = ehAlertaChurn(result);
    const ehIrritacao = ehAlertaIrritacao(result);

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, dryRun: true, result, alerta: ehChurn ? "churn" : ehIrritacao ? "irritacao" : null, models: modelsUsed, mensagens: selecionadas.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: analysis, error: upsertError } = await supabase
      .from("whatsapp_sentiment_analysis")
      .upsert({
        conversation_id: conversationId,
        contact_id: convData.contact_id,
        tenant_id: convData.tenant_id,
        sentiment: result.sentiment,
        confidence: result.confidence,
        summary: result.summary?.substring(0, 100),
        keywords: result.keywords || [],
        // A faixa de "abrir ticket de CS" no chat le esta coluna: so liga com
        // cancelamento de contrato, nunca com o needs_cs_ticket cru da IA.
        needs_cs_ticket: ehCandidatoChurn(result) || ehCandidatoIrritacao(result),
        cs_ticket_reason: ehCandidatoChurn(result) || ehCandidatoIrritacao(result) ? (result.cs_ticket_reason || result.summary)?.substring(0, 200) || null : null,
      }, { onConflict: "conversation_id" })
      .select()
      .single();

    if (upsertError) throw upsertError;

    // Alerta. Quem decide e o codigo, com o que a IA classificou (ver prompt.ts):
    // churn = cancelar o CONTRATO; irritacao = contra o atendimento ou o produto
    // (essa e de transicao — vira aviso por recorrencia).
    // Saiu a exigencia de duas analises seguidas positivas: com a analise rodando
    // a cada 5 mensagens do cliente, ela atrasava o alerta ate o cliente repetir
    // — e quem confirma agora e o modelo premium (tier2) na mesma chamada.
    const churnGate = ehChurn || ehIrritacao;

    // Descarte manual: um admin/head pode derrubar o sinal de risco desta
    // conversa (falso positivo). Vale enquanto durar o atendimento em que foi
    // descartado — `fn_churn_descarte_ativo` compara a ancora com o
    // atendimento ativo de agora. Consultado so quando o gate ja passou, que e
    // raro: nao adiciona chamada ao caminho comum.
    let churnDescartado = false;
    if (churnGate) {
      const { data: descarte } = await supabase.rpc("fn_churn_descarte_ativo", {
        p_conversation_id: conversationId,
      });
      churnDescartado = descarte === true;
      if (churnDescartado) {
        console.log(`[churn-alert] descartado manualmente para conversation ${conversationId}`);
      }
    }

    if (churnGate && !churnDescartado) {
      try {
        if (cfg?.churn_alert_enabled) {
          const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: claimed } = await supabase
            .from("whatsapp_sentiment_analysis")
            .update({ churn_alerted_at: new Date().toISOString() })
            .eq("conversation_id", conversationId)
            .or(`churn_alerted_at.is.null,churn_alerted_at.lt.${cutoffIso}`)
            .select("id");

          if (claimed && claimed.length > 0) {
            const contact: any = (convData as any).whatsapp_contacts || {};
            const contactName = contact.name || contact.phone_number || "Cliente";
            const contactPhone = contact.phone_number || "";
            const reason = (result.cs_ticket_reason || result.summary || "Sinal de churn detectado").toString();
            const evidencia = ehChurn ? result.churn_evidence : result.irritation_evidence;
            const alvo = result.irritation_target === "produto" ? "com o sistema" : "com o atendimento";

            const title = ehChurn ? `⚠️ Risco de churn: ${contactName}` : `😠 Cliente insatisfeito ${alvo}: ${contactName}`;

            await notifyEvent(
              supabase,
              convData.tenant_id,
              "churn_alert",
              conversationId,
              title,
              `Cliente: ${contactName} (${contactPhone})\nMotivo: ${reason.substring(0, 400)}\nTrecho: "${(evidencia || "").substring(0, 200)}"\nAbra o DoctorSaaS para ver a conversa.`,
              { source: "churn_alert", conversation_id: conversationId, contact_name: contactName, contact_phone: contactPhone },
              `/whatsapp?conversation=${conversationId}`
            );

            console.log(`[churn-alert] fired for conversation ${conversationId} tenant ${convData.tenant_id}`);
          } else {
            console.log(`[churn-alert] cooldown active for conversation ${conversationId}`);
          }
        }
      } catch (alertErr: any) {
        console.error("[churn-alert] unexpected error:", alertErr?.message || alertErr);
      }
    }

    return new Response(JSON.stringify({ success: true, analysis }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[analyze-sentiment] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
