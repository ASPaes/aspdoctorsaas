import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";
import { getAdapter, getInstanceSecrets } from "../_shared/providers/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function checkRateLimit(
  supabase: any,
  tenantId: string,
  functionName: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
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

    supabase
      .from('ai_usage_log')
      .insert({ tenant_id: tenantId, function_name: functionName, model: null, provider: null, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 })
      .then(() => {});

    return { allowed: true };
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
    const { conversationId } = await req.json();
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
          message: "Nenhuma IA configurada para este tenant. Acesse Configurações > Inteligência Artificial para configurar.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("whatsapp_messages")
      .select("content, timestamp, audio_transcription, message_type, is_from_me")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(20);

    if (messagesError) throw messagesError;

    const clientMessagesCount = (messages || []).filter((m: any) => !m.is_from_me).length;
    if (!messages || clientMessagesCount < 3) {
      return new Response(
        JSON.stringify({ success: false, error: "insufficient_messages", message: `Mínimo 3 mensagens do cliente necessário para análise (encontradas: ${clientMessagesCount}).` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderedMessages = [...messages].reverse();
    const messagesText = orderedMessages
      .map((msg: any, index: number) => {
        const role = msg.is_from_me ? "[Atendente]" : "[Cliente]";
        const text =
          msg.message_type === "audio" && msg.audio_transcription
            ? `[Áudio transcrito]: "${msg.audio_transcription}"`
            : `"${msg.content}"`;
        return `${index + 1}. ${role} [${new Date(msg.timestamp).toLocaleString("pt-BR")}]: ${text}`;
      })
      .join("\n");


    const prompt = `Analise o sentimento das últimas mensagens deste cliente de WhatsApp e avalie se é necessário abrir um ticket de Customer Success (CS).

Mensagens (mais antigas para mais recentes):
${messagesText}

Critérios de Análise de Sentimento:
- positive: Cliente satisfeito, agradecido, animado, elogios
- neutral: Tom profissional, dúvidas técnicas, informações
- negative: Frustrado, insatisfeito, reclamando, impaciente

Critérios para abertura de Ticket CS (needs_cs_ticket = true):
- Cliente demonstra insatisfação persistente ou crescente
- Menção a cancelamento, troca de fornecedor, ou saída
- Reclamações sobre qualidade, preço ou atendimento
- Tom agressivo ou ameaçador
- Palavras-chave: cancelar, trocar, insatisfeito, péssimo, nunca mais, vou sair`;

    const tools = [
      {
        type: "function",
        function: {
          name: "analyze_sentiment",
          description: "Analisa o sentimento das mensagens do cliente",
          parameters: {
            type: "object",
            properties: {
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              confidence: { type: "number" },
              summary: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
              needs_cs_ticket: { type: "boolean" },
              cs_ticket_reason: { type: "string" },
            },
            required: ["sentiment", "confidence", "summary", "needs_cs_ticket"],
          },
        },
      },
    ];

    let result: any;
    try {
      const aiResult = await callAI(aiConfig, [{ role: "user", content: prompt }], tools);
      await supabase.from('ai_usage_log').update({
        input_tokens: aiResult.usage.inputTokens,
        output_tokens: aiResult.usage.outputTokens,
        estimated_cost_usd: aiResult.usage.estimatedCostUsd,
        model: aiConfig.model,
        provider: aiConfig.provider,
      }).eq('tenant_id', convData.tenant_id).eq('function_name', 'analyze-whatsapp-sentiment').order('called_at', { ascending: false }).limit(1);
      result = JSON.parse(aiResult.content);
    } catch (aiError: any) {
      const msg = aiError.message || "";
      console.error("[analyze-sentiment] AI error:", msg);
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ success: false, error: "ai_key_invalid", message: "Chave de API inválida. Verifique em Configurações > Inteligência Artificial." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429") || msg.includes("insufficient_quota") || msg.includes("quota")) {
        return new Response(JSON.stringify({ success: false, error: "rate_limit", message: "Limite/créditos da API esgotados. Verifique seu plano no provedor de IA." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false, error: "ai_error", message: `Erro na IA: ${msg.substring(0, 200)}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!["positive", "neutral", "negative"].includes(result.sentiment)) {
      throw new Error("Invalid sentiment value");
    }

    // Capturar registro anterior (para cooldown do alerta)
    const { data: prevAnalysis } = await supabase
      .from("whatsapp_sentiment_analysis")
      .select("churn_alerted_at, needs_cs_ticket")
      .eq("conversation_id", conversationId)
      .maybeSingle();

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
        needs_cs_ticket: result.needs_cs_ticket || false,
        cs_ticket_reason: result.needs_cs_ticket ? (result.cs_ticket_reason?.substring(0, 200) || null) : null,
      }, { onConflict: "conversation_id" })
      .select()
      .single();

    if (upsertError) throw upsertError;

    // Alerta de churn
    if (result.needs_cs_ticket === true) {
      try {
        const { data: cfg } = await supabase
          .from("configuracoes")
          .select("churn_alert_enabled, churn_alert_phone_numbers, churn_alert_instance_id")
          .eq("tenant_id", convData.tenant_id)
          .maybeSingle();

        if (cfg?.churn_alert_enabled) {
          const lastAlertMs = prevAnalysis?.churn_alerted_at ? new Date(prevAnalysis.churn_alerted_at).getTime() : 0;
          const cooldownOk = !lastAlertMs || (Date.now() - lastAlertMs) > 24 * 60 * 60 * 1000;

          if (cooldownOk) {
            const contact: any = (convData as any).whatsapp_contacts || {};
            const contactName = contact.name || contact.phone_number || "Cliente";
            const contactPhone = contact.phone_number || "";
            const reason = (result.cs_ticket_reason || result.summary || "Sinal de churn detectado").toString();

            const title = `\u26A0\uFE0F Risco de churn: ${contactName}`;
            const body = reason.substring(0, 500);

            const { error: notifErr } = await supabase.rpc("notify_churn_alert", {
              p_tenant_id: convData.tenant_id,
              p_conversation_id: conversationId,
              p_title: title,
              p_body: body,
            });
            if (notifErr) console.error("[churn-alert] notify_churn_alert error:", notifErr.message);

            const phones: string[] = Array.isArray(cfg.churn_alert_phone_numbers) ? cfg.churn_alert_phone_numbers : [];
            if (cfg.churn_alert_instance_id && phones.length > 0) {
              try {
                const { data: inst } = await supabase
                  .from("whatsapp_instances")
                  .select("id, instance_name, provider_type, instance_id_external, meta_phone_number_id")
                  .eq("id", cfg.churn_alert_instance_id)
                  .maybeSingle();

                if (inst) {
                  const secrets = await getInstanceSecrets(supabase, inst.id);
                  const adapter = getAdapter(inst.provider_type);
                  const alertText = `\u26A0\uFE0F ALERTA DE CHURN\nCliente: ${contactName} (${contactPhone})\nMotivo: ${reason}\nAbra o DoctorSaaS para ver a conversa.`;

                  for (const rawPhone of phones) {
                    const to = String(rawPhone).replace(/\D/g, "");
                    if (!to) continue;
                    try {
                      await adapter.send(secrets as any, inst as any, {
                        to,
                        messageType: "text",
                        content: alertText,
                      });
                      console.log(`[churn-alert] sent to ${to}`);
                    } catch (sendErr: any) {
                      console.error(`[churn-alert] send error to ${to}:`, sendErr?.message || sendErr);
                    }
                  }
                }
              } catch (instErr: any) {
                console.error("[churn-alert] instance send block error:", instErr?.message || instErr);
              }
            }

            await supabase
              .from("whatsapp_sentiment_analysis")
              .update({ churn_alerted_at: new Date().toISOString() })
              .eq("conversation_id", conversationId);

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
