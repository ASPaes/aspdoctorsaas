import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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
      .insert({ tenant_id: tenantId, function_name: functionName })
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

    // --- If attendanceId provided, generate for that specific attendance ---
    if (attendanceId) {
      return await handleAttendanceSummary(supabase, aiConfig, conversation, attendanceId, conversationId);
    }

    // --- Otherwise, generate conversation-level summary covering last 5-6 attendances ---
    return await handleConversationSummary(supabase, aiConfig, conversation, conversationId);

  } catch (error) {
    console.error("[generate-summary] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleAttendanceSummary(
  supabase: any, aiConfig: any, conversation: any, attendanceId: string, conversationId: string
) {
  const { data: att } = await supabase
    .from("support_attendances")
    .select("opened_at, closed_at")
    .eq("id", attendanceId)
    .single();

  const periodStart = att?.opened_at || null;
  const periodEnd = att?.closed_at || new Date().toISOString();

  let query = supabase
    .from("whatsapp_messages")
    .select("content, timestamp, is_from_me, audio_transcription, message_type")
    .eq("conversation_id", conversationId)
    .order("timestamp", { ascending: false })
    .limit(50);

  if (periodStart) query = query.gte("timestamp", periodStart);
  if (periodEnd) query = query.lte("timestamp", periodEnd);

  const { data: messages, error: messagesError } = await query;
  if (messagesError) throw messagesError;

  if (!messages || messages.length < 3) {
    return new Response(
      JSON.stringify({ message: "Mínimo de 3 mensagens necessário para resumo." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const contactName = (conversation.contact as any)?.name || "Cliente";
  const messagesText = formatMessages(messages);

  const prompt = buildSingleAttendancePrompt(contactName, messagesText);
  const result = await callAndParseAI(aiConfig, prompt);
  if (result instanceof Response) return result;

  // Update attendance AI fields
  await supabase
    .from("support_attendances")
    .update({
      ai_summary: result.summary?.substring(0, 200) || null,
      ai_problem: result.problem || null,
      ai_solution: result.solution || null,
      ai_tags: result.tags || result.key_points || [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", attendanceId);

  return new Response(JSON.stringify({
    success: true,
    ai_summary: result.summary,
    ai_problem: result.problem,
    ai_solution: result.solution,
    ai_tags: result.tags || [],
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleConversationSummary(
  supabase: any, aiConfig: any, conversation: any, conversationId: string
) {
  // Fetch last 6 attendances for this conversation
  const { data: attendances } = await supabase
    .from("support_attendances")
    .select("id, attendance_code, opened_at, closed_at, ai_summary, ai_problem, ai_solution, ai_tags, area_id, support_areas(nome)")
    .eq("conversation_id", conversationId)
    .order("opened_at", { ascending: false })
    .limit(6);

  const contactName = (conversation.contact as any)?.name || "Cliente";

  let promptContent: string;

  if (attendances && attendances.length > 0) {
    // Build summary from attendance history
    const attendanceSummaries = attendances
      .reverse()
      .map((att: any, i: number) => {
        const area = att.support_areas?.nome || "N/A";
        const code = att.attendance_code || `#${i + 1}`;
        const problem = att.ai_problem || "Sem registro";
        const solution = att.ai_solution || "Sem registro";
        const summary = att.ai_summary || "Sem resumo";
        const tags = (att.ai_tags || []).join(", ") || "Sem tags";
        return `Atendimento ${code} (Área: ${area}):
- Problema: ${problem}
- Solução: ${solution}
- Resumo: ${summary}
- Tags: ${tags}`;
      })
      .join("\n\n");

    promptContent = `Analise o histórico dos últimos atendimentos deste contato e gere um resumo consolidado.

Contato: ${contactName}
Quantidade de atendimentos: ${attendances.length}

${attendanceSummaries}

Retorne APENAS um JSON válido sem markdown:
{
  "summary": "Resumo consolidado do histórico de atendimentos (máx 300 palavras). Descreva os principais temas, problemas recorrentes e padrões de atendimento deste contato.",
  "key_points": ["Ponto 1", "Ponto 2", "Ponto 3"],
  "action_items": ["Recomendação 1"],
  "sentiment": "positive|neutral|negative",
  "tags": ["tag1", "tag2"]
}

REGRAS:
- "summary": Resumo consolidado que cubra TODOS os atendimentos listados, identificando padrões e recorrências.
- "key_points": Os pontos mais relevantes do histórico deste contato.
- "action_items": Recomendações para próximos atendimentos baseadas no histórico.
- "sentiment": Sentimento geral do contato ao longo dos atendimentos.
- "tags": palavras-chave únicas e curtas (1-2 palavras) que representem os temas recorrentes.`;
  } else {
    // No attendances, use last 50 messages
    const { data: messages } = await supabase
      .from("whatsapp_messages")
      .select("content, timestamp, is_from_me, audio_transcription, message_type")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(50);

    if (!messages || messages.length < 3) {
      return new Response(
        JSON.stringify({ message: "Mínimo de 3 mensagens necessário para resumo." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messagesText = formatMessages(messages);
    promptContent = `Analise esta conversa de WhatsApp e gere um resumo consolidado.

Conversa com: ${contactName}
${messagesText}

Retorne APENAS um JSON válido sem markdown:
{
  "summary": "Resumo completo da conversa (máx 300 palavras).",
  "key_points": ["Ponto 1", "Ponto 2"],
  "action_items": ["Ação 1"],
  "sentiment": "positive|neutral|negative",
  "tags": ["tag1", "tag2"]
}`;
  }

  const result = await callAndParseAI(aiConfig, promptContent);
  if (result instanceof Response) return result;

  const totalMessages = attendances?.reduce((sum: number, a: any) => sum + 1, 0) || 0;

  // UPSERT: delete existing summaries for this conversation, insert new one
  await supabase
    .from("whatsapp_conversation_summaries")
    .delete()
    .eq("conversation_id", conversationId);

  const { data: savedSummary, error: saveError } = await supabase
    .from("whatsapp_conversation_summaries")
    .insert({
      conversation_id: conversationId,
      tenant_id: conversation.tenant_id,
      summary: result.summary,
      key_points: result.key_points || [],
      action_items: result.action_items || [],
      sentiment_at_time: result.sentiment,
      message_count: totalMessages,
      period_start: attendances?.[attendances.length - 1]?.opened_at || new Date().toISOString(),
      period_end: attendances?.[0]?.opened_at || new Date().toISOString(),
    })
    .select()
    .single();

  if (saveError) throw saveError;

  return new Response(JSON.stringify({ success: true, summary: savedSummary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatMessages(messages: any[]): string {
  return messages
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
}

function buildSingleAttendancePrompt(contactName: string, messagesText: string): string {
  return `Analise esta conversa de WhatsApp e extraia informações estruturadas para uma base de conhecimento de suporte.
IMPORTANTE: Analise SOMENTE as mensagens abaixo, que correspondem a um único atendimento específico.

Conversa com: ${contactName}
${messagesText}

Retorne APENAS um JSON válido sem markdown com os seguintes campos:

{
  "summary": "Resumo completo do atendimento (máx 200 palavras).",
  "problem": "Descreva SOMENTE o problema ou dúvida relatada pelo CLIENTE nas primeiras mensagens.",
  "solution": "Descreva de forma interpretativa como o ATENDENTE resolveu o problema.",
  "key_points": ["Ponto 1", "Ponto 2"],
  "action_items": ["Ação 1"],
  "sentiment": "positive|neutral|negative",
  "tags": ["palavra1", "palavra2"]
}

REGRAS:
- "problem": SOMENTE a dúvida/problema do cliente, sem incluir a resolução.
- "solution": Interpretação da orientação dada pelo técnico, escrita de forma instrucional.
- "summary": Resumo geral de todo o atendimento, do início ao fim.
- "tags": palavras-chave únicas e curtas (1-2 palavras).`;
}

async function callAndParseAI(aiConfig: any, prompt: string): Promise<any> {
  try {
    const rawResult = await callAI(aiConfig, [
      { role: "system", content: "Você é um assistente de atendimento ao cliente. Gere resumos objetivos e úteis. Sempre responda com JSON válido sem formatação markdown." },
      { role: "user", content: prompt },
    ]);
    try {
      return JSON.parse(rawResult);
    } catch {
      const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      throw new Error("Resposta da IA não contém JSON válido");
    }
  } catch (aiError: any) {
    const msg = aiError.message || "";
    if (msg.includes("401") || msg.includes("invalid_api_key")) {
      return new Response(JSON.stringify({ error: "ai_key_invalid", message: "Chave de API inválida." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg.includes("429")) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    throw aiError;
  }
}
