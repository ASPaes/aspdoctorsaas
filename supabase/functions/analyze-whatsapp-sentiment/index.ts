import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "ai_not_configured",
          message: "Nenhuma IA configurada para este tenant. Acesse Configurações > Inteligência Artificial para configurar.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("whatsapp_messages")
      .select("content, timestamp, audio_transcription, message_type")
      .eq("conversation_id", conversationId)
      .eq("is_from_me", false)
      .order("timestamp", { ascending: false })
      .limit(10);

    if (messagesError) throw messagesError;

    if (!messages || messages.length < 3) {
      return new Response(
        JSON.stringify({ success: false, message: "Mínimo 3 mensagens necessário para análise", messagesFound: messages?.length || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderedMessages = [...messages].reverse();
    const messagesText = orderedMessages
      .map((msg: any, index: number) => {
        const text =
          msg.message_type === "audio" && msg.audio_transcription
            ? `[Áudio transcrito]: "${msg.audio_transcription}"`
            : `"${msg.content}"`;
        return `${index + 1}. [${new Date(msg.timestamp).toLocaleString("pt-BR")}]: ${text}`;
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
      const rawResult = await callAI(aiConfig, [{ role: "user", content: prompt }], tools);
      result = JSON.parse(rawResult);
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
