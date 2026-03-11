import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const systemPrompt = `Você é um especialista em categorizar conversas de atendimento ao cliente via WhatsApp.
TÓPICOS PADRÃO (SEMPRE PREFERIR ESTES):
Comercial: vendas, cobranca, renovacao
Suporte: duvida_tecnica, duvida_produto, acesso
Relacionamento: feedback, cancelamento, onboarding
Operacional: agendamento, documentacao, atualizacao_cadastral
Outros: geral, spam
TAREFA: Analise a conversa e retorne um JSON com:
{ "primary_topic": "tópico principal", "secondary_topics": ["tópico 2"], "confidence": 0.95, "reasoning": "breve explicação", "custom_topic": null }
REGRAS: 1. SEMPRE tente encaixar nos tópicos padrão primeiro. 2. Retorne APENAS o JSON, sem markdown.`;

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
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { conversationId } = await req.json();
    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversationId é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("tenant_id, metadata")
      .eq("id", conversationId)
      .single();

    if (!convData) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message: "Nenhuma IA configurada. Acesse Configurações > Inteligência Artificial.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: messages, error: msgError } = await supabase
      .from("whatsapp_messages")
      .select("content, is_from_me, message_type")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: true });

    if (msgError) throw msgError;

    const textMessages =
      messages
        ?.filter((m) => m.content && m.message_type === "text")
        .map((m) => `${m.is_from_me ? "Atendente" : "Cliente"}: ${m.content}`) || [];

    if (textMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: "Sem mensagens de texto para categorizar" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recentMessages = textMessages.slice(-50);

    let result: any;
    try {
      const rawResult = await callAI(aiConfig, [
        { role: "system", content: systemPrompt },
        { role: "user", content: `CONVERSA:\n\n${recentMessages.join("\n")}` },
      ]);
      const clean = rawResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(clean);
    } catch (aiError: any) {
      const msg = aiError.message || "";
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ error: "ai_key_invalid", message: "Chave de API inválida." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429")) {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw aiError;
    }

    const topics = [result.primary_topic, ...(result.secondary_topics || [])].filter(Boolean);
    if (result.custom_topic) topics.push(result.custom_topic);

    const existingMetadata = (convData.metadata as object) || {};
    const newMetadata = {
      ...existingMetadata,
      topics,
      primary_topic: result.primary_topic,
      ai_confidence: result.confidence || 0.8,
      categorized_at: new Date().toISOString(),
      categorization_model: aiConfig.model,
      ai_reasoning: result.reasoning,
      custom_topics: result.custom_topic ? [result.custom_topic] : [],
    };

    const { error: updateError } = await supabase
      .from("whatsapp_conversations")
      .update({ metadata: newMetadata })
      .eq("id", conversationId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, metadata: newMetadata, message: "Conversa categorizada com sucesso" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[categorize] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido", success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
