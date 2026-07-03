import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders, status: 204 });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (!profile.is_super_admin && !["admin", "head"].includes(profile.role))) {
      throw new Error("Sem permissao");
    }

    const { summary, evaluations, filters } = await req.json();

    const aiConfig = await getAIConfig(profile.tenant_id, supabaseAdmin);
    if (!aiConfig) throw new Error("IA nao configurada para este tenant");

    const evalText = evaluations
      .slice(0, 50)
      .map((e: any) => `- Nota ${e.score}/${filters.scoreMax} | ${e.setor} | ${e.cliente_nome}${e.reason ? ` | Motivo: "${e.reason}"` : " | Sem comentario"}`)
      .join("\n");

    const prompt = `Voce e um analista de qualidade de atendimento ao cliente.

Analise os seguintes dados de CSAT (Customer Satisfaction Score) do periodo ${filters.dateFrom} a ${filters.dateTo}:

## Resumo
- Media: ${summary.media ?? "N/A"}/${filters.scoreMax}
- Respostas: ${summary.respostas} de ${summary.enviadas} enviadas (${summary.enviadas > 0 ? Math.round((summary.respostas / summary.enviadas) * 100) : 0}% taxa de resposta)
${filters.department ? `- Setor filtrado: ${filters.department}` : "- Todos os setores"}
${filters.agent ? `- Agente filtrado: ${filters.agent}` : ""}

## Avaliacoes individuais (${evaluations.length} registros):
${evalText}

## Sua analise deve conter:

1. **Diagnostico geral**: Resumo da situacao (2-3 frases diretas)
2. **Pontos criticos**: Problemas identificados nos comentarios negativos e notas baixas
3. **Pontos positivos**: O que esta funcionando bem
4. **Taxa de resposta**: Avaliacao se esta boa ou precisa melhorar, com sugestao
5. **Plano de acao**: 3-5 acoes concretas e priorizadas para melhorar o CSAT, com responsavel sugerido (ex: "Gestao", "Suporte", "Treinamento")

Responda em portugues brasileiro, direto ao ponto, sem enrolacao. Use markdown para formatacao.`;

    const result = await callAI(aiConfig, [
      { role: "system", content: "Voce e um consultor de qualidade e satisfacao do cliente. Responda sempre em pt-BR." },
      { role: "user", content: prompt },
    ], undefined, { maxTokens: 3000 });

    await supabaseAdmin.from("ai_usage_log").insert({
      tenant_id: profile.tenant_id,
      function_name: "analyze-csat",
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      estimated_cost_usd: result.usage.estimatedCostUsd,
      model: aiConfig.model,
      provider: aiConfig.provider,
    }).then(() => {});

    return new Response(
      JSON.stringify({ analysis: result.content, usage: result.usage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
