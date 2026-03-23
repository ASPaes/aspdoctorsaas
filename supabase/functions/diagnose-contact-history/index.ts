import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const FUNCTION_NAME = "diagnose-contact-history";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${FUNCTION_NAME}][${requestId}] Início - ${req.method}`);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Token ausente" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    // Get profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Forbidden", status: 403, detail: "Perfil não encontrado" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    const isAdminOrHead = profile.is_super_admin || profile.role === "admin" || profile.role === "head";
    if (!isAdminOrHead) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Forbidden", status: 403, detail: "Apenas Admin/Head" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    const tenantId = profile.tenant_id;
    const { contactId, messages } = await req.json();

    if (!contactId || !messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Validation Error", status: 400, detail: "contactId e messages são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] tenant=${tenantId} contact=${contactId} msgs=${messages.length}`);

    // Get AI config
    const aiConfig = await getAIConfig(tenantId, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "IA não configurada para este tenant" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    // Truncate messages to avoid token limits (keep last 200 or so)
    const truncated = messages.slice(-200);

    const systemPrompt = `Você é um analista de qualidade de atendimento ao cliente. Analise o histórico de mensagens entre o cliente e a equipe de suporte.

Retorne uma análise estruturada em JSON com:
- resumo: resumo geral do histórico (2-3 parágrafos)
- sentimento: sentimento predominante do cliente ("positive", "neutral" ou "negative")
- pontos_chave: array de 3-6 pontos-chave do atendimento
- itens_acao: array de 2-4 itens de ação recomendados
- nota: nota sugerida de 1 a 5 para a qualidade do atendimento (1=péssimo, 5=excelente)

Considere: tempo de resposta, resolução de problemas, tom de comunicação, satisfação do cliente, proatividade da equipe.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "submit_diagnosis",
          description: "Submete o diagnóstico estruturado do atendimento",
          parameters: {
            type: "object",
            properties: {
              resumo: { type: "string", description: "Resumo geral do histórico" },
              sentimento: { type: "string", enum: ["positive", "neutral", "negative"] },
              pontos_chave: { type: "array", items: { type: "string" } },
              itens_acao: { type: "array", items: { type: "string" } },
              nota: { type: "integer", minimum: 1, maximum: 5 },
            },
            required: ["resumo", "sentimento", "pontos_chave", "itens_acao", "nota"],
          },
        },
      },
    ];

    const userContent = `Histórico de mensagens do contato:\n\n${truncated.join("\n")}`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];

    console.log(`[${FUNCTION_NAME}][${requestId}] Calling AI provider=${aiConfig.provider} model=${aiConfig.model}`);

    let result: string;
    try {
      // Try with tools first (OpenAI/custom)
      if (aiConfig.provider === "openai" || aiConfig.provider === "custom") {
        result = await callAI(aiConfig, aiMessages, tools);
      } else {
        // For Anthropic/Gemini, use plain text and parse JSON
        const plainPrompt = systemPrompt + "\n\nResponda APENAS com JSON válido no formato: {\"resumo\": \"...\", \"sentimento\": \"positive|neutral|negative\", \"pontos_chave\": [...], \"itens_acao\": [...], \"nota\": N}";
        result = await callAI(aiConfig, [
          { role: "system", content: plainPrompt },
          { role: "user", content: userContent },
        ]);
      }
    } catch (aiError: any) {
      console.error(`[${FUNCTION_NAME}][${requestId}] AI error:`, aiError.message);
      return new Response(
        JSON.stringify({ type: "about:blank", title: "AI Error", status: 502, detail: aiError.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    // Parse result
    let diagnosis;
    try {
      // Try parsing directly
      diagnosis = JSON.parse(result);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        diagnosis = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in text
        const braceMatch = result.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          diagnosis = JSON.parse(braceMatch[0]);
        } else {
          throw new Error("Could not parse AI response as JSON");
        }
      }
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Diagnosis generated: nota=${diagnosis.nota} sentimento=${diagnosis.sentimento}`);

    return new Response(JSON.stringify(diagnosis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Error:`, error.message);
    return new Response(
      JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, detail: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
    );
  }
});
