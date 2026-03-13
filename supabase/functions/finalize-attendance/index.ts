import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const FUNCTION_NAME = "finalize-attendance";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  console.log(`[${FUNCTION_NAME}][${requestId}] Início`);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Token ausente" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { attendanceId } = await req.json();
    if (!attendanceId) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Validation Error", status: 400, detail: "attendanceId é obrigatório", requestId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] attendanceId=${attendanceId}`);

    // 1. Fetch attendance
    const { data: att, error: attErr } = await supabase
      .from("support_attendances")
      .select("id, tenant_id, conversation_id, opened_at, closed_at, area_id, ai_summary")
      .eq("id", attendanceId)
      .single();

    if (attErr || !att) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Atendimento não encontrado`);
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, detail: "Atendimento não encontrado", requestId }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
      );
    }

    // 2. Check if KB already exists (dedup)
    const { data: existingKb } = await supabase
      .from("support_kb_articles")
      .select("id")
      .eq("source_attendance_id", attendanceId)
      .limit(1)
      .maybeSingle();

    if (existingKb) {
      console.log(`[${FUNCTION_NAME}][${requestId}] KB já existe, skip`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "kb_already_exists" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check AI config
    const aiConfig = await getAIConfig(att.tenant_id, supabase);
    if (!aiConfig) {
      console.log(`[${FUNCTION_NAME}][${requestId}] IA não configurada, criando KB básico`);
      // Create basic KB draft without AI
      await supabase.from("support_kb_articles").insert({
        tenant_id: att.tenant_id,
        source_attendance_id: attendanceId,
        title: "Atendimento sem análise IA",
        problem: "",
        solution: "",
        tags: [],
        area_id: att.area_id || null,
        status: "draft",
      });
      return new Response(
        JSON.stringify({ success: true, ai: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Fetch messages within attendance window
    const periodStart = att.opened_at;
    const periodEnd = att.closed_at || new Date().toISOString();

    let msgQuery = supabase
      .from("whatsapp_messages")
      .select("content, timestamp, is_from_me, audio_transcription, message_type")
      .eq("conversation_id", att.conversation_id)
      .order("timestamp", { ascending: false })
      .limit(40);

    if (periodStart) msgQuery = msgQuery.gte("timestamp", periodStart);
    if (periodEnd) msgQuery = msgQuery.lte("timestamp", periodEnd);

    const { data: messages } = await msgQuery;

    if (!messages || messages.length < 2) {
      console.log(`[${FUNCTION_NAME}][${requestId}] Poucas mensagens (${messages?.length || 0}), criando KB básico`);
      await supabase.from("support_kb_articles").insert({
        tenant_id: att.tenant_id,
        source_attendance_id: attendanceId,
        title: "Atendimento com poucas mensagens",
        problem: "",
        solution: "",
        tags: [],
        area_id: att.area_id || null,
        status: "draft",
      });
      return new Response(
        JSON.stringify({ success: true, ai: false, reason: "too_few_messages" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Format messages
    const messagesText = messages
      .reverse()
      .map((m: any) => {
        const role = m.is_from_me ? "Técnico" : "Cliente";
        const text =
          m.message_type === "audio" && m.audio_transcription
            ? `[Áudio]: "${m.audio_transcription}"`
            : m.content;
        return `[${role}]: ${text}`;
      })
      .join("\n");

    // 6. Fetch available support_areas for area suggestion
    const { data: areas } = await supabase
      .from("support_areas")
      .select("id, nome")
      .eq("tenant_id", att.tenant_id)
      .eq("ativo", true);

    const areaNames = (areas || []).map((a: any) => a.nome).join(", ");

    // 7. Single consolidated AI call
    console.log(`[${FUNCTION_NAME}][${requestId}] Chamando IA consolidada (${messages.length} msgs)`);

    const prompt = `Analise este atendimento de suporte técnico e retorne um JSON com análise completa.

Mensagens do atendimento:
${messagesText}

${areaNames ? `Áreas disponíveis: ${areaNames}` : ""}

Retorne APENAS JSON válido sem markdown:
{
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0,
  "topics": ["topico1"],
  "summary": "Resumo curto (máx 80 palavras)",
  "title": "Título curto para KB (máx 80 chars)",
  "problem": "Problema/dúvida do cliente (máx 80 palavras)",
  "solution": "Como o técnico resolveu (máx 80 palavras)",
  "tags": ["tag1"],
  "suggested_area": "nome da área mais adequada ou null"
}

REGRAS:
- Seja conciso e objetivo
- "problem": apenas o relato inicial do cliente
- "solution": orientação do técnico, forma instrucional
- "tags": máximo 5, palavras curtas (1-2 termos)
- "topics": máximo 5
- "suggested_area": escolha entre as áreas disponíveis ou null`;

    const rawResult = await callAI(
      { ...aiConfig, ...(aiConfig.provider === "openai" || aiConfig.provider === "custom" ? {} : {}) },
      [
        { role: "system", content: "Analista de suporte técnico. Responda apenas JSON válido, sem markdown." },
        { role: "user", content: prompt },
      ]
    );

    let result: any;
    try {
      result = JSON.parse(rawResult);
    } catch {
      const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Resposta da IA não contém JSON válido");
      }
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] IA retornou: sentiment=${result.sentiment}, topics=${result.topics?.length || 0}`);

    // 8. Save AI fields to support_attendances
    await supabase
      .from("support_attendances")
      .update({
        ai_summary: (result.summary || "").substring(0, 500),
        ai_problem: (result.problem || "").substring(0, 1000),
        ai_solution: (result.solution || "").substring(0, 1000),
        ai_tags: result.tags || [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", attendanceId);

    // 9. Upsert sentiment
    const sentimentValue = ["positive", "negative", "neutral"].includes(result.sentiment)
      ? result.sentiment
      : "neutral";
    const confidence = typeof result.confidence === "number" ? Math.min(1, Math.max(0, result.confidence)) : 0.7;

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("contact_id")
      .eq("id", att.conversation_id)
      .single();

    if (convData?.contact_id) {
      await supabase.from("whatsapp_sentiments").upsert(
        {
          tenant_id: att.tenant_id,
          conversation_id: att.conversation_id,
          contact_id: convData.contact_id,
          sentiment: sentimentValue,
          confidence,
          summary: (result.summary || "").substring(0, 500),
          keywords: result.tags || [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,conversation_id" }
      );
    }

    // 10. Update conversation metadata with topics
    if (result.topics && result.topics.length > 0) {
      const { data: conv } = await supabase
        .from("whatsapp_conversations")
        .select("metadata")
        .eq("id", att.conversation_id)
        .single();

      const existingMetadata = (conv?.metadata || {}) as Record<string, any>;
      await supabase
        .from("whatsapp_conversations")
        .update({
          metadata: {
            ...existingMetadata,
            topics: result.topics,
            primary_topic: result.topics[0],
            ai_confidence: confidence,
            categorized_at: new Date().toISOString(),
          },
        })
        .eq("id", att.conversation_id);
    }

    // 11. Resolve area_id from suggested_area
    let resolvedAreaId = att.area_id || null;
    if (result.suggested_area && areas && areas.length > 0) {
      const suggestedLower = result.suggested_area.toLowerCase();
      const match = areas.find((a: any) => a.nome.toLowerCase() === suggestedLower);
      if (match) resolvedAreaId = match.id;
    }

    // 12. Create KB draft
    await supabase.from("support_kb_articles").insert({
      tenant_id: att.tenant_id,
      source_attendance_id: attendanceId,
      title: (result.title || result.summary || "").substring(0, 120),
      summary: (result.summary || "").substring(0, 500),
      problem: result.problem || "",
      solution: result.solution || "",
      tags: Array.isArray(result.tags) ? result.tags : [],
      area_id: resolvedAreaId,
      status: "draft",
    });

    console.log(`[${FUNCTION_NAME}][${requestId}] Sucesso — KB draft criado, sentimento=${sentimentValue}`);

    return new Response(
      JSON.stringify({ success: true, sentiment: sentimentValue, topics: result.topics || [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Erro:`, error);
    return new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : "Erro desconhecido",
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/problem+json" } }
    );
  }
});
