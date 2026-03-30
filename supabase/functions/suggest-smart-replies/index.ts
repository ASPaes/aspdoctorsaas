import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const defaultSuggestions = [
  { text: "Olá! Como posso ajudá-lo(a) hoje?", tone: "formal" },
  { text: "Oi! Em que posso te ajudar? 😊", tone: "friendly" },
  { text: "Oi! Qual sua dúvida?", tone: "direct" },
];

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
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { conversationId } = await req.json();
    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversationId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("tenant_id, contact:whatsapp_contacts(name)")
      .eq("id", conversationId)
      .single();

    if (!convData) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          ok: true,
          suggestions: defaultSuggestions,
          context: { contactName: (convData.contact as any)?.name || "Cliente", lastMessage: "" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: messages } = await supabase
      .from("whatsapp_messages")
      .select("content, is_from_me, timestamp, message_type")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(10);

    const contactName = (convData.contact as any)?.name || "Cliente";
    const textMessages = messages?.filter((m) => m.message_type === "text").reverse() || [];

    if (textMessages.length === 0) {
      return new Response(
        JSON.stringify({ suggestions: defaultSuggestions, context: { contactName, lastMessage: "" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lastClientMessage = textMessages.filter((m) => !m.is_from_me).pop();
    if (!lastClientMessage) {
      return new Response(
        JSON.stringify({ suggestions: defaultSuggestions, context: { contactName, lastMessage: "" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recentMessages = textMessages
      .slice(-8)
      .map((m) => `${m.is_from_me ? "Você" : contactName}: ${m.content}`)
      .join("\n");

    const systemPrompt = `Você é um assistente que gera respostas CURTAS (até 2 frases) e ÚTEIS para atendimento ao cliente.
REGRAS: Foque em resolver ou encaminhar. Varie o tom: formal, amigável, direto. Use português do Brasil.
CONTEXTO: Cliente: ${contactName}. Última mensagem: "${lastClientMessage.content}". Histórico: ${recentMessages}`;

    const tools = [
      {
        type: "function",
        function: {
          name: "suggest_replies",
          description: "Retorna 3 sugestões de resposta com tons diferentes",
          parameters: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    tone: { type: "string", enum: ["formal", "friendly", "direct"] },
                  },
                  required: ["text", "tone"],
                },
                minItems: 3,
                maxItems: 3,
              },
            },
            required: ["suggestions"],
          },
        },
      },
    ];

    let suggestions = defaultSuggestions;
    try {
      const rawResult = await callAI(
        aiConfig,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Gere 3 sugestões de resposta com tons diferentes." },
        ],
        tools
      );
      const parsed = JSON.parse(rawResult);
      suggestions = parsed.suggestions || defaultSuggestions;
    } catch (aiError: any) {
      const msg = aiError.message || "";
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ error: "ai_key_invalid", message: "Chave de API inválida.", suggestions: defaultSuggestions }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429")) {
        return new Response(JSON.stringify({ ok: true, rate_limited: true, error: "rate_limit", suggestions: defaultSuggestions }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("[suggest-smart-replies] AI error:", aiError);
    }

    return new Response(
      JSON.stringify({ suggestions, context: { contactName, lastMessage: lastClientMessage.content } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[suggest-smart-replies] Error:", error);
    return new Response(
      JSON.stringify({ suggestions: defaultSuggestions, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
