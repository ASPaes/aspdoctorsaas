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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { conversationId, attendanceId } = await req.json();
    if (!conversationId) throw new Error("conversationId é obrigatório");

    const { data: conversation } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:whatsapp_contacts(name)")
      .eq("id", conversationId)
      .single();

    if (!conversation) throw new Error("Conversa não encontrada");

    const aiConfig = await getAIConfig(conversation.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message: "Nenhuma IA configurada. Acesse Configurações > Inteligência Artificial.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Determine time window ---
    let periodStart: string | null = null;
    let periodEnd: string | null = null;

    if (attendanceId) {
      const { data: att } = await supabase
        .from("support_attendances")
        .select("opened_at, closed_at")
        .eq("id", attendanceId)
        .single();

      if (att) {
        periodStart = att.opened_at;
        periodEnd = att.closed_at || new Date().toISOString();
        console.log(`[generate-summary] Scoping to attendance ${attendanceId}: ${periodStart} → ${periodEnd}`);
      }
    }

    // --- Fetch messages (scoped to attendance window if available) ---
    let query = supabase
      .from("whatsapp_messages")
      .select("content, timestamp, is_from_me, audio_transcription, message_type")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(50);

    if (periodStart) {
      query = query.gte("timestamp", periodStart);
    }
    if (periodEnd) {
      query = query.lte("timestamp", periodEnd);
    }

    const { data: messages, error: messagesError } = await query;
    if (messagesError) throw messagesError;

    if (!messages || messages.length < 3) {
      return new Response(
        JSON.stringify({ message: "Mínimo de 3 mensagens necessário para resumo." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messagesText = messages
      .reverse()
      .map((m: any) => {
        const role = m.is_from_me ? "Atendente" : "Cliente";
        const text =
          m.message_type === "audio" && m.audio_transcription
            ? `[Áudio transcrito]: "${m.audio_transcription}"`
            : m.content;
        return `[${role}]: ${text}`;
      })
      .join("\n");

    const contactName = (conversation.contact as any)?.name || "Cliente";
    const scopeNote = attendanceId
      ? "IMPORTANTE: Analise SOMENTE as mensagens abaixo, que correspondem a um único atendimento específico. Não extrapole para contextos anteriores."
      : "";

    const prompt = `Analise esta conversa de WhatsApp e gere um resumo estruturado.
${scopeNote}

Conversa com: ${contactName}
${messagesText}

Retorne APENAS um JSON válido sem markdown:
{ "summary": "Resumo da conversa (máx 200 palavras)", "key_points": ["Ponto 1", "Ponto 2"], "action_items": ["Ação 1"], "sentiment": "positive" }`;

    let result: any;
    try {
      const rawResult = await callAI(aiConfig, [
        { role: "system", content: "Você é um assistente de atendimento ao cliente. Gere resumos objetivos e úteis. Sempre responda com JSON válido sem formatação markdown." },
        { role: "user", content: prompt },
      ]);
      try {
        result = JSON.parse(rawResult);
      } catch {
        const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) result = JSON.parse(jsonMatch[0]);
        else throw new Error("Resposta da IA não contém JSON válido");
      }
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

    const { data: savedSummary, error: saveError } = await supabase
      .from("whatsapp_conversation_summaries")
      .insert({
        conversation_id: conversationId,
        tenant_id: conversation.tenant_id,
        summary: result.summary,
        key_points: result.key_points || [],
        action_items: result.action_items || [],
        sentiment_at_time: result.sentiment,
        message_count: messages.length,
        period_start: messages[0].timestamp,
        period_end: messages[messages.length - 1].timestamp,
        ...(attendanceId ? { attendance_id: attendanceId } : {}),
      })
      .select()
      .single();

    if (saveError) throw saveError;

    // --- Update attendance AI fields if attendanceId provided ---
    if (attendanceId) {
      await supabase
        .from("support_attendances")
        .update({
          ai_summary: result.summary?.substring(0, 200) || null,
          ai_problem: result.summary || null,
          ai_solution: (result.action_items || []).join("\n") || null,
          ai_tags: result.key_points || [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", attendanceId);
      console.log(`[generate-summary] Updated attendance AI fields for ${attendanceId}`);
    }

    return new Response(JSON.stringify({ success: true, summary: savedSummary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[generate-summary] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
