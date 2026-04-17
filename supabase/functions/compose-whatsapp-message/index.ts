import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "Tenant não encontrado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rateLimit = await checkRateLimit(supabase, profile.tenant_id, 'compose-whatsapp-message');
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'rate_limit_exceeded',
          message: `Limite de uso de IA atingido. Tente novamente em ${rateLimit.retryAfterSeconds} segundos.`,
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiConfig = await getAIConfig(profile.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message: "Nenhuma IA configurada. Acesse Configurações > Inteligência Artificial.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message, action, targetLanguage } = await req.json();
    if (!message || !action) throw new Error("Message and action are required");

    let prompt = "";
    let userHistory = "";

    if (action === "my_tone") {
      const { data: msgs } = await supabase
        .from("whatsapp_messages")
        .select("content")
        .eq("is_from_me", true)
        .not("content", "is", null)
        .order("timestamp", { ascending: false })
        .limit(20);
      if (msgs && msgs.length > 0) {
        userHistory = msgs.map((m: any, i: number) => `${i + 1}. "${m.content}"`).join("\n");
      }
    }

    const languageNames: Record<string, string> = { en: "inglês", es: "espanhol", fr: "francês", de: "alemão", it: "italiano", pt: "português" };

    switch (action) {
      case "expand":
        prompt = `Expanda esta mensagem em uma resposta completa e profissional:\n\n"${message}"\n\nResponda apenas com o texto expandido.`;
        break;
      case "rephrase":
        prompt = `Reformule esta mensagem mantendo o mesmo significado:\n\n"${message}"\n\nResponda apenas com o texto reformulado.`;
        break;
      case "my_tone":
        prompt = userHistory
          ? `Exemplos de mensagens anteriores:\n\n${userHistory}\n\nReescreva usando o mesmo estilo:\n\n"${message}"\n\nResponda apenas com a mensagem reescrita.`
          : `Reescreva de forma profissional e amigável:\n\n"${message}"\n\nResponda apenas com a mensagem reescrita.`;
        break;
      case "friendly":
        prompt = `Reescreva de forma casual, amigável e acolhedora com emojis:\n\n"${message}"\n\nResponda apenas com a versão amigável.`;
        break;
      case "formal":
        prompt = `Reescreva de forma profissional e formal:\n\n"${message}"\n\nResponda apenas com a versão formal.`;
        break;
      case "fix_grammar":
        prompt = `Corrija gramática, ortografia e pontuação:\n\n"${message}"\n\nResponda apenas com o texto corrigido.`;
        break;
      case "simplify":
        prompt = `Reescreva esta mensagem t\u{00E9}cnica de forma simples e clara, como se estivesse explicando para uma pessoa leiga que n\u{00E3}o entende termos t\u{00E9}cnicos. Use linguagem do dia a dia, exemplos pr\u{00E1}ticos se necess\u{00E1}rio, e mantenha um tom amig\u{00E1}vel:\n\n"${message}"\n\nResponda apenas com a vers\u{00E3}o simplificada.`;
        break;
      case "translate":
        prompt = `Traduza para ${languageNames[targetLanguage || "en"] || targetLanguage}:\n\n"${message}"\n\nResponda apenas com a tradução.`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    let composedText: string;
    try {
      const aiResult = await callAI(aiConfig, [{ role: "user", content: prompt }]);
      await supabase.from('ai_usage_log').update({
        input_tokens: aiResult.usage.inputTokens,
        output_tokens: aiResult.usage.outputTokens,
        estimated_cost_usd: aiResult.usage.estimatedCostUsd,
        model: aiConfig.model,
        provider: aiConfig.provider,
      }).eq('tenant_id', profile.tenant_id).eq('function_name', 'compose-whatsapp-message').order('called_at', { ascending: false }).limit(1);
      composedText = aiResult.content;
    } catch (aiError: any) {
      const msg = aiError.message || "";
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ error: "ai_key_invalid", message: "Chave de API inválida." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429")) {
        return new Response(JSON.stringify({ error: "rate_limit", message: "Limite da API atingido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw aiError;
    }

    return new Response(
      JSON.stringify({ original: message, composed: composedText.trim(), action }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[compose-whatsapp-message] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
