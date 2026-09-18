// DEM-0277: resumo de grupo de WhatsApp por IA, com historico.
//
// action = "preview"  -> conta o que entra no periodo e diz se ja existe resumo
//                        igual (sem mensagem nova depois). Nao chama IA.
// action = "generate" -> grava a linha em whatsapp_group_summaries (status
//                        generating), responde na hora e roda a IA em segundo
//                        plano. A tela acompanha pela linha.
//
// Diferente da generate-conversation-summary: le TODAS as mensagens do periodo
// (nao so 50) e nunca apaga resumo anterior.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";
import { callAI, getAIConfig } from "../_shared/ai-client.ts";
import {
  buildLines,
  chunkLines,
  countItems,
  type Line,
  parseSections,
  type RawMessage,
  SECTION_KEYS,
  type Sections,
  sectionsForMerge,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FN = "summarize-whatsapp-group";
const MAX_LINES = 5000;
const MAX_PERIOD_DAYS = 93;
const CHUNK_CHARS = 60_000;
const STALE_MINUTES = 10;

const SYSTEM_PROMPT = `Você organiza conversas de grupos de WhatsApp entre a equipe de uma empresa de software e o cliente dela (implantação, suporte, treinamento).
Responda sempre em português do Brasil.

Cada mensagem vem numa linha: #número [dia/mês hora:min] Nome (equipe|cliente): texto.

Separe o que aconteceu nestas seções:
- interacoes: o que foi feito ou tratado no período, em frases objetivas.
- treinamentos: treinamentos (tema, quem conduziu). Diga se foi realizado ou agendado, nunca "realizado/agendado"; sem confirmação de que aconteceu, é agendado.
- duvidas: dúvidas do cliente e a resposta dada ("Pergunta? Resposta.").
- pendencias_cliente: o que o CLIENTE ficou de fazer ou enviar e ainda está em aberto no fim do período.
- pendencias_internas: o que a EQUIPE ficou de fazer e ainda está em aberto no fim do período.
- decisoes: definições combinadas entre as partes.
- proximos_passos: próximas ações, em ordem.

Regras:
- Use só o que está nas mensagens. Não invente prazo, nome ou fato.
- Diga quem é responsável e a data quando a mensagem disser ("Marcos enviar a planilha até 19/09").
- Um item por assunto, curto. Ignore cumprimentos e conversa sem conteúdo.
- Em cada item, "ref" é o número (#) da mensagem que melhor comprova o item. Use null se não houver uma.
- Pendência resolvida mais adiante no período (o link foi enviado, o cliente disse que concluiu) NÃO é pendência: registre o que foi feito em interacoes.
- Não crie item genérico que valeria para qualquer conversa ("acionar a equipe se precisar", "acompanhar o cliente"). Na dúvida, deixe de fora.
- Seção sem conteúdo fica como lista vazia.`;

const itemSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { texto: { type: "string" }, ref: { type: ["integer", "null"] } },
    required: ["texto", "ref"],
  },
};
const TOOL = [{
  type: "function",
  function: {
    name: "registrar_resumo",
    description: "Registra o resumo estruturado do grupo.",
    parameters: {
      type: "object",
      properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, itemSchema])),
      required: [...SECTION_KEYS],
    },
  },
}];

type FilterType = "last_24h" | "period" | "attendance";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = userData?.user;
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "preview";
    const conversationId: string | undefined = body.conversationId;
    const filterType = body.filterType as FilterType;
    if (!conversationId) return json({ error: "bad_request", message: "conversationId é obrigatório" }, 400);
    if (!["last_24h", "period", "attendance"].includes(filterType)) {
      return json({ error: "bad_request", message: "Filtro inválido" }, 400);
    }

    const { data: conv } = await supabase
      .from("whatsapp_conversations")
      .select("id, tenant_id, is_group")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return json({ error: "not_found", message: "Conversa não encontrada" }, 404);
    if (!conv.is_group) return json({ error: "bad_request", message: "O resumo com IA é só para grupos" }, 400);

    // Mesmo portao da RLS: super admin, ou membro ativo do tenant da conversa.
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id, is_super_admin, access_status, status")
      .eq("user_id", user.id)
      .maybeSingle();
    const isSuper = prof?.is_super_admin === true;
    const isMember = prof?.tenant_id === conv.tenant_id && prof?.access_status === "active" &&
      (prof?.status ?? "ativo") === "ativo";
    if (!isSuper && !isMember) return json({ error: "forbidden", message: "Sem acesso a este grupo" }, 403);

    // ----- periodo -----
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;
    let attendanceId: string | null = null;
    if (filterType === "last_24h") {
      periodEnd = now;
      periodStart = new Date(now.getTime() - 24 * 3600_000);
    } else if (filterType === "period") {
      periodStart = new Date(body.periodStart);
      periodEnd = new Date(body.periodEnd);
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodEnd < periodStart) {
        return json({ error: "bad_request", message: "Período inválido" }, 400);
      }
      if (periodEnd > now) periodEnd = now;
      if ((periodEnd.getTime() - periodStart.getTime()) / 86_400_000 > MAX_PERIOD_DAYS) {
        return json({ error: "period_too_long", message: `Escolha um período de até ${MAX_PERIOD_DAYS} dias.` }, 400);
      }
    } else {
      attendanceId = body.attendanceId ?? null;
      const { data: att } = attendanceId
        ? await supabase.from("support_attendances").select("id, conversation_id, opened_at, closed_at")
          .eq("id", attendanceId).maybeSingle()
        : { data: null };
      if (!att || att.conversation_id !== conversationId || !att.opened_at) {
        return json({ error: "not_found", message: "Atendimento não encontrado neste grupo" }, 404);
      }
      periodStart = new Date(att.opened_at);
      periodEnd = att.closed_at ? new Date(att.closed_at) : now;
    }

    // ----- mensagens do periodo (paginado: PostgREST corta em 1000) -----
    const messages: RawMessage[] = [];
    for (let from = 0;; from += 1000) {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, timestamp, content, message_type, is_from_me, sender_name, sent_by_user_id, audio_transcription, media_filename, deleted_at")
        .eq("conversation_id", conversationId)
        .gte("timestamp", periodStart.toISOString())
        .lte("timestamp", periodEnd.toISOString())
        .order("timestamp", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      messages.push(...(data ?? []));
      if (!data || data.length < 1000 || messages.length > MAX_LINES * 2) break;
    }

    const staffIds = [...new Set(messages.filter((m) => m.is_from_me && m.sent_by_user_id).map((m) => m.sent_by_user_id!))];
    const staffNames = await loadStaffNames(supabase, staffIds);
    const lines = buildLines(messages, staffNames);
    const lastMessageAt = lines.length ? lines[lines.length - 1].timestamp : null;

    const audios = messages.filter((m) => m.message_type === "audio" && !m.deleted_at);
    const stats = {
      message_count: lines.length,
      participants: new Set(lines.map((l) => l.who)).size,
      audio_transcribed: audios.filter((m) => (m.audio_transcription ?? "").trim()).length,
      audio_untranscribed: audios.filter((m) => !(m.audio_transcription ?? "").trim()).length,
      parts: chunkLines(lines, CHUNK_CHARS).length,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    };

    // Resumo igual ja salvo e sem mensagem nova depois dele? (24h anda sozinho, nao entra)
    let duplicate: unknown = null;
    if (filterType !== "last_24h" && lastMessageAt) {
      let q = supabase
        .from("whatsapp_group_summaries")
        .select("id, created_at, created_by, last_message_at")
        .eq("conversation_id", conversationId)
        .eq("filter_type", filterType)
        .eq("status", "ready")
        .gte("last_message_at", lastMessageAt)
        .order("created_at", { ascending: false })
        .limit(1);
      q = filterType === "attendance"
        ? q.eq("attendance_id", attendanceId)
        : q.eq("period_start", periodStart.toISOString()).eq("period_end", periodEnd.toISOString());
      const { data: dup } = await q.maybeSingle();
      if (dup) {
        const names = await loadStaffNames(supabase, [dup.created_by]);
        duplicate = { ...dup, created_by_name: names.get(dup.created_by) ?? null };
      }
    }

    if (action === "preview") return json({ ...stats, duplicate });
    if (action !== "generate") return json({ error: "bad_request", message: "Ação inválida" }, 400);

    if (lines.length === 0) return json({ error: "empty", message: "Nenhuma mensagem com conteúdo no período." }, 400);
    if (lines.length > MAX_LINES) {
      return json({ error: "too_many", message: `O período tem ${lines.length} mensagens. Escolha um período menor (até ${MAX_LINES}).` }, 400);
    }

    // Um por vez por grupo. Linha presa em "generating" (function morreu) vira falha.
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    await supabase.from("whatsapp_group_summaries")
      .update({ status: "failed", error_message: "Tempo esgotado ao gerar o resumo.", finished_at: new Date().toISOString() })
      .eq("conversation_id", conversationId).eq("status", "generating").lt("created_at", staleBefore);
    const { data: running } = await supabase.from("whatsapp_group_summaries")
      .select("id").eq("conversation_id", conversationId).eq("status", "generating").limit(1).maybeSingle();
    if (running) return json({ error: "busy", message: "Já existe um resumo sendo gerado neste grupo.", id: running.id }, 409);

    // Orcamento de IA do mes (mesmo portao das outras funcoes de IA).
    const { data: cfg } = await supabase.from("configuracoes")
      .select("ai_monthly_budget_usd").eq("tenant_id", conv.tenant_id).maybeSingle();
    const budget = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (budget != null && budget > 0) {
      const { data: spend } = await supabase.rpc("ai_month_spend_usd", { p_tenant_id: conv.tenant_id });
      if ((Number(spend) || 0) >= budget) {
        return json({ error: "budget_exceeded", message: "O teto de gasto com IA deste mês foi atingido." }, 402);
      }
    }

    const aiConfig = await getAIConfig(conv.tenant_id, supabase);
    if (!aiConfig) {
      return json({ error: "ai_not_configured", message: "Nenhuma IA configurada. Acesse Configurações > Inteligência Artificial." }, 402);
    }

    const { data: row, error: insErr } = await supabase.from("whatsapp_group_summaries").insert({
      tenant_id: conv.tenant_id,
      conversation_id: conversationId,
      filter_type: filterType,
      attendance_id: attendanceId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      status: "generating",
      message_count: lines.length,
      last_message_at: lastMessageAt,
      parts: stats.parts,
      provider: aiConfig.provider,
      model: aiConfig.model,
      created_by: user.id,
    }).select("id").single();
    // uq_wa_group_summaries_one_generating: outro clique gravou entre a conferencia e aqui.
    if (insErr?.code === "23505") return json({ error: "busy", message: "Já existe um resumo sendo gerado neste grupo." }, 409);
    if (insErr) throw insErr;

    const work = runSummary(supabase, { ...aiConfig, systemPrompt: null }, conv.tenant_id, row.id, lines);
    // @ts-ignore EdgeRuntime existe no runtime do Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    else await work;

    return json({ id: row.id, status: "generating", ...stats }, 202);
  } catch (e) {
    console.error(`[${FN}]`, e);
    return json({ error: "internal", message: e instanceof Error ? e.message : "Erro desconhecido" }, 500);
  }
});

async function loadStaffNames(supabase: any, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const { data: profs } = await supabase.from("profiles").select("user_id, funcionario_id").in("user_id", userIds);
  const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
  if (!funcIds.length) return out;
  const { data: funcs } = await supabase.from("funcionarios").select("id, nome").in("id", funcIds);
  const nameByFunc = new Map((funcs ?? []).map((f: any) => [f.id, f.nome]));
  for (const p of profs ?? []) {
    const n = nameByFunc.get(p.funcionario_id);
    if (n) out.set(p.user_id, String(n).trim().split(/\s+/)[0]);
  }
  return out;
}

async function callAndLog(supabase: any, aiConfig: any, tenantId: string, user: string): Promise<string> {
  const ai = await callAI(aiConfig, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ], TOOL, { maxTokens: 4000 });
  try {
    await supabase.from("ai_usage_log").insert({
      tenant_id: tenantId,
      function_name: FN,
      input_tokens: ai.usage.inputTokens,
      output_tokens: ai.usage.outputTokens,
      model: aiConfig.model,
      provider: aiConfig.provider,
      estimated_cost_usd: ai.usage.estimatedCostUsd,
    });
  } catch (_) { /* log nao pode derrubar o resumo */ }
  return ai.content;
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("401") || msg.includes("invalid_api_key")) return "A chave da IA é inválida. Verifique em Configurações > Inteligência Artificial.";
  if (msg.includes("429") || msg.includes("quota")) return "O provedor de IA recusou por limite de uso. Tente de novo em alguns minutos.";
  if (msg.includes("formato esperado")) return "A IA respondeu fora do formato. Tente gerar de novo.";
  return "Não foi possível gerar o resumo. Tente de novo.";
}

async function runSummary(supabase: any, aiConfig: any, tenantId: string, id: string, lines: Line[]) {
  try {
    const byRef = new Map(lines.map((l) => [l.ref, l]));
    const chunks = chunkLines(lines, CHUNK_CHARS);
    const partials: Sections[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const header = chunks.length > 1
        ? `Parte ${i + 1} de ${chunks.length} das mensagens do grupo.\n\n`
        : "Mensagens do grupo:\n\n";
      const raw = await callAndLog(supabase, aiConfig, tenantId, header + chunks[i].map((l) => l.text).join("\n"));
      partials.push(parseSections(raw, byRef));
    }

    let sections = partials[0];
    if (partials.length > 1) {
      const raw = await callAndLog(
        supabase,
        aiConfig,
        tenantId,
        `O grupo foi lido em ${partials.length} partes. Abaixo, os itens de cada seção de todas as partes, em ordem.\n` +
          `Junte num resumo só: una itens repetidos, e se uma pendência foi resolvida numa parte posterior, tire-a das pendências e registre em interações. Mantenha o "ref" do item que ficou.\n\n` +
          sectionsForMerge(partials, lines),
      );
      sections = parseSections(raw, byRef);
    }

    await supabase.from("whatsapp_group_summaries").update({
      status: "ready",
      sections,
      original_sections: sections,
      finished_at: new Date().toISOString(),
      error_message: countItems(sections) === 0 ? "Nada relevante encontrado no período." : null,
    }).eq("id", id);
  } catch (e) {
    console.error(`[${FN}] run`, id, e);
    await supabase.from("whatsapp_group_summaries").update({
      status: "failed",
      error_message: friendlyError(e),
      finished_at: new Date().toISOString(),
    }).eq("id", id);
  }
}
